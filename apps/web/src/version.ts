/**
 * The published version, injected at build time from the CLI manifest.
 *
 * Three components used to render the literal "v0.1". The product was 0.1.1,
 * so the site was wrong everywhere it said so, and nothing could have caught
 * it because there was nothing to compare against.
 */
declare const __RIGORRUN_VERSION__: string;

export const RIGORRUN_VERSION: string =
  typeof __RIGORRUN_VERSION__ === 'string' ? __RIGORRUN_VERSION__ : '0.0.0';

/** "Early Access · v0.2.0", in the one place that decides how it is written. */
export const RELEASE_LABEL = `Early Access · v${RIGORRUN_VERSION}`;
