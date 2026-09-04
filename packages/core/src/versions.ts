/**
 * Schema version constants, kept dependency-free.
 *
 * The recorder extension needs these, and a browser content script should not
 * have to bundle a validation library to know what version it is writing.
 */
export const TRACE_SCHEMA_VERSION = 1;
export const CANONICAL_TRACE_SCHEMA_VERSION = 1;
export const CONTRACT_SCHEMA_VERSION = 1;
export const ENVIRONMENT_CONTRACT_SCHEMA_VERSION = 1;
export const BENCHMARK_SCHEMA_VERSION = 1;
export const RUN_SCHEMA_VERSION = 1;
