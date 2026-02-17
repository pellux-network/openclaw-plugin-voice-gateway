import { EventEmitter } from "node:events";
import type { VoiceEngine } from "./engine-interface.js";
import type { VoiceSessionContext, SttProvider, TtsProvider } from "../types.js";
import { createSttProvider } from "../providers/stt/stt-interface.js";
import { createTtsProvider } from "../providers/tts/tts-interface.js";
import { ConversationContext } from "../session/conversation-context.js";
import type { CoreBridge } from "../core-bridge.js";
import { SENTENCE_BOUNDARY_RE, TTS_MAX_CHARS, PROCESSING_SAMPLE_RATE } from "../constants.js";

/**
 * Pipeline engine: STT → OpenClaw agent (LLM) → TTS
 *
 * Key latency optimization: sentence-level TTS pipelining.
 * TTS synthesis starts on the first complete sentence while
 * the LLM is still generating subsequent sentences, overlapping
 * their latencies.
 *
 *   User speech → [Deepgram streaming STT] → transcript
 *                                                │
 *                                      [OpenClaw Agent / LLM]
 *                                                │
 *                          sentence 1 → [Cartesia TTS] → audio-out (plays immediately)
 *                          sentence 2 → [Cartesia TTS] → audio-out (queued)
 */
export class PipelineEngine extends EventEmitter implements VoiceEngine {
  readonly mode = "pipeline" as const;

  private stt: SttProvider | null = null;
  private tts: TtsProvider | null = null;
  private fallbackStt: SttProvider | null = null;
  private fallbackTts: TtsProvider | null = null;
  private coreBridge: CoreBridge;
  private conversation: ConversationContext;

  // Per-user audio accumulation (for batch STT fallback)
  private userAudioBuffers = new Map<string, Buffer[]>();

  // Processing lock — only one user at a time for natural conversation
  private isProcessing = false;
  private interrupted = false;

  constructor(coreBridge: CoreBridge, maxConversationTurns = 50) {
    super();
    this.coreBridge = coreBridge;
    this.conversation = new ConversationContext({ maxTurns: maxConversationTurns });
  }

  async start(session: VoiceSessionContext): Promise<void> {
    const { config } = session;

    // Initialize primary providers
    this.stt = await createSttProvider(config.stt.provider, config.stt);
    this.tts = await createTtsProvider(config.tts.provider, config.tts);

    // Initialize fallback providers (lazy — only if primary fails)
    if (config.stt.fallback !== config.stt.provider) {
      this.fallbackStt = await createSttProvider(config.stt.fallback, config.stt).catch(() => null);
    }
    if (config.tts.fallback !== config.tts.provider) {
      this.fallbackTts = await createTtsProvider(config.tts.fallback, config.tts).catch(() => null);
    }
  }

  feedAudio(userId: string, pcm: Buffer, _sampleRate: number): void {
    // If using streaming STT, forward audio directly
    // (streaming STT handles its own buffering)
    // If using batch STT, accumulate until endOfSpeech
    if (!this.userAudioBuffers.has(userId)) {
      this.userAudioBuffers.set(userId, []);
    }
    this.userAudioBuffers.get(userId)!.push(pcm);
  }

  endOfSpeech(userId: string): void {
    if (this.isProcessing) return;

    const buffers = this.userAudioBuffers.get(userId);
    this.userAudioBuffers.delete(userId);

    if (!buffers || buffers.length === 0) return;

    const audio = Buffer.concat(buffers);
    this.processUtterance(userId, audio).catch((err) => {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
  }

  async injectText(userId: string, text: string): Promise<void> {
    await this.generateAndSpeak(userId, text);
  }

  interrupt(): void {
    this.interrupted = true;
    // Engines emit "interrupted" — session handles stopping playback
  }

  async stop(): Promise<void> {
    this.interrupted = true;
    await this.stt?.dispose();
    await this.tts?.dispose();
    await this.fallbackStt?.dispose();
    await this.fallbackTts?.dispose();
    this.userAudioBuffers.clear();
    this.removeAllListeners();
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private async processUtterance(userId: string, audio: Buffer): Promise<void> {
    this.isProcessing = true;
    this.interrupted = false;

    try {
      // Step 1: STT — transcribe the audio
      const sttResult = await this.transcribeWithFallback(audio);
      if (!sttResult.text.trim()) return;

      this.emit("transcript-in", userId, sttResult.text);

      // Step 2: LLM — stream the agent's response with sentence-level TTS pipelining
      await this.generateAndSpeak(userId, sttResult.text);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.isProcessing = false;
    }
  }

  private async generateAndSpeak(userId: string, userText: string): Promise<void> {
    const history = this.conversation.getHistory();

    // Add user turn to context
    this.conversation.addTurn({
      role: "user",
      userId,
      content: userText,
      timestamp: Date.now(),
    });

    const sentenceSplitter = new SentenceSplitter();
    const responseTokens: string[] = [];

    await this.coreBridge.streamAgentResponse(
      userId,
      userText,
      history,
      (token) => {
        if (this.interrupted) return;
        responseTokens.push(token);
        sentenceSplitter.feed(token, (sentence) => {
          this.synthesizeAndEmit(sentence);
        });
      }
    );

    // Flush any remaining text after the stream ends
    const remaining = sentenceSplitter.flush();
    if (remaining && !this.interrupted) {
      this.synthesizeAndEmit(remaining);
    }

    const fullResponse = responseTokens.join("");
    if (fullResponse) {
      this.emit("transcript-out", fullResponse);
      this.conversation.addTurn({
        role: "assistant",
        content: fullResponse,
        timestamp: Date.now(),
      });
    }

    this.emit("turn-end");
  }

  private synthesizeAndEmit(text: string): void {
    if (!text.trim() || !this.tts) return;

    const truncated = text.slice(0, TTS_MAX_CHARS);
    const ttsStream = this.tts.synthesizeStream(truncated);

    ttsStream.on("audio", (chunk: Buffer, sampleRate: number) => {
      if (!this.interrupted) {
        this.emit("audio-out", chunk, sampleRate);
      }
    });

    ttsStream.on("error", (err: Error) => {
      this.emit("error", err);
    });
  }

  private async transcribeWithFallback(audio: Buffer): Promise<{ text: string }> {
    const sampleRate = PROCESSING_SAMPLE_RATE;

    try {
      if (this.stt?.transcribe) {
        return await this.stt.transcribe(audio, { sampleRate });
      }
      throw new Error("Primary STT has no batch transcription support");
    } catch (err) {
      if (this.fallbackStt?.transcribe) {
        return await this.fallbackStt.transcribe(audio, { sampleRate });
      }
      throw err;
    }
  }
}

// ── Sentence splitter ─────────────────────────────────────────────────────────

/**
 * Splits a stream of LLM tokens into complete sentences.
 * Calls the callback immediately when a sentence boundary is detected.
 * This enables TTS synthesis to start before the full response is generated.
 */
class SentenceSplitter {
  private buffer = "";

  feed(token: string, onSentence: (sentence: string) => void): void {
    this.buffer += token;

    let match: RegExpExecArray | null;
    while ((match = SENTENCE_BOUNDARY_RE.exec(this.buffer)) !== null) {
      const sentence = this.buffer.slice(0, match.index + match[1]!.length);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      onSentence(sentence.trim());
    }
  }

  flush(): string | null {
    const text = this.buffer.trim();
    this.buffer = "";
    return text || null;
  }
}
