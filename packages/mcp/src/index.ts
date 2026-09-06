/**
 * The MCP connector.
 *
 * The first three lines are re-exports rather than definitions: `jsonSchema`,
 * `risk` and the discovery types moved to `@rigorrun/connector` when a second
 * connector became possible, because none of them were ever about MCP. They are
 * still exported from here so that every existing import keeps working — a
 * package boundary moving is not a reason for a hundred files to change.
 */
export type {
  CallResult,
  ConvertedParams,
  DiscoveredTool,
  DiscoveryResult,
  RiskAssessment,
  RiskLevel,
  RiskSource,
  ServerHints,
  SystemConnection,
  UnsupportedParam,
} from '@rigorrun/connector';
export {
  SCHEMA_LIMITS,
  assessFromHints,
  detectMismatch,
  isConfirmedReadOnly,
  mayMutate,
  paramsFromInputSchema,
  readServerHints,
} from '@rigorrun/connector';

export * from './config.ts';
export * from './client.ts';
export * from './oauth.ts';
export * from './induceSchema.ts';
