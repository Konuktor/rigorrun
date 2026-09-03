/**
 * OpenAI-compatible chat completions. Groq and most self-hosted servers
 * (Ollama, LM Studio, vLLM, OpenRouter) all speak this shape, so one client
 * covers them.
 */
import {
  classifyHttpFailure,
  ProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type LlmProvider,
  type ToolCall,
} from './types.ts';

export interface OpenAiCompatibleConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
}

interface RawChoice {
  message?: {
    content?: string | null;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
  };
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  return {
    id: config.id,
    name: config.name,
    model: config.model,
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 60_000);

      try {
        const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model,
            messages: request.messages.map((m) => ({
              role: m.role,
              content: m.content,
              ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
              ...(m.name ? { name: m.name } : {}),
            })),
            ...(request.tools && request.tools.length > 0
              ? {
                  tools: request.tools.map((tool) => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.parameters,
                    },
                  })),
                }
              : {}),
            temperature: request.temperature ?? 0,
            ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
          }),
        });

        if (!response.ok) {
          throw classifyHttpFailure(response.status, await safeText(response));
        }

        const payload = (await response.json()) as {
          choices?: RawChoice[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const choice = payload.choices?.[0];

        return {
          text: choice?.message?.content ?? '',
          toolCalls: parseToolCalls(choice?.message?.tool_calls),
          usage:
            payload.usage?.prompt_tokens === undefined
              ? null
              : {
                  promptTokens: payload.usage.prompt_tokens ?? 0,
                  completionTokens: payload.usage.completion_tokens ?? 0,
                },
          model: config.model,
          // Token counts are known; per-token prices are not published to the
          // client, so no dollar figure is invented here.
          costUsd: null,
          costNote: 'cost unavailable — provider does not report pricing',
        };
      } catch (error) {
        throw normaliseError(error);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function parseToolCalls(
  raw: { id?: string; function?: { name?: string; arguments?: string } }[] | undefined,
): ToolCall[] {
  if (!raw) return [];
  return raw.flatMap((call, index) => {
    const name = call.function?.name;
    if (!name) return [];
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function?.arguments || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // A model that emits invalid JSON arguments is a real failure mode; keep
      // the call visible with empty args rather than dropping it silently.
      args = {};
    }
    return [{ id: call.id ?? `call_${index}`, name, arguments: args }];
  });
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export function normaliseError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new ProviderError('Provider request timed out.', 'timeout');
  }
  return new ProviderError(`Provider request failed: ${(error as Error).message}`, 'http');
}
