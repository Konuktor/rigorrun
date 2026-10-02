import { deepEqual, type PackMaterialization } from '@rigorrun/environment';
import type { HelpdeskClient } from './client.ts';
import { bindingsFor, buildWorld, parseRecipe } from './recipe.ts';

export const HELPDESK_SCOPE_DESCRIPTION =
  "the whole Larch Helpdesk twin, replaced with this case's world before the agent started";

export async function materializeHelpdeskCase(
  input: unknown,
  client: HelpdeskClient,
): Promise<PackMaterialization> {
  const recipe = parseRecipe(input);
  const world = buildWorld(recipe);
  await client.seed(world);
  const installed = await client.dump();
  if (!deepEqual(installed, world)) {
    throw new Error(
      'The Larch Helpdesk twin did not read back the complete world it was seeded with.',
    );
  }
  return {
    bindings: bindingsFor(installed, recipe.bind),
    scope: { description: HELPDESK_SCOPE_DESCRIPTION, data: null },
  };
}
