/**
 * Shared Vite configuration for both apps.
 *
 * The workspace packages are consumed straight from TypeScript source via
 * aliases. That keeps a single source of truth: the benchmark that runs in the
 * browser is byte-for-byte the same code the CLI and CI run.
 */
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import type { UserConfig } from 'vite';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export const rigorrunAliases = {
  '@rigorrun/core': pkg('core'),
  '@rigorrun/environment': pkg('environment'),
  '@rigorrun/environments': pkg('environments'),
  '@rigorrun/quality': pkg('quality'),
  '@rigorrun/verifier': pkg('verifier'),
  '@rigorrun/generator': pkg('generator'),
  '@rigorrun/scoring': pkg('scoring'),
  '@rigorrun/agents': pkg('agents'),
  '@rigorrun/providers': pkg('providers'),
  '@rigorrun/runner': pkg('runner'),
  '@rigorrun/report': pkg('report'),
  '@rigorrun/compiler': pkg('compiler'),
};

export function sharedConfig(): UserConfig {
  return {
    plugins: [react(), tailwind()],
    resolve: { alias: rigorrunAliases },
    build: { target: 'es2022', sourcemap: false },
  };
}
