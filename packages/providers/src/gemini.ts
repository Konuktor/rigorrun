/**
 * Google Gemini. Different wire format from OpenAI's, so it gets its own
 * client rather than a leaky adapter.
 */
import {
  classifyHttpFailure,
  type CompletionRequest,
  type CompletionResponse,
  type LlmProvider,
  type ToolCall,
} from './types.ts';
import { normaliseError } from './openai.ts';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function createGeminiProvider(apiKey: string, model = 'gemini-2.0-flash'): LlmProvider {
  return {
    id: 'gemini',
    name: `Gemini (${model})`,
    model,
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 60_000);

      const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content);
      const contents = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      try {
        const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents,
            ...(system.length > 0
              ? { systemInstruction: { parts: [{ text: system.join('\n') }] } }
              : {}),
            ...(request.tools && request.tools.length > 0
              ? {
                  tools: [
                    {
                      functionDeclarations: request.tools.map((tool) => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters,
                      })),
                    },
                  ],
                }
              : {}),
            generationConfig: {
              temperature: request.temperature ?? 0,
              ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
            },
          }),
        });

        if (!response.ok) {
          throw classifyHttpFailure(response.status, await response.text().catch(() => ''));
        }

        const payload = (await response.json()) as {
          candidates?: {
            content?: {
              parts?: { text?: string; functionCall?: { name?: string; args?: unknown } }[];
            };
          }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };

        const parts = payload.candidates?.[0]?.content?.parts ?? [];
        const toolCalls: ToolCall[] = parts.flatMap((part, index) =>
          part.functionCall?.name
            ? [
                {
                  id: `call_${index}`,
                  name: part.functionCall.name,
                  arguments:
                    part.functionCall.args && typeof part.functionCall.args === 'object'
                      ? (part.functionCall.args as Record<string, unknown>)
                      : {},
                },
              ]
            : [],
        );

        return {
          text: parts.map((p) => p.text ?? '').join(''),
          toolCalls,
          usage:
            payload.usageMetadata?.promptTokenCount === undefined
              ? null
              : {
                  promptTokens: payload.usageMetadata.promptTokenCount ?? 0,
                  completionTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
                },
          model,
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
