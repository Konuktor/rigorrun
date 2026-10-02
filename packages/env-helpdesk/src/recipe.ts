import { z } from 'zod';
import { defaultSeed, type HelpdeskState } from './twin/seed.ts';

const customerSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    name: z.string(),
    email: z.string(),
    notes: z.string(),
  })
  .strict();

const orderSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    customer_id: z.string(),
    ref: z.string(),
    amount_cents: z.number().int().nonnegative(),
    refunded_cents: z.number().int().nonnegative(),
    status: z.enum(['paid', 'partially_refunded', 'refunded']),
  })
  .strict();

const ticketSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    customer_id: z.string(),
    subject: z.string(),
    body: z.string(),
    status: z.enum(['open', 'closed']),
    notes: z.array(z.string()),
  })
  .strict();

export const WORLD_TABLES = [
  'orgs',
  'customers',
  'orders',
  'tickets',
  'refunds',
  'outbox',
  'access_log',
  'tokens',
] as const;

const bindingSchema = z
  .object({ table: z.enum(WORLD_TABLES), id: z.string(), field: z.string() })
  .strict();

export const RecipeSchema = z
  .object({
    world: z.literal('default').optional(),
    add: z
      .object({
        customers: z.array(customerSchema).optional(),
        orders: z.array(orderSchema).optional(),
        tickets: z.array(ticketSchema).optional(),
      })
      .strict()
      .optional(),
    bind: z.record(z.string(), bindingSchema),
  })
  .strict();

export type HelpdeskRecipe = z.infer<typeof RecipeSchema>;
export type HelpdeskRecipeInput = z.input<typeof RecipeSchema>;
export type HelpdeskBindings = HelpdeskRecipe['bind'];

export function parseRecipe(input: unknown): HelpdeskRecipe {
  return RecipeSchema.parse(input);
}

/** Builds the exact complete state installed before one case. */
export function buildWorld(recipe: HelpdeskRecipe): HelpdeskState {
  const world = defaultSeed();
  world.outbox = [];
  world.access_log = [];

  const additions = [
    ...(recipe.add?.customers ?? []),
    ...(recipe.add?.orders ?? []),
    ...(recipe.add?.tickets ?? []),
  ];
  const ids = new Set(
    [
      ...world.orgs,
      ...world.customers,
      ...world.orders,
      ...world.tickets,
      ...world.refunds,
      ...world.outbox,
    ].map((row) => row.id),
  );
  for (const row of additions) {
    if (ids.has(row.id)) throw new Error(`The helpdesk recipe adds the duplicate id "${row.id}".`);
    ids.add(row.id);
  }

  world.customers.push(...(recipe.add?.customers ?? []));
  world.orders.push(...(recipe.add?.orders ?? []));
  world.tickets.push(...(recipe.add?.tickets ?? []));
  return world;
}

/** Resolves names used in case text and checks against the installed world. */
export function bindingsFor(
  world: HelpdeskState,
  bindings: HelpdeskBindings,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, binding] of Object.entries(bindings)) {
    const rows = world[binding.table] as unknown as Array<Record<string, unknown>>;
    const row = rows.find((candidate) => rowId(binding.table, candidate) === binding.id);
    if (!row) {
      throw new Error(`Binding "${name}" names missing row ${binding.table}.${binding.id}.`);
    }
    if (!Object.prototype.hasOwnProperty.call(row, binding.field)) {
      throw new Error(
        `Binding "${name}" names missing field ${binding.table}.${binding.id}.${binding.field}.`,
      );
    }
    resolved[name] = String(row[binding.field]);
  }
  return resolved;
}

function rowId(table: (typeof WORLD_TABLES)[number], row: Record<string, unknown>): string {
  if (table === 'access_log') return `log_${String(row['seq'])}`;
  if (table === 'tokens') return String(row['token']);
  return String(row['id']);
}
