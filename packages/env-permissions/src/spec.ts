/**
 * The part of a confirmed permission matrix the suite and the session use.
 * Kept narrow so the compiler does not depend on how the matrix file is laid
 * out; `specFromMatrix` maps a parsed matrix onto it.
 */
import type { PermissionMatrix } from './matrix.ts';
import type { ReadSpec } from './snapshot.ts';

export interface PermissionsSpec {
  tenant: { field: string; a: string; b: string; label: string };
  labels: { record: string; person: string };
  /** Read tools, called with each side's credential, that show that side's records. */
  reads: ReadSpec[];
  /** Which entity's which field a request uses to refer to a record. */
  reference: { entity: string; field: string };
  /** Which entity holds people, and the field with their name. */
  person: { entity: string; name_field: string };
  fingerprint_fields: string[];
  plant?: { tool: string; args: Record<string, unknown> };
  audit?: { rows: string; owner_field: string; actor_field: string; observer_actor: string };
  sinks?: { tool: string; recipient_arg: string }[];
  forbidden?: { tool: string; ask: string }[];
  outside_address: string;
  /** What the agent is told it may and may not do, one line each. */
  policy: string[];
  /** The agent's role, as the principal names it. */
  role?: string;
}

/** The confirmed matrix, as the suite and the session use it. */
export function specFromMatrix(matrix: PermissionMatrix): PermissionsSpec {
  return {
    tenant: { ...matrix.tenant },
    labels: { ...matrix.labels },
    reads: matrix.reads.map((read) => ({
      tool: read.tool,
      args: { ...read.args },
      rows: read.rows,
      entity: read.entity,
      ...(read.for_each ? { for_each: { ...read.for_each } } : {}),
    })),
    reference: { ...matrix.reference },
    person: { ...matrix.person },
    fingerprint_fields: [...matrix.fingerprint_fields],
    ...(matrix.plant ? { plant: { tool: matrix.plant.tool, args: { ...matrix.plant.args } } } : {}),
    ...(matrix.audit
      ? {
          audit: {
            rows: matrix.audit.rows,
            owner_field: matrix.audit.owner_field,
            actor_field: matrix.audit.actor_field,
            observer_actor: matrix.audit.observer_actor,
          },
        }
      : {}),
    ...(matrix.sinks ? { sinks: matrix.sinks.map((sink) => ({ ...sink })) } : {}),
    ...(matrix.forbidden ? { forbidden: matrix.forbidden.map((entry) => ({ ...entry })) } : {}),
    outside_address: matrix.outside_address,
    policy: [...matrix.policy],
    ...(matrix.role ? { role: matrix.role } : {}),
  };
}
