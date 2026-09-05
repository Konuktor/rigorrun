export * from './types.ts';
export { createLlmAgent, type LlmAgentConfig } from './llmAgent.ts';
export { createHttpAgent, assertSafeAgentUrl, type HttpAgentConfig } from './http.ts';
/**
 * Everything here must be safe to bundle for a browser.
 *
 * The offline example runs the real pipeline in the page, so this barrel ends
 * up in the web bundle. The adapter that drives an external agent lives in
 * `@rigorrun/daemon` instead, because it publishes an MCP proxy session and so
 * pulls in a Node HTTP server — putting it here shipped 190KB of
 * `@hono/node-server` to the browser and produced a blank page.
 */
export {
  BUILT_IN_AGENTS,
  builtInAgent,
  availableAgents,
  resolveAgent,
  type AgentRegistryOptions,
} from './registry.ts';
export * from './generic.ts';
