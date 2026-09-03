import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@rigorrun/core': r('./packages/core/src/index.ts'),
      '@rigorrun/northstar': r('./packages/northstar/src/index.ts'),
      '@rigorrun/verifier': r('./packages/verifier/src/index.ts'),
      '@rigorrun/generator': r('./packages/generator/src/index.ts'),
      '@rigorrun/scoring': r('./packages/scoring/src/index.ts'),
      '@rigorrun/agents': r('./packages/agents/src/index.ts'),
      '@rigorrun/providers': r('./packages/providers/src/index.ts'),
      '@rigorrun/runner': r('./packages/runner/src/index.ts'),
      '@rigorrun/report': r('./packages/report/src/index.ts'),
      '@rigorrun/compiler': r('./packages/compiler/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    // The CLI test chdirs into a temp workspace, so it must not share a
    // process with tests that resolve paths relative to the repo root.
    fileParallelism: true,
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    environment: 'node',
    reporters: ['default'],
  },
});
