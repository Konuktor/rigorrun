/**
 * Provider selection.
 *
 * Returning `null` is the expected outcome on a machine with no keys, which is
 * the machine the demo is designed for. Callers degrade; they never throw.
 */
import { createOpenAiCompatibleProvider } from './openai.ts';
import { createGeminiProvider } from './gemini.ts';
import type { LlmProvider, ProviderEnv } from './types.ts';

export interface ProviderStatus {
  id: string;
  configured: boolean;
  detail: string;
}

export function resolveProvider(env: ProviderEnv = {}): LlmProvider | null {
  if (env.GROQ_API_KEY) {
    return createOpenAiCompatibleProvider({
      id: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || 'openai/gpt-oss-120b',
    });
  }
  if (env.GEMINI_API_KEY) {
    return createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL || 'gemini-2.0-flash');
  }
  if (env.OPENAI_COMPATIBLE_BASE_URL && env.OPENAI_COMPATIBLE_MODEL) {
    return createOpenAiCompatibleProvider({
      id: 'openai-compatible',
      name: 'OpenAI-compatible endpoint',
      baseUrl: env.OPENAI_COMPATIBLE_BASE_URL,
      apiKey: env.OPENAI_COMPATIBLE_API_KEY,
      model: env.OPENAI_COMPATIBLE_MODEL,
    });
  }
  return null;
}

/** Human-readable rundown for `rigorrun doctor` and the dashboard footer. */
export function providerStatuses(env: ProviderEnv = {}): ProviderStatus[] {
  return [
    {
      id: 'offline',
      configured: true,
      detail: 'always available — deterministic demo agents, no network, no key',
    },
    {
      id: 'groq',
      configured: Boolean(env.GROQ_API_KEY),
      detail: env.GROQ_API_KEY
        ? `configured (${env.GROQ_MODEL || 'openai/gpt-oss-120b'})`
        : 'set GROQ_API_KEY to enable',
    },
    {
      id: 'gemini',
      configured: Boolean(env.GEMINI_API_KEY),
      detail: env.GEMINI_API_KEY
        ? `configured (${env.GEMINI_MODEL || 'gemini-2.0-flash'})`
        : 'set GEMINI_API_KEY to enable',
    },
    {
      id: 'openai-compatible',
      configured: Boolean(env.OPENAI_COMPATIBLE_BASE_URL && env.OPENAI_COMPATIBLE_MODEL),
      detail:
        env.OPENAI_COMPATIBLE_BASE_URL && env.OPENAI_COMPATIBLE_MODEL
          ? `configured (${env.OPENAI_COMPATIBLE_MODEL})`
          : 'set OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL to enable',
    },
    {
      id: 'workers-ai',
      configured: false,
      detail: 'available inside a Cloudflare Worker that has an AI binding',
    },
  ];
}

/** Reads provider configuration from `process.env` when running under Node. */
export function envFromProcess(source: Record<string, string | undefined> = {}): ProviderEnv {
  return {
    GROQ_API_KEY: source['GROQ_API_KEY'],
    GROQ_MODEL: source['GROQ_MODEL'],
    GEMINI_API_KEY: source['GEMINI_API_KEY'],
    GEMINI_MODEL: source['GEMINI_MODEL'],
    OPENAI_COMPATIBLE_BASE_URL: source['OPENAI_COMPATIBLE_BASE_URL'],
    OPENAI_COMPATIBLE_API_KEY: source['OPENAI_COMPATIBLE_API_KEY'],
    OPENAI_COMPATIBLE_MODEL: source['OPENAI_COMPATIBLE_MODEL'],
  };
}
