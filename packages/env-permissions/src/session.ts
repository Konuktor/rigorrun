/**
 * One open session over a user's MCP server: two sides, each with its own
 * credential — the agent's (tenant A) and RigorRun's observer (tenant B) —
 * per PHASE-4-DESIGN.md D1–D4, D7.
 *
 * Per case: reset if the matrix names one; read A's records through A's side
 * and B's through B's; plant markers in B's records if the matrix says how;
 * pick the references a request names; compute B's fingerprints for the case.
 * Every read afterwards is A's and B's views again, plus the audit log.
 */
import type { ToolDescription } from '@rigorrun/core';
import type {
  ActionDefinition,
  ActionParam,
  ActionResult,
  CanonicalState,
  PackCaseContext,
  PackMaterialization,
  PackScope,
  PackSession,
  SafetyMode,
} from '@rigorrun/environment';
import { fingerprintBindings, fingerprints } from './fingerprints.ts';
import {
  auditRows,
  at,
  canonicalState,
  snapshot,
  type SnapshotRow,
  type ToolCaller,
} from './snapshot.ts';
import type { PermissionsSpec } from './spec.ts';
import type { PermissionRecipe } from './suite.ts';

/** A tool as the server lists it (MCP `tools/list`). */
export interface ServerTool {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, { type?: unknown; enum?: unknown; description?: unknown }>;
    required?: unknown;
  };
  annotations?: { readOnlyHint?: boolean };
}

/** One side of the server: calls made with that side's credential. */
export interface Side {
  call: ToolCaller;
  tools(): Promise<ServerTool[]>;
  close(): Promise<void>;
}

export interface PermissionsSessionOptions {
  spec: PermissionsSpec;
  /** The credential a proxied agent's calls are forwarded with (tenant A's, or whatever the agent really uses). */
  agent: Side;
  /**
   * RigorRun's own read of tenant A's records. Defaults to `agent`. Give it a
   * key of its own when the agent's is broader than A (a service key): reads
   * made with the agent's own key cannot be told apart from the agent's in an
   * audit log.
   */
  reader?: Side;
  /** RigorRun's own credential for tenant B: seeds and reads B. */
  observer: Side;
  /** The audit log's raw JSON, when the matrix names an audit source. */
  readAudit?: () => Promise<unknown>;
  reset?: { tool: string; args: Record<string, unknown> };
  system: string;
  safety: SafetyMode;
}

function paramType(type: unknown, hasEnum: boolean): ActionParam['type'] {
  if (hasEnum) return 'enum';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'string';
}

export function actionFromTool(tool: ServerTool): ActionDefinition {
  const properties = tool.inputSchema?.properties ?? {};
  const required = Array.isArray(tool.inputSchema?.required)
    ? (tool.inputSchema.required as string[])
    : [];
  const readOnly = tool.annotations?.readOnlyHint === true;
  return {
    name: tool.name,
    description: tool.description ?? '',
    params: Object.entries(properties).map(([name, prop]) => {
      const values = Array.isArray(prop.enum) ? prop.enum.map(String) : undefined;
      return {
        name,
        type: paramType(prop.type, values !== undefined),
        required: required.includes(name),
        ...(values ? { enumValues: values } : {}),
        ...(typeof prop.description === 'string' ? { description: prop.description } : {}),
      };
    }),
    mutates: readOnly ? [] : ['Row'],
    readOnly,
    enforcement: 'none',
  };
}

export function toolDescription(action: ActionDefinition): ToolDescription {
  return {
    name: action.name,
    description: action.description,
    readOnly: action.readOnly,
    params: action.params.map((param) => ({
      name: param.name,
      type: param.type === 'timestamp' ? 'timestamp' : param.type,
      required: param.required,
      ...(param.enumValues ? { enumValues: [...param.enumValues] } : {}),
      description: param.description ?? '',
    })),
  };
}

function owned(rows: SnapshotRow[], owner: string): SnapshotRow[] {
  return rows.filter((row) => row.owner === owner);
}

function firstOf(rows: SnapshotRow[], entity: string): SnapshotRow | undefined {
  return rows
    .filter((row) => row.entity === entity)
    .sort((x, y) => (x.rowId < y.rowId ? -1 : 1))[0];
}

function value(row: SnapshotRow | undefined, field: string, what: string): string {
  const found = row ? at(row.row, field) : undefined;
  if (typeof found !== 'string' && typeof found !== 'number') {
    throw new Error(`No ${what} to use in a request: the read found no row with "${field}".`);
  }
  return String(found);
}

function fill(template: unknown, values: Record<string, string>): unknown {
  if (typeof template === 'string') {
    return template.replace(/\{\{([a-z_.]+)\}\}/g, (token, name: string) => values[name] ?? token);
  }
  if (Array.isArray(template)) return template.map((item) => fill(item, values));
  if (template && typeof template === 'object') {
    return Object.fromEntries(
      Object.entries(template).map(([key, item]) => [key, fill(item, values)]),
    );
  }
  return template;
}

export async function openPermissionsSession(
  options: PermissionsSessionOptions,
): Promise<PackSession> {
  const { spec, agent, observer } = options;
  const reader = options.reader ?? agent;
  const actions = (await agent.tools()).map(actionFromTool);

  const sides = async (): Promise<{ a: SnapshotRow[]; b: SnapshotRow[] }> => ({
    a: owned(await snapshot(reader.call, spec.reads, spec.tenant.field), spec.tenant.a),
    b: owned(await snapshot(observer.call, spec.reads, spec.tenant.field), spec.tenant.b),
  });

  const audit = async () =>
    spec.audit && options.readAudit
      ? auditRows(await options.readAudit(), {
          rows: spec.audit.rows,
          ownerField: spec.audit.owner_field,
          actorField: spec.audit.actor_field,
        })
      : [];

  return {
    system: options.system,
    safety: options.safety,
    simulated: false,
    isolation: options.reset ? 'replaced-world' : 'shared-world',
    completeRead: false,

    async materialize(recipe: unknown, ctx: PackCaseContext): Promise<PackMaterialization> {
      const parsed = recipe as PermissionRecipe;
      if (!parsed || typeof parsed.message !== 'string' || typeof parsed.kind !== 'string') {
        throw new Error('A permissions case needs a recipe with its kind and its request.');
      }
      if (options.reset) await observer.call(options.reset.tool, options.reset.args);
      const first = await sides();
      const a = first.a;
      let b = first.b;
      const markers: string[] = [];
      if (spec.plant) {
        const marker = `RR-MARK-${ctx.caseId}-${ctx.attempt}`.toUpperCase();
        const values: Record<string, string> = { marker };
        for (const row of b) {
          for (const [field, fieldValue] of Object.entries(row.row)) {
            const key = `b.${row.entity}.${field}`;
            if (
              !(key in values) &&
              (typeof fieldValue === 'string' || typeof fieldValue === 'number')
            ) {
              values[key] = String(fieldValue);
            }
          }
        }
        await observer.call(
          spec.plant.tool,
          fill(spec.plant.args, values) as Record<string, unknown>,
        );
        markers.push(marker);
        b = (await sides()).b;
      }
      const references = {
        a_ref: value(
          firstOf(a, spec.reference.entity),
          spec.reference.field,
          `${spec.tenant.a} reference`,
        ),
        b_ref: value(
          firstOf(b, spec.reference.entity),
          spec.reference.field,
          `${spec.tenant.b} reference`,
        ),
        a_person: value(
          firstOf(a, spec.person.entity),
          spec.person.name_field,
          `${spec.tenant.a} person`,
        ),
        b_person: value(
          firstOf(b, spec.person.entity),
          spec.person.name_field,
          `${spec.tenant.b} person`,
        ),
      };
      const request = fill(
        parsed.message.replace(/\{\{bind:([a-z_]+)\}\}/g, '{{$1}}'),
        references,
      ) as string;
      const prints = fingerprints(b, a, spec.fingerprint_fields, [request], markers);
      return {
        bindings: { ...references, ...fingerprintBindings(prints) },
        scope: {
          description: `What ${spec.tenant.a}'s and ${spec.tenant.b}'s read tools show (${spec.reads
            .map((read) => read.tool)
            .join(', ')})${spec.audit ? ', and the audit log' : ''}.`,
          data: { fingerprints: prints.length },
        },
      };
    },

    async read(scope: PackScope | null): Promise<CanonicalState> {
      if (scope === null) return canonicalState([], []);
      const { a, b } = await sides();
      return canonicalState([...a, ...b], await audit());
    },

    reality(seed: CanonicalState, final: CanonicalState): string[] {
      const before = seed.entities['Row'] ?? {};
      const after = final.entities['Row'] ?? {};
      const lines: string[] = [];
      for (const [key, row] of Object.entries(after)) {
        const was = before[key];
        if (!was) lines.push(`Created ${key} (owner ${String(row['owner'])}).`);
        else if (was['digest'] !== row['digest'])
          lines.push(`Changed ${key} (owner ${String(row['owner'])}).`);
      }
      for (const [key, row] of Object.entries(before)) {
        if (!after[key]) lines.push(`Deleted ${key} (owner ${String(row['owner'])}).`);
      }
      const seen = new Set(Object.keys(seed.entities['Audit'] ?? {}));
      const touched = Object.entries(final.entities['Audit'] ?? {}).filter(
        ([key, row]) =>
          !seen.has(key) &&
          row['owner'] === spec.tenant.b &&
          row['actor'] !== spec.audit?.observer_actor,
      );
      if (touched.length > 0)
        lines.push(`The audit log shows ${touched.length} ${spec.tenant.b} record(s) touched.`);
      return lines.length > 0
        ? lines
        : [`Nothing of ${spec.tenant.a}'s or ${spec.tenant.b}'s that the reads show changed.`];
    },

    actions(): ActionDefinition[] {
      return actions;
    },

    async execute(name: string, args: Record<string, unknown>): Promise<ActionResult> {
      try {
        return { ok: true, data: await agent.call(name, args) };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'CALL_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },

    async close(): Promise<void> {
      await Promise.allSettled([
        agent.close(),
        observer.close(),
        ...(reader === agent ? [] : [reader.close()]),
      ]);
    },
  };
}
