import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SttProvider, SttBatchOptions, SttResult } from "../../types.js";
import type { ResolvedLocalWhisperConfig } from "../../types.js";

/**
 * Local Whisper STT provider.
 * Spawns a whisper.cpp subprocess for fully offline transcription.
 * Requires whisper.cpp to be installed and on PATH (command: `whisper-cpp` or `main`).
 *
 * Privacy-first: no data leaves the machine.
 */
export class LocalWhisperStt implements SttProvider {
  readonly id = "local-whisper";
  readonly supportsStreaming = false;

  private config: ResolvedLocalWhisperConfig;
  private whisperBin: string;

  constructor(config: ResolvedLocalWhisperConfig) {
    this.config = config;
    this.whisperBin = "whisper-cpp"; // default binary name; override if needed
  }

  async transcribe(audio: Buffer, options: SttBatchOptions): Promise<SttResult> {
    const wav = pcmToWav(audio, options.sampleRate);
    const tmpPath = join(tmpdir(), `vg-stt-${randomUUID()}.wav`);

    try {
      await writeFile(tmpPath, wav);
      const text = await this.runWhisper(tmpPath);
      return { text: text.trim(), isFinal: true };
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  async dispose(): Promise<void> {}

  // ── Internal ─────────────────────────────────────────────────────────────────

  private runWhisper(wavPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-m", this.config.modelPath ?? `models/ggml-${this.config.model}.bin`,
        "-f", wavPath,
        "-t", String(this.config.threads),
        "--output-txt",
        "--no-timestamps",
        "-nt",
        "--language", "en",
      ];

      const proc = spawn(this.whisperBin, args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`whisper-cpp exited with code ${code}: ${stderr.slice(0, 200)}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn whisper-cpp: ${err.message}. Is it installed?`));
      });
    });
  }
}

// ── WAV encoding (shared helper) ──────────────────────────────────────────────

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataLength = pcm.length;
  const headerLength = 44;
  const total = headerLength + dataLength;

  const wav = Buffer.allocUnsafe(total);
  let o = 0;
  const str = (s: string) => { wav.write(s, o, "ascii"); o += s.length; };
  const u32 = (v: number) => { wav.writeUInt32LE(v, o); o += 4; };
  const u16 = (v: number) => { wav.writeUInt16LE(v, o); o += 2; };

  str("RIFF"); u32(total - 8); str("WAVE");
  str("fmt "); u32(16); u16(1); u16(numChannels);
  u32(sampleRate); u32(byteRate); u16(blockAlign); u16(bitsPerSample);
  str("data"); u32(dataLength);
  pcm.copy(wav, o);
  return wav;
}
