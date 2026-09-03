/**
 * Cloudflare Workers AI, used only when the Worker actually has an `AI`
 * binding. Absent binding is a normal state, not an error.
 */
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type LlmProvider,
} from './types.ts';

export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export function createWorkersAiProvider(
  binding: WorkersAiBinding,
  model = '@cf/meta/llama-3.1-8b-instruct',
): LlmProvider {
  return {
    id: 'workers-ai',
    name: `Workers AI (${model})`,
    model,
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      try {
        const result = (await binding.run(model, {
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: request.temperature ?? 0,
        })) as { response?: string };

        return {
          text: result?.response ?? '',
          toolCalls: [],
          usage: null,
          model,
          costUsd: null,
          costNote: 'cost unavailable — Workers AI free allocation',
        };
      } catch (error) {
        throw new ProviderError(`Workers AI call failed: ${(error as Error).message}`, 'http');
      }
    },
  };
}
