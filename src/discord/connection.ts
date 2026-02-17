import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  type VoiceConnection,
} from "@discordjs/voice";
import { Client, GatewayIntentBits, type Guild } from "discord.js";
import {
  RECONNECT_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  HEARTBEAT_INTERVAL_MS,
} from "../constants.js";

/**
 * Manages the @discordjs/voice connection for a single guild.
 * Handles joining, leaving, reconnection, and heartbeat monitoring.
 */
export class DiscordConnection {
  readonly guildId: string;
  private client: Client;
  private connection: VoiceConnection | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private channelId: string | null = null;

  constructor(guildId: string, client: Client) {
    this.guildId = guildId;
    this.client = client;
  }

  /** Join a Discord voice channel. Resolves when the connection is ready. */
  async join(channelId: string): Promise<VoiceConnection> {
    this.channelId = channelId;
    this.reconnectAttempts = 0;

    const guild = await this.resolveGuild();
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) {
      throw new Error(`Channel ${channelId} is not a voice channel or does not exist`);
    }

    this.connection = joinVoiceChannel({
      channelId,
      guildId: this.guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    this.setupStateHandlers();

    // Wait until the connection is ready (or fails)
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    this.startHeartbeat();

    return this.connection;
  }

  /** Leave the voice channel and clean up. */
  async leave(): Promise<void> {
    this.stopHeartbeat();

    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }

    this.channelId = null;
    this.reconnectAttempts = 0;
  }

  get voiceConnection(): VoiceConnection | null {
    return this.connection;
  }

  get isConnected(): boolean {
    return (
      this.connection !== null &&
      this.connection.state.status === VoiceConnectionStatus.Ready
    );
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private setupStateHandlers(): void {
    if (!this.connection) return;

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (!this.connection) return;

      // Give Discord 5 seconds to self-heal before we attempt a manual rejoin
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, RECONNECT_DELAY_MS),
          entersState(this.connection, VoiceConnectionStatus.Connecting, RECONNECT_DELAY_MS),
        ]);
        // Discord is reconnecting on its own — wait for Ready
        await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
        this.reconnectAttempts = 0;
      } catch {
        // Self-heal failed — attempt manual rejoin
        await this.attemptRejoin();
      }
    });

    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.stopHeartbeat();
      this.connection = null;
    });
  }

  private async attemptRejoin(): Promise<void> {
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS || !this.channelId) {
      console.error(
        `[DiscordConnection:${this.guildId}] Max reconnect attempts reached. Giving up.`
      );
      await this.leave();
      return;
    }

    this.reconnectAttempts++;
    const delay = 500 * Math.pow(2, this.reconnectAttempts - 1);
    await sleep(delay);

    console.warn(
      `[DiscordConnection:${this.guildId}] Attempting rejoin (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`
    );

    try {
      await this.join(this.channelId);
    } catch {
      await this.attemptRejoin();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected) {
        console.warn(`[DiscordConnection:${this.guildId}] Heartbeat detected stale connection`);
        void this.attemptRejoin();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async resolveGuild(): Promise<Guild> {
    const guild = this.client.guilds.cache.get(this.guildId)
      ?? await this.client.guilds.fetch(this.guildId);

    if (!guild) {
      throw new Error(`Guild ${this.guildId} not found`);
    }

    return guild;
  }
}

// ── Discord client factory ────────────────────────────────────────────────────

let sharedClient: Client | null = null;

/** Get (or create) the shared Discord.js client instance. */
export function getDiscordClient(token: string): Client {
  if (!sharedClient) {
    sharedClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
      ],
    });
  }

  if (!sharedClient.isReady()) {
    void sharedClient.login(token);
  }

  return sharedClient;
}

/** Cleanly destroy the shared client. Call on plugin stop. */
export async function destroyDiscordClient(): Promise<void> {
  if (sharedClient) {
    await sharedClient.destroy();
    sharedClient = null;
  }
}

/** Helper to get an existing voice connection without creating one */
export function getExistingConnection(guildId: string): VoiceConnection | undefined {
  return getVoiceConnection(guildId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
