export * from './versions.ts';
export * from './hash.ts';
export * from './ids.ts';
export * from './logger.ts';
export * from './redaction.ts';
export * from './assertion.ts';
export * from './trace.ts';
export * from './canonicalTrace.ts';
export * from './traceNormalize.ts';
export * from './predicate.ts';
export * from './selector.ts';
export * from './environmentContract.ts';
export * from './benchmark.ts';
export * from './run.ts';
export * from './record.ts';

/**
 * The one version string.
 *
 * There were five: this one (imported by nothing), the CLI's `VERSION`, the MCP
 * client's `CLIENT_INFO`, the proxy's `PROXY_INFO` and the sandbox harness's
 * `HARNESS_VERSION`. Three of them still said 0.1.0 while 0.1.1 shipped, so a
 * server RigorRun connected to logged the wrong version and a verification
 * record recorded a harness that was never released. Kept in step with
 * package.json by `packages/cli/test/package.test.ts`.
 */
export const RIGORRUN_VERSION = '0.2.0';
