import type { ConversationTurn, ToolDefinition } from "./types.js";

/**
 * Bridges between the voice engine and the OpenClaw agent system.
 *
 * In pipeline mode:
 *   - Sends transcribed user speech to the OpenClaw agent
 *   - Streams the LLM's token-by-token response back for TTS pipelining
 *
 * In speech-to-speech mode:
 *   - Executes tool calls from OpenAI Realtime / Gemini Live
 *   - Returns results back to the provider
 *
 * The OpenClaw agent API is loaded at runtime via the plugin API object.
 * We keep this decoupled from the engine to avoid circular deps.
 */
export class CoreBridge {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private api: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(api: any) {
    this.api = api;
  }

  /**
   * Stream an agent response for a user message.
   * Calls `onToken` for each token as it arrives.
   * Returns the full response text when done.
   *
   * @param userId   Discord user ID (for attribution)
   * @param text     The transcribed user message
   * @param history  Recent conversation turns for context
   * @param onToken  Called with each streaming token
   */
  async streamAgentResponse(
    userId: string,
    text: string,
    history: readonly ConversationTurn[],
    onToken: (token: string) => void
  ): Promise<string> {
    // Build context prefix from conversation history
    const contextPrefix = history.length > 0
      ? history.map(t => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n") + "\n"
      : "";

    const fullMessage = contextPrefix + `User (${userId}): ${text}`;

    // Try to use the OpenClaw agent streaming API if available
    if (this.api?.runtime?.streamMessage) {
      const chunks: string[] = [];
      await this.api.runtime.streamMessage(fullMessage, (token: string) => {
        chunks.push(token);
        onToken(token);
      });
      return chunks.join("");
    }

    // Fallback: non-streaming response
    if (this.api?.runtime?.sendMessage) {
      const response = await this.api.runtime.sendMessage(fullMessage) as string;
      onToken(response);
      return response;
    }

    // If neither API is available, return a placeholder
    // (This happens when the plugin is running without a full OpenClaw agent context)
    const fallback = "[Agent not available]";
    onToken(fallback);
    return fallback;
  }

  /**
   * Execute a tool call from a speech-to-speech provider.
   * Bridges native function calls (OpenAI Realtime / Gemini Live) to OpenClaw tools.
   */
  async executeToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.api?.tools?.execute) {
      return this.api.tools.execute(name, args);
    }
    return { error: `Tool ${name} not available` };
  }

  /**
   * Get available tool definitions in OpenAI function-calling format.
   * Used to register tools with speech-to-speech providers.
   */
  getAvailableTools(): ToolDefinition[] {
    if (this.api?.tools?.list) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools = this.api.tools.list() as any[];
      return tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema ?? t.parameters ?? {},
      }));
    }
    return [];
  }
}
