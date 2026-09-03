/**
 * Agent registry.
 *
 * The two demo agents are always present so `rigorrun demo` works on a machine
 * with no keys, no network and no configuration.
 */
import { resolveProvider, type ProviderEnv } from '@rigorrun/providers';
import { demoWeakAgent } from './demoWeak.ts';
import { demoRobustAgent } from './demoRobust.ts';
import { createLlmAgent } from './llmAgent.ts';
import { createHttpAgent, type HttpAgentConfig } from './http.ts';
import type { AgentAdapter } from './types.ts';

export const BUILT_IN_AGENTS: AgentAdapter[] = [demoWeakAgent, demoRobustAgent];

export function builtInAgent(id: string): AgentAdapter | undefined {
  return BUILT_IN_AGENTS.find((agent) => agent.id === id);
}

export interface AgentRegistryOptions {
  env?: ProviderEnv;
  httpAgents?: HttpAgentConfig[];
}

/** Every agent available in the current environment. */
export function availableAgents(options: AgentRegistryOptions = {}): AgentAdapter[] {
  const agents = [...BUILT_IN_AGENTS];

  const provider = resolveProvider(options.env ?? {});
  if (provider) {
    agents.push(
      createLlmAgent({ id: `llm-${provider.id}`, name: `${provider.name} agent`, provider }),
    );
  }

  for (const config of options.httpAgents ?? []) {
    agents.push(createHttpAgent(config));
  }

  return agents;
}

export function resolveAgent(id: string, options: AgentRegistryOptions = {}): AgentAdapter {
  const found = availableAgents(options).find((agent) => agent.id === id);
  if (!found) {
    const known = availableAgents(options)
      .map((a) => a.id)
      .join(', ');
    throw new Error(`Unknown agent "${id}". Available: ${known}`);
  }
  return found;
}
