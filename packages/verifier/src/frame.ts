/**
 * `state_frame`: nothing changed beyond what the demonstration changed, for
 * every kind of record (audit IO-5).
 *
 * The frame is an upper bound per kind of record — how many were created,
 * deleted and changed, and which fields changed. More than that fails, whatever
 * the field's type. A field is set aside only when two readings with nothing in
 * between proved the reads change it. What the evidence cannot settle is not
 * checked: records appearing between two readings, changes to existing records
 * of a kind the demonstration never had, a kind of record the contract does not
 * know. Those make the check UNVERIFIABLE, so the case abstains rather than
 * passes — unless something else is clearly outside the frame, which fails.
 */
import {
  StateFrameExpectationSchema,
  type AssertionStatus,
  type FrameEntityObservation,
  type FrameObservation,
  type Observation,
} from '@rigorrun/core';
import { resolvePath } from './path.ts';

interface Outcome {
  status: AssertionStatus;
  observed: unknown;
  message: string;
}

interface Violation {
  entity: string;
  kind: 'created' | 'deleted' | 'updated_rows' | 'updated_field';
  key?: string;
  field?: string;
  observed: unknown;
  allowed: unknown;
}

interface Unverifiable {
  entity: string;
  kind: string;
  id: string;
}

const LIMIT = 20;

export function stateFrame(expected: unknown, observation: Observation): Outcome {
  const parsed = StateFrameExpectationSchema.safeParse(expected);
  if (!parsed.success) {
    return {
      status: 'ERROR',
      observed: null,
      message: `state_frame needs a mode, the job's record type and the demonstrated frame: ${parsed.error.issues[0]?.message ?? 'malformed'}`,
    };
  }
  const { mode, focusEntity, entities: allowed } = parsed.data;

  const resolved = resolvePath(observation, 'derived.frame');
  const seen = resolved.found ? (resolved.value as FrameObservation | undefined) : undefined;
  if (!seen || typeof seen !== 'object' || typeof seen.entities !== 'object' || seen.entities === null) {
    return {
      status: 'UNVERIFIABLE',
      observed: { violations: [], unverifiable: [{ entity: '', kind: 'frame', id: 'frame_evidence_missing' }], excludedVolatile: {} },
      message: `not checked: ${reason('frame_evidence_missing')}`,
    };
  }

  const violations: Violation[] = [];
  const unverifiable: Unverifiable[] = [];
  const excludedVolatile: Record<string, string[]> = {};
  const names = [...new Set([...Object.keys(allowed), ...Object.keys(seen.entities)])].sort();

  for (const name of names) {
    const now: FrameEntityObservation | undefined = seen.entities[name];
    if (!now) continue;
    const bound = allowed[name];

    const volatile = new Set(now.volatileFields ?? []);
    const setAside = new Set<string>();
    const updated = (now.updated ?? [])
      .map(({ key, fields }) => {
        for (const field of fields) if (volatile.has(field)) setAside.add(field);
        return { key, fields: fields.filter((field) => !volatile.has(field)) };
      })
      .filter((entry) => entry.fields.length > 0);
    if (setAside.size > 0) excludedVolatile[name] = [...setAside].sort();

    const created = now.created ?? [];
    const deleted = now.deleted ?? [];
    if (!bound) {
      if (created.length + deleted.length + updated.length > 0) {
        unverifiable.push({ entity: name, kind: 'entity', id: `frame_entity_not_in_contract:${name}` });
      }
      continue;
    }

    // Records of a kind the demonstration never had cannot show what the job
    // does to existing ones. A declined case is the exception for the job's own
    // kind: declining means changing none of them, whatever existed.
    const undemonstrated = bound.preExistingRows === 0 && (mode === 'performed' || name !== focusEntity)
      ? `frame_existing_rows_undemonstrated:${name}`
      : undefined;
    const unstable = now.membershipUnstable ? `frame_membership_unstable:${name}` : undefined;

    if (created.length > bound.created) {
      if (unstable) unverifiable.push({ entity: name, kind: 'created', id: unstable });
      else violations.push({ entity: name, kind: 'created', observed: created.length, allowed: bound.created });
    }
    if (deleted.length > bound.deleted) {
      const id = unstable ?? undemonstrated;
      if (id) unverifiable.push({ entity: name, kind: 'deleted', id });
      else violations.push({ entity: name, kind: 'deleted', observed: deleted.length, allowed: bound.deleted });
    }
    if (updated.length > bound.updatedRows) {
      if (undemonstrated) unverifiable.push({ entity: name, kind: 'updated_rows', id: undemonstrated });
      else violations.push({ entity: name, kind: 'updated_rows', observed: updated.length, allowed: bound.updatedRows });
    }
    const allowedFields = new Set(bound.updatedFields);
    for (const { key, fields } of updated) {
      for (const field of fields) {
        if (allowedFields.has(field)) continue;
        if (undemonstrated) {
          if (!unverifiable.some((entry) => entry.kind === 'updated_field' && entry.id === undemonstrated)) {
            unverifiable.push({ entity: name, kind: 'updated_field', id: undemonstrated });
          }
          continue;
        }
        violations.push({ entity: name, kind: 'updated_field', key, field, observed: 'changed', allowed: [...bound.updatedFields] });
      }
    }
  }

  const detail = {
    violations: violations.slice(0, LIMIT),
    unverifiable: unverifiable.slice(0, LIMIT),
    excludedVolatile,
  };
  if (violations.length > 0) {
    const shown = violations.slice(0, 5).map(describe).join('; ');
    const more = violations.length > 5 ? ` (and ${violations.length - 5} more)` : '';
    return { status: 'FAIL', observed: detail, message: `outside what the demonstration changed: ${shown}${more}` };
  }
  if (unverifiable.length > 0) {
    const reasons = [...new Set(unverifiable.map((entry) => reason(entry.id)))];
    return { status: 'UNVERIFIABLE', observed: detail, message: `not checked: ${reasons.join('; ')}` };
  }
  return { status: 'PASS', observed: detail, message: 'nothing changed beyond what the demonstration changed' };
}

function describe(violation: Violation): string {
  switch (violation.kind) {
    case 'created':
      return `${violation.observed} ${violation.entity} record(s) created, where the demonstration created ${violation.allowed}`;
    case 'deleted':
      return `${violation.observed} ${violation.entity} record(s) deleted, where the demonstration deleted ${violation.allowed}`;
    case 'updated_rows':
      return `${violation.observed} existing ${violation.entity} record(s) changed, where the demonstration changed ${violation.allowed}`;
    case 'updated_field':
      return `${violation.entity} ${violation.key}: ${violation.field} changed, which the demonstration never changed on a ${violation.entity}`;
  }
}

function reason(id: string): string {
  const [kind, entity] = [id.slice(0, id.indexOf(':') < 0 ? id.length : id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  switch (kind) {
    case 'frame_membership_unstable':
      return `${entity} records appeared or disappeared between two readings with nothing in between, so which were created or deleted by the agent cannot be told`;
    case 'frame_existing_rows_undemonstrated':
      return `the demonstration started with no ${entity} records, so it could not show whether this job changes existing ones`;
    case 'frame_entity_not_in_contract':
      return `${entity} records changed, and the contract does not know that kind of record`;
    default:
      return 'the readings that show what changed were not taken';
  }
}
