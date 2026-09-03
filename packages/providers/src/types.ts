/**
 * LLM provider abstraction.
 *
 * RigorRun itself never requires a model. Every provider here is optional, and
 * `resolveProvider` returning `null` is a completely normal state that callers
 * must handle by degrading to the deterministic path — not by failing.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** Abort budget in milliseconds. */
  timeoutMs?: number;
}

export interface CompletionResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number } | null;
  model: string;
  /**
   * Real money cost, or `null` when the provider does not publish enough
   * information to compute one. RigorRun never invents a figure.
   */
  costUsd: number | null;
  costNote: string;
}

export interface LlmProvider {
  id: string;
  name: string;
  model: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'unavailable' | 'quota' | 'http' | 'timeout' | 'protocol',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderEnv {
  GROQ_API_KEY?: string | undefined;
  GROQ_MODEL?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL?: string | undefined;
  OPENAI_COMPATIBLE_BASE_URL?: string | undefined;
  OPENAI_COMPATIBLE_API_KEY?: string | undefined;
  OPENAI_COMPATIBLE_MODEL?: string | undefined;
}

/**
 * Quota exhaustion must degrade, never escalate into spend. A 429 or a
 * hard-limit response is surfaced as `kind: 'quota'` so callers can fall back
 * to offline behaviour rather than retrying into an overage.
 */
export function classifyHttpFailure(status: number, body: string): ProviderError {
  if (status === 429 || /quota|rate.?limit|exhausted/i.test(body)) {
    return new ProviderError(
      `Provider quota reached (HTTP ${status}). Falling back to offline mode rather than retrying.`,
      'quota',
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new ProviderError(`Provider rejected the credentials (HTTP ${status}).`, 'http', status);
  }
  return new ProviderError(
    `Provider request failed (HTTP ${status}): ${body.slice(0, 200)}`,
    'http',
    status,
  );
}
