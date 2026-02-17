# openclaw-plugin-voice-gateway

Real-time voice conversations in Discord voice channels for OpenClaw. Supports two engine modes — native speech-to-speech for minimum latency, or a fully-streaming STT → LLM → TTS pipeline with multi-provider support.

---

## Installation

### From npm (recommended)

```bash
openclaw plugins install openclaw-plugin-voice-gateway
```

### Local development

```bash
git clone <your-repo-url>
cd voice-gateway
bun install
bun run build
openclaw plugins install -l .
```

After installing, add the plugin to your OpenClaw config (usually `~/.openclaw/config.jsonc`):

```jsonc
{
  "plugins": {
    "entries": {
      "voice-gateway": {
        "enabled": true,
        "config": {
          "discordToken": "your-bot-token",
          "mode": "auto",
          "stt": {
            "provider": "deepgram",
            "deepgram": { "apiKey": "your-deepgram-key" }
          },
          "tts": {
            "provider": "cartesia",
            "cartesia": {
              "apiKey": "your-cartesia-key",
              "voiceId": "79a125e8-cd45-4c13-8a67-188112f4dd22"
            }
          }
        }
      }
    }
  }
}
```

API keys can be omitted from config and set via environment variables instead — see [Environment Variables](#environment-variables).

---

## Features

- **Dual-mode engine** — Native speech-to-speech (OpenAI Realtime API, Gemini Live) or traditional pipeline (STT → LLM → TTS)
- **Auto mode** — Automatically prefers speech-to-speech when credentials are present, falls back to pipeline
- **Sentence-level TTS pipelining** — In pipeline mode, TTS starts on the first sentence while the LLM is still generating the rest
- **Barge-in** — Interrupt the bot mid-speech by talking; it stops and listens immediately
- **Deep-learning VAD** — Silero v5 voice activity detection (falls back to RMS energy threshold)
- **Echo suppression** — Prevents the bot's own audio from looping back through user microphones
- **Provider fallback chains** — Primary STT/TTS failure automatically retries with the configured fallback

### Provider Support

| Type | Provider | Notes |
|------|----------|-------|
| **STT** | Deepgram Nova-3 | Streaming, ~200ms latency (default) |
| **STT** | OpenAI Whisper | Batch fallback |
| **STT** | local-whisper | Offline via `whisper.cpp` |
| **TTS** | Cartesia Sonic-2 | ~40ms TTFB, streaming (default) |
| **TTS** | ElevenLabs Flash v2.5 | ~75ms TTFB, fallback |
| **TTS** | OpenAI TTS | REST streaming |
| **TTS** | Kokoro | Offline ONNX, no API key needed |
| **S2S** | OpenAI Realtime API | Native audio, server VAD, function calling |
| **S2S** | Gemini Live | Native audio, transparent 10-min session rotation |

---

## Requirements

- **OpenClaw** with the plugins feature enabled
- **Node.js** ≥ 20
- A Discord bot token with `Connect`, `Speak`, and `Use Voice Activity` permissions
- API keys for your chosen providers

---

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, enable these **Privileged Gateway Intents**:
   - Server Members Intent
   - Message Content Intent (optional)
3. Under **OAuth2 → URL Generator**, select scopes: `bot`, and permissions: `Connect`, `Speak`, `Use Voice Activity`.
4. Open the generated URL in a browser, add the bot to your server.
5. Copy the **Bot Token** for your config.

---

## Configuration

All config fields can be set in the OpenClaw plugin config, or via environment variables. API keys always fall back to the corresponding env var automatically.

### Environment Variables

```env
DISCORD_TOKEN=your-discord-bot-token

# STT
DEEPGRAM_API_KEY=your-deepgram-key        # Deepgram Nova-3 (default STT)
OPENAI_API_KEY=your-openai-key            # Whisper fallback + OpenAI TTS + OpenAI Realtime

# TTS
CARTESIA_API_KEY=your-cartesia-key        # Cartesia Sonic-2 (default TTS)
ELEVENLABS_API_KEY=your-elevenlabs-key    # ElevenLabs fallback TTS

# Speech-to-Speech (optional — enables auto mode to prefer S2S)
GOOGLE_API_KEY=your-google-key            # Gemini Live
```

### Full Config Reference

```jsonc
{
  "plugins": {
    "entries": {
      "voice-gateway": {
        "enabled": true,
        "config": {

          // Required — or set DISCORD_TOKEN env var
          "discordToken": "your-bot-token",

          // Engine mode: "auto" | "pipeline" | "speech-to-speech"
          // auto = prefer S2S when configured, fall back to pipeline
          "mode": "auto",

          // ── Speech-to-Text (pipeline mode) ──────────────────────────────
          "stt": {
            "provider": "deepgram",          // "deepgram" | "whisper" | "local-whisper"
            "fallback": "whisper",
            "deepgram": {
              "apiKey": "",                   // or DEEPGRAM_API_KEY
              "model": "nova-3",
              "language": "en",
              "endpointing": 300,             // ms of silence before STT finalizes
              "smartFormatting": true,
              "keywords": []                  // boost specific words
            },
            "whisper": {
              "apiKey": "",                   // or OPENAI_API_KEY
              "model": "whisper-1",
              "language": "en"                // omit for auto-detect
            },
            "localWhisper": {
              "model": "base.en",
              "modelPath": "/path/to/ggml-base.en.bin",
              "threads": 4
            }
          },

          // ── Text-to-Speech (pipeline mode) ──────────────────────────────
          "tts": {
            "provider": "cartesia",          // "cartesia" | "elevenlabs" | "openai" | "kokoro"
            "fallback": "elevenlabs",
            "cartesia": {
              "apiKey": "",                   // or CARTESIA_API_KEY
              "voiceId": "79a125e8-cd45-4c13-8a67-188112f4dd22",
              "model": "sonic-2",
              "language": "en",
              "speed": 1.0                    // 0.5 – 2.0
            },
            "elevenlabs": {
              "apiKey": "",                   // or ELEVENLABS_API_KEY
              "voiceId": "21m00Tcm4TlvDq8ikWAM",
              "model": "eleven_flash_v2_5",
              "stability": 0.5,
              "similarityBoost": 0.75
            },
            "openai": {
              "apiKey": "",                   // or OPENAI_API_KEY
              "voice": "nova",                // alloy | echo | fable | nova | onyx | shimmer
              "model": "tts-1",
              "speed": 1.0
            },
            "kokoro": {
              "voiceId": "af_heart",
              "speed": 1.0
            }
          },

          // ── Native Speech-to-Speech (optional) ──────────────────────────
          // When configured, "auto" mode will use this instead of the pipeline
          "s2s": {
            "provider": "openai-realtime",   // "openai-realtime" | "gemini-live"
            "openaiRealtime": {
              "apiKey": "",                   // or OPENAI_API_KEY
              "model": "gpt-4o-realtime-preview",
              "voice": "alloy",              // alloy | echo | fable | nova | onyx | shimmer | verse
              "instructions": "You are a helpful voice assistant.",
              "temperature": 0.8
            },
            "geminiLive": {
              "apiKey": "",                   // or GOOGLE_API_KEY
              "model": "gemini-2.5-flash-native-audio-preview",
              "voice": "Puck",
              "instructions": "You are a helpful voice assistant.",
              "sessionDurationMs": 540000     // 9 min; auto-rotates before Gemini's 10-min limit
            }
          },

          // ── Voice Activity Detection ─────────────────────────────────────
          "vad": {
            "engine": "silero",              // "silero" (deep learning) | "rms" (simple energy)
            "threshold": 0.5,               // speech probability threshold (0–1)
            "silenceDurationMs": 1500,       // ms of silence before speech ends
            "minSpeechDurationMs": 250       // minimum speech duration to process
          },

          // ── Conversation behavior ────────────────────────────────────────
          "behavior": {
            "bargeIn": true,                 // interrupt bot when user speaks
            "echoSuppression": true,         // filter bot's own audio from input
            "maxRecordingMs": 30000,         // max user speech before forced flush
            "maxConversationTurns": 50,      // history window for pipeline mode
            "systemPrompt": "You are a helpful voice assistant.",
            "allowedUsers": []               // Discord user IDs; empty = allow all
          }

        }
      }
    }
  }
}
```

---

## Quickstart Configurations

### Lowest Latency — OpenAI Realtime API

```jsonc
// ~/.openclaw/config.jsonc
{
  "plugins": {
    "entries": {
      "voice-gateway": {
        "enabled": true,
        "config": {
          "mode": "speech-to-speech",
          "s2s": {
            "provider": "openai-realtime",
            "openaiRealtime": { "voice": "alloy" }
          }
        }
      }
    }
  }
}
```

```env
DISCORD_TOKEN=...
OPENAI_API_KEY=sk-...
```

---

### Best Pipeline Quality — Deepgram + Cartesia

```jsonc
{
  "plugins": {
    "entries": {
      "voice-gateway": {
        "enabled": true,
        "config": {
          "mode": "pipeline",
          "stt": { "provider": "deepgram" },
          "tts": { "provider": "cartesia" }
        }
      }
    }
  }
}
```

```env
DISCORD_TOKEN=...
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
```

---

### Fully Offline — local-whisper + Kokoro

```jsonc
{
  "plugins": {
    "entries": {
      "voice-gateway": {
        "enabled": true,
        "config": {
          "mode": "pipeline",
          "stt": {
            "provider": "local-whisper",
            "localWhisper": {
              "model": "base.en",
              "modelPath": "/path/to/ggml-base.en.bin"
            }
          },
          "tts": {
            "provider": "kokoro",
            "kokoro": { "voiceId": "af_heart" }
          }
        }
      }
    }
  }
}
```

```env
DISCORD_TOKEN=...
```

Requires `whisper.cpp` on PATH. Download `.bin` model files from [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp/blob/master/models/README.md).

---

## Usage

Once installed and configured, the plugin registers the following across OpenClaw:

### CLI Commands

```bash
# Join a Discord voice channel
openclaw voice join <guildId> <channelId>

# Leave the current voice channel
openclaw voice leave <guildId>

# Speak text in the voice channel
openclaw voice speak <guildId> "Hello, world!"

# Show status (all guilds or a specific one)
openclaw voice status
openclaw voice status <guildId>
```

### Agent Tool

The `discord_voice` tool is automatically available to the OpenClaw agent when this plugin is enabled:

| Action | Required params | Description |
|--------|----------------|-------------|
| `join` | `guildId`, `channelId` | Join a voice channel |
| `leave` | `guildId` | Leave the voice channel |
| `speak` | `guildId`, `text` | Speak text aloud |
| `status` | `guildId` | Get session state and engine mode |

### Gateway RPC Methods

```
voice-gateway.join   { guildId, channelId }  →  { guildId, channelId, mode }
voice-gateway.leave  { guildId }             →  { guildId }
voice-gateway.speak  { guildId, text }       →  { guildId, spoken }
voice-gateway.status { guildId? }            →  { running, mode, active, state, engineMode, activeGuilds }
```

---

## Architecture

```
Discord voice channel
        │  Opus audio
        ▼
  AudioReceiver (per-user streams)
        │  decoded 16kHz PCM
        ▼
  EchoSuppressor ──► drop if echo
        │
        ▼
  VoiceActivityDetector (per-user, Silero VAD)
        │  speech-start / speech-end
        ▼
  VoiceEngine
  ┌──────────────────────────┐   ┌──────────────────────────┐
  │ PipelineEngine           │   │ SpeechToSpeechEngine     │
  │  Deepgram STT            │   │  OpenAI Realtime API  or │
  │    → OpenClaw LLM        │   │  Gemini Live             │
  │      → Cartesia TTS      │   │  (one WebSocket loop)    │
  │  sentence-level pipeline │   │  function calls bridged  │
  └──────────────────────────┘   └──────────────────────────┘
        │  audio-out (PCM chunks)
        ▼
  AudioSender (PassThrough → @discordjs/voice AudioPlayer)
        │  48kHz stereo PCM
        ▼
  Discord voice channel
```

### Engine Mode Selection

| `mode` setting | Behaviour |
|----------------|-----------|
| `"auto"` (default) | Uses speech-to-speech if `s2s.provider` is set and has valid credentials, otherwise falls back to pipeline |
| `"speech-to-speech"` | Forces S2S; throws if no S2S credentials found |
| `"pipeline"` | Forces STT → LLM → TTS pipeline |

---

## Latency Expectations

| Mode | Typical first-audio latency |
|------|-----------------------------|
| OpenAI Realtime (S2S) | ~300–500ms |
| Gemini Live (S2S) | ~400–700ms |
| Pipeline: Deepgram + Cartesia | ~700–1200ms |
| Pipeline: Whisper + ElevenLabs | ~1500–3000ms |
| Pipeline: local-whisper + Kokoro | hardware-dependent |

Pipeline latency is dominated by STT finalization time. Sentence-level TTS pipelining ensures the bot starts speaking as soon as the first sentence is ready, overlapping LLM generation and TTS synthesis.

---

## Troubleshooting

**Bot joins but produces no audio**
- Confirm the bot has `Connect` and `Speak` permissions in the target voice channel.
- Check TTS API key validity. Look for errors in the OpenClaw logs.
- In pipeline mode, check that STT is producing output — look for `User <id>:` log lines.

**High latency in pipeline mode**
- Switch to Deepgram Nova-3 for STT (`stt.provider: "deepgram"`) — streaming transcription at ~200ms vs Whisper's 1–3s batch.
- Switch to Cartesia Sonic-2 for TTS — ~40ms TTFB.
- For the absolute lowest latency, use `mode: "speech-to-speech"` with OpenAI Realtime.

**Echo / feedback loop**
- Ensure `behavior.echoSuppression: true` (it is by default).
- Users should use headphones to prevent the bot's audio from feeding back through their microphone.

**"S2S provider not configured" error**
- `mode: "speech-to-speech"` requires `s2s.provider` to be set to either `"openai-realtime"` or `"gemini-live"`.
- Use `mode: "auto"` to automatically fall back to pipeline when no S2S credentials are found.

**Gemini Live disconnects every ~10 minutes**
- This is expected behaviour from the Gemini API. The plugin automatically opens a new WebSocket session at 9 minutes, before the limit is reached, and transfers conversation context seamlessly.

**VAD fires too aggressively or misses speech**
- `vad.threshold` — lower = more sensitive (picks up quieter speech), higher = less sensitive (ignores background noise).
- `vad.silenceDurationMs` — how long silence must last before speech is considered ended.
- If Silero VAD fails to load, the plugin falls back to RMS energy thresholding automatically.

**`whisper.cpp` binary not found**
- Install [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and make the `whisper-cpp` binary available on your `PATH`.
- Set `stt.localWhisper.modelPath` to the full path of a `.bin` model file.

**Plugin not loading after install**
```bash
openclaw plugins list           # check it appears
openclaw plugins info voice-gateway   # check it's enabled
openclaw plugins doctor         # diagnose dependency issues
```

---

## Development

```bash
# Clone and install
git clone <your-repo-url>
cd voice-gateway
bun install

# Type check (no emit)
bun run check

# Compile to dist/
bun run build

# Watch mode
bun run build:watch

# Install into your local OpenClaw instance
openclaw plugins install -l .

# Run tests
bun test
```

### Plugin Commands

```bash
openclaw plugins list                   # list all installed plugins
openclaw plugins enable voice-gateway   # enable after disabling
openclaw plugins disable voice-gateway  # disable without uninstalling
openclaw plugins update openclaw-plugin-voice-gateway   # update to latest npm version
```

---

## File Structure

```
index.ts                        # Plugin entry point — registers service, tools, CLI
openclaw.plugin.json            # OpenClaw manifest + JSON Schema config definition
package.json
src/
├── types.ts                    # All shared interfaces
├── config.ts                   # Config resolution + env var fallbacks
├── constants.ts                # Audio constants and thresholds
├── core-bridge.ts              # Bridge to OpenClaw agent API (LLM streaming + tool calls)
│
├── engine/
│   ├── engine-interface.ts     # VoiceEngine contract (shared by both engines)
│   ├── pipeline-engine.ts      # STT → LLM → TTS with sentence-level streaming
│   ├── speech-to-speech-engine.ts  # OpenAI Realtime / Gemini Live wrapper
│   └── engine-factory.ts       # Mode resolution and engine instantiation
│
├── providers/
│   ├── stt/
│   │   ├── deepgram-stt.ts     # Deepgram Nova-3 WebSocket streaming
│   │   ├── whisper-stt.ts      # OpenAI Whisper batch
│   │   └── local-whisper-stt.ts    # whisper.cpp subprocess
│   ├── tts/
│   │   ├── cartesia-tts.ts     # Cartesia Sonic-2 streaming (~40ms TTFB)
│   │   ├── elevenlabs-tts.ts   # ElevenLabs Flash v2.5
│   │   ├── openai-tts.ts       # OpenAI TTS REST streaming
│   │   └── kokoro-tts.ts       # Kokoro offline ONNX
│   └── s2s/
│       ├── openai-realtime.ts  # OpenAI Realtime WebSocket
│       └── gemini-live.ts      # Gemini Live with session rotation
│
├── audio/
│   ├── audio-pipeline.ts       # Opus decode + PCM resample (16k ↔ 48k)
│   ├── vad.ts                  # Silero / RMS voice activity detection
│   ├── echo-suppressor.ts      # Temporal gating + energy fingerprinting
│   └── playback-queue.ts       # Sequential TTS playback with barge-in support
│
├── discord/
│   ├── connection.ts           # Join/leave/reconnect with exponential backoff
│   ├── audio-receiver.ts       # Per-user Opus → decoded 16kHz PCM
│   └── audio-sender.ts         # PCM → @discordjs/voice AudioPlayer
│
└── session/
    ├── conversation-context.ts # Turn history with sliding-window pruning
    ├── voice-session.ts        # Per-guild orchestrator
    └── session-manager.ts      # Guild → session lifecycle map
```
