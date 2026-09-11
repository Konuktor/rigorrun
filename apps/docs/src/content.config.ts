/**
 * Astro 5 reads this from `src/`, not `src/content/`. It was in the v4
 * location, so it was never loaded — the only thing it did was break the root
 * typecheck by importing a virtual module `tsc` cannot resolve.
 */
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema(),
  }),
};
