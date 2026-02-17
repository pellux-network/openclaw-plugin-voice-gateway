import type {
  TtsProvider, TtsStream, TtsResult, TtsOptions,
  ResolvedCartesiaConfig, ResolvedElevenLabsConfig, ResolvedOpenAiTtsConfig,
  ResolvedKokoroConfig, ResolvedTtsConfig,
} from "../../types.js";

export type { TtsProvider, TtsStream, TtsResult, TtsOptions };

/**
 * Create a TTS provider by name (lazy import for heavy deps like Kokoro).
 */
export async function createTtsProvider(
  name: "cartesia" | "elevenlabs" | "openai" | "kokoro",
  config: ResolvedTtsConfig
): Promise<TtsProvider> {
  switch (name) {
    case "cartesia": {
      const { CartesiaTts } = await import("./cartesia-tts.js");
      return new CartesiaTts(config.cartesia as ResolvedCartesiaConfig);
    }
    case "elevenlabs": {
      const { ElevenLabsTts } = await import("./elevenlabs-tts.js");
      return new ElevenLabsTts(config.elevenlabs as ResolvedElevenLabsConfig);
    }
    case "openai": {
      const { OpenAiTts } = await import("./openai-tts.js");
      return new OpenAiTts(config.openai as ResolvedOpenAiTtsConfig);
    }
    case "kokoro": {
      const { KokoroTts } = await import("./kokoro-tts.js");
      return new KokoroTts(config.kokoro as ResolvedKokoroConfig);
    }
  }
}
