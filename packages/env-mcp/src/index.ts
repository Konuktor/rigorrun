/**
 * The MCP way into a system.
 *
 * Almost nothing is left here. The adapter that turns a live connection into an
 * environment moved to `@rigorrun/connector` when it became clear it had never
 * been about MCP — it uses what operations exist and how to call one, and
 * nothing else. `McpEnvironment` is the same class under its old name so that
 * existing callers do not move with it.
 */
export {
  SystemEnvironment,
  SystemEnvironment as McpEnvironment,
  rowsFromPayload,
  stateFromPayloads,
  type SystemEnvironmentConfig,
  type SystemEnvironmentConfig as McpEnvironmentConfig,
  type ResetStrategy,
  type VerifierRead,
} from '@rigorrun/connector';
