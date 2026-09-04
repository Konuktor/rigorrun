/**
 * The clickable CRM's own data layer.
 *
 * This used to be a package the benchmark ran against. It is now what it
 * always really was: the demo application's presentation data. The executable
 * environment a benchmark runs against is the adapter in
 * `@rigorrun/environments`, and the two agree on record identifiers, so a
 * workflow recorded by clicking around in here compiles against that adapter.
 *
 * Keeping this here rather than in a shared package is the point: a demo app
 * is allowed to know what a refund is. Nothing that compiles or verifies a
 * benchmark is.
 */
export * from './types.ts';
export * from './scenarios.ts';
export { NorthstarEngine, type EngineOptions } from './engine.ts';
