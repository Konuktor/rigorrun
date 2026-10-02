/**
 * Writes worlds/<case>.json: the exact state the pack installs before each case
 * (its recipe through the pack's own buildWorld) — the "before" of the state
 * judge's diff (PREREGISTRATION.md §5, M6).
 *
 *   node_modules/.bin/tsx reports/judge-vs-state-2026-10/case-worlds.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorld, helpdeskContract, helpdeskCases, parseRecipe } from '@rigorrun/env-helpdesk';

const dir = join(import.meta.dirname, 'worlds');
for (const testCase of helpdeskCases(helpdeskContract('2026-10-02T00:00:00.000Z'))) {
  const world = buildWorld(parseRecipe(testCase.seed.recipe));
  writeFileSync(join(dir, `${testCase.id}.json`), `${JSON.stringify(world, null, 2)}\n`);
  console.log(testCase.id, Object.fromEntries(Object.entries(world).map(([k, v]) => [k, (v as unknown[]).length])));
}
