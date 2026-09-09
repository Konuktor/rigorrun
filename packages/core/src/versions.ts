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

/**
 * The verification record produced by `rigorrun verify`.
 *
 * Two identifiers for the same fact, because they have different audiences:
 * `rigorrun.record/1` is the string a consumer greps for, and this integer is
 * what our own parsing switches on.
 */
export const RECORD_SCHEMA_VERSION = 1;
