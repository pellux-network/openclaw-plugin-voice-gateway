import { EventEmitter } from "node:events";
import type { TtsProvider, TtsStream, TtsOptions } from "../../types.js";
import type { ResolvedOpenAiTtsConfig } from "../../types.js";

/** OpenAI TTS provider via REST streaming (~250ms TTFB). */
export class OpenAiTts implements TtsProvider {
  readonly id = "openai";
  readonly supportsStreaming = true;

  private config: ResolvedOpenAiTtsConfig;

  constructor(config: ResolvedOpenAiTtsConfig) {
    this.config = config;
  }

  synthesizeStream(text: string, options?: TtsOptions): TtsStream {
    const stream = new OpenAiTtsStream();
    void stream.start(text, this.config, options);
    return stream;
  }

  async dispose(): Promise<void> {}
}

// ── Streaming session ─────────────────────────────────────────────────────────

class OpenAiTtsStream extends EventEmitter implements TtsStream {
  private cancelled = false;
  private abortController = new AbortController();

  cancel(): void {
    this.cancelled = true;
    this.abortController.abort();
    this.emit("end");
    this.removeAllListeners();
  }

  async start(text: string, config: ResolvedOpenAiTtsConfig, options?: TtsOptions): Promise<void> {
    try {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          voice: config.voice,
          input: text,
          response_format: "pcm",
          speed: options?.speed ?? config.speed,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const err = await response.text().catch(() => "unknown");
        throw new Error(`OpenAI TTS error ${response.status}: ${err.slice(0, 200)}`);
      }

      if (!response.body) throw new Error("OpenAI TTS: empty response body");

      const reader = response.body.getReader();
      try {
        while (!this.cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            // OpenAI TTS returns 24kHz mono PCM at 16-bit
            this.emit("audio", Buffer.from(value), 24_000);
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!this.cancelled) {
        this.emit("end");
      }
    } catch (err) {
      if (!this.cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.removeAllListeners();
    }
  }
}
