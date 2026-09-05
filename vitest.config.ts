import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@rigorrun/connector': r('./packages/connector/src/index.ts'),
      '@rigorrun/env-openapi': r('./packages/env-openapi/src/index.ts'),
      '@rigorrun/env-browser': r('./packages/env-browser/src/index.ts'),
      '@rigorrun/trace-import': r('./packages/trace-import/src/index.ts'),
      '@rigorrun/core': r('./packages/core/src/index.ts'),
      '@rigorrun/environment': r('./packages/environment/src/index.ts'),
      '@rigorrun/environments': r('./packages/environments/src/index.ts'),
      '@rigorrun/quality': r('./packages/quality/src/index.ts'),
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
    env: {
      // Never the real one. A test run must not write probe entries into the
      // keychain of whoever is running it, and CI has no keyring daemon
      // anyway. The keychain backends have their own test, which fakes the
      // tools rather than using them.
      RIGORRUN_SECRET_BACKEND: 'file',
    },
  },
});
