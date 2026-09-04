/**
 * The adapter conformance kit.
 *
 * "Bring your own environment" is only a real claim if a third-party adapter
 * either works or says why it does not. A mis-annotated `role`, a fixture that
 * violates its own schema, or a `snapshot`/`restore` pair that quietly loses a
 * field corrupts thresholds, boundaries and expected outcomes at once — and it
 * does so on somebody else's machine, in a domain this codebase has never
 * seen. So the checks live here, ship with the SDK, and run in CI for every
 * environment RigorRun itself provides.
 */
import { canonicalJson } from '@rigorrun/core';
import type { EnvironmentAdapter, EnvironmentFixture } from './adapter.ts';
import { validateSchema, type EntitySchema, type EnvironmentSchema } from './schema.ts';
import { cloneState, deepEqual, rowById, type CanonicalState } from './state.ts';

export interface ConformanceProblem {
  check: string;
  message: string;
}

export interface ConformanceOptions {
  /**
   * An optional action sequence used to check that execution is deterministic.
   * Without it the kit still checks seeding, purity and snapshot fidelity.
   */
  probe?: readonly { action: string; args: Record<string, unknown> }[];
}

export async function validateAdapter(
  create: () => EnvironmentAdapter,
  fixtures: readonly EnvironmentFixture[],
  options: ConformanceOptions = {},
): Promise<ConformanceProblem[]> {
  const problems: ConformanceProblem[] = [];
  const adapter = create();
  const schema = adapter.describeEntities();

  for (const problem of validateSchema(schema)) {
    problems.push({ check: 'schema', message: `${problem.path}: ${problem.message}` });
  }

  problems.push(...checkActions(adapter, schema));
  problems.push(...checkPresentation(adapter, schema));

  for (const fixture of fixtures) {
    problems.push(...checkFixture(schema, fixture));
  }

  const fixture = fixtures[0];
  if (!fixture) {
    problems.push({ check: 'fixtures', message: 'the environment ships no fixture to check' });
    return problems;
  }

  // --- seeding round trip -------------------------------------------------
  await adapter.reset();
  await adapter.seed(fixture.state, fixture.config);
  const seeded = await adapter.getState();
  for (const entity of schema.entities) {
    const expected = fixture.state.entities[entity.name] ?? {};
    const actual = seeded.entities[entity.name] ?? {};
    for (const id of Object.keys(expected)) {
      if (!deepEqual(expected[id], actual[id])) {
        problems.push({
          check: 'seed-round-trip',
          message: `${entity.name}/${id} did not survive seed → getState unchanged`,
        });
      }
    }
  }

  // --- getState purity ----------------------------------------------------
  const first = await adapter.getState();
  const firstJson = canonicalJson(first);
  mutateDeeply(first);
  const second = await adapter.getState();
  if (canonicalJson(second) !== firstJson) {
    problems.push({
      check: 'getState-purity',
      message: 'mutating the value returned by getState() changed the environment',
    });
  }

  // --- snapshot / restore fidelity ---------------------------------------
  const snapshot = await adapter.snapshot();
  const beforeJson = canonicalJson(await adapter.getState());
  for (const action of adapter.getActions().filter((candidate) => !candidate.readOnly)) {
    // Fire it with no arguments; a well-behaved adapter refuses rather than
    // throwing, and either way the state must be restorable afterwards.
    try {
      await adapter.executeAction(action.name, {});
    } catch (error) {
      problems.push({
        check: 'execute-throws',
        message: `${action.name} threw instead of returning an error result: ${(error as Error).message}`,
      });
    }
  }
  await adapter.restore(snapshot);
  if (canonicalJson(await adapter.getState()) !== beforeJson) {
    problems.push({
      check: 'snapshot-restore',
      message: 'restore() did not return the environment to its snapshotted state',
    });
  }

  // --- determinism --------------------------------------------------------
  const runOnce = async (): Promise<string> => {
    const instance = create();
    await instance.reset();
    await instance.seed(fixture.state, fixture.config);
    for (const step of options.probe ?? []) {
      await instance.executeAction(step.action, step.args);
    }
    return canonicalJson({
      state: await instance.getState(),
      events: await instance.getEvents(),
    });
  };
  if ((await runOnce()) !== (await runOnce())) {
    problems.push({
      check: 'determinism',
      message: 'the same seed and the same action sequence produced two different worlds',
    });
  }

  // --- declared mutations match observed ones -----------------------------
  if (options.probe) {
    for (const step of options.probe) {
      const definition = adapter.getActions().find((a) => a.name === step.action);
      if (!definition) continue;
      const instance = create();
      await instance.reset();
      await instance.seed(fixture.state, fixture.config);
      const before = await instance.getState();
      await instance.executeAction(step.action, step.args);
      const after = await instance.getState();
      for (const entity of schema.entities) {
        const changed = !deepEqual(before.entities[entity.name], after.entities[entity.name]);
        if (changed && !definition.mutates.includes(entity.name)) {
          problems.push({
            check: 'declared-mutations',
            message: `${step.action} changed ${entity.name}, which it does not declare in mutates`,
          });
        }
      }
    }
  }

  return problems;
}

function checkActions(adapter: EnvironmentAdapter, schema: EnvironmentSchema): ConformanceProblem[] {
  const problems: ConformanceProblem[] = [];
  const names = new Set(schema.entities.map((entity) => entity.name));
  const seen = new Set<string>();

  for (const action of adapter.getActions()) {
    if (seen.has(action.name)) {
      problems.push({ check: 'actions', message: `duplicate action name "${action.name}"` });
    }
    seen.add(action.name);

    for (const entity of action.mutates) {
      if (!names.has(entity)) {
        problems.push({
          check: 'actions',
          message: `${action.name} declares it mutates unknown entity "${entity}"`,
        });
      }
    }
    if (action.readOnly && action.mutates.length > 0) {
      problems.push({
        check: 'actions',
        message: `${action.name} is readOnly but declares mutations`,
      });
    }
    for (const param of action.params) {
      if (param.entityRef !== undefined && !names.has(param.entityRef)) {
        problems.push({
          check: 'actions',
          message: `${action.name}.${param.name} references unknown entity "${param.entityRef}"`,
        });
      }
      if (param.type === 'enum' && (param.enumValues ?? []).length === 0) {
        problems.push({
          check: 'actions',
          message: `${action.name}.${param.name} is an enum with no values`,
        });
      }
    }
  }

  if (adapter.getActions().every((action) => action.readOnly)) {
    problems.push({
      check: 'actions',
      message: 'the environment declares no mutating action, so no work can be demonstrated',
    });
  }
  return problems;
}

function checkPresentation(
  adapter: EnvironmentAdapter,
  schema: EnvironmentSchema,
): ConformanceProblem[] {
  const problems: ConformanceProblem[] = [];
  const names = new Set(schema.entities.map((entity) => entity.name));
  const hints = adapter.describePresentation();
  for (const entity of hints.navEntities) {
    if (!names.has(entity)) {
      problems.push({ check: 'presentation', message: `navEntities names unknown "${entity}"` });
    }
  }
  if (!names.has(hints.focusEntity)) {
    problems.push({
      check: 'presentation',
      message: `focusEntity "${hints.focusEntity}" is not a declared entity`,
    });
  }
  return problems;
}

function checkFixture(
  schema: EnvironmentSchema,
  fixture: EnvironmentFixture,
): ConformanceProblem[] {
  const problems: ConformanceProblem[] = [];
  const where = `fixture ${fixture.id}`;

  for (const [entityName, table] of Object.entries(fixture.state.entities)) {
    const entity = schema.entities.find((candidate) => candidate.name === entityName);
    if (!entity) {
      problems.push({ check: 'fixture', message: `${where}: unknown entity "${entityName}"` });
      continue;
    }
    for (const [id, row] of Object.entries(table)) {
      problems.push(...checkRow(entity, id, row, where));
    }
  }

  for (const relationship of schema.relationships) {
    if (relationship.via.kind !== 'fk') continue;
    // The key lives on whichever side has many rows, and points at the other.
    const holder = relationship.cardinality === 'one' ? relationship.from : relationship.to;
    const points = relationship.cardinality === 'one' ? relationship.to : relationship.from;
    const table = fixture.state.entities[holder] ?? {};
    for (const [id, row] of Object.entries(table)) {
      const value = row[relationship.via.field];
      if (value === null || value === undefined) {
        if (relationship.required && relationship.cardinality === 'one') {
          problems.push({
            check: 'fixture',
            message: `${where}: ${holder}/${id} has no ${relationship.via.field} but the relationship is required`,
          });
        }
        continue;
      }
      if (rowById(fixture.state, points, value) === undefined) {
        problems.push({
          check: 'fixture',
          message: `${where}: ${holder}/${id}.${relationship.via.field} points at a ${points} that does not exist`,
        });
      }
    }
  }

  return problems;
}

function checkRow(
  entity: EntitySchema,
  id: string,
  row: Record<string, unknown>,
  where: string,
): ConformanceProblem[] {
  const problems: ConformanceProblem[] = [];
  if (String(row[entity.idField]) !== id) {
    problems.push({
      check: 'fixture',
      message: `${where}: ${entity.name} is keyed "${id}" but its ${entity.idField} says "${String(row[entity.idField])}"`,
    });
  }
  for (const field of entity.fields) {
    const value = row[field.name];
    if (value === undefined || value === null) {
      if (!field.nullable && field.name !== entity.idField) {
        problems.push({
          check: 'fixture',
          message: `${where}: ${entity.name}/${id}.${field.name} is null but the field is not nullable`,
        });
      }
      continue;
    }
    if (field.type === 'enum' && !(field.enumValues ?? []).includes(String(value))) {
      problems.push({
        check: 'fixture',
        message: `${where}: ${entity.name}/${id}.${field.name} = "${String(value)}" is not a declared enum value`,
      });
    }
    if (field.type === 'number' && typeof value !== 'number') {
      problems.push({
        check: 'fixture',
        message: `${where}: ${entity.name}/${id}.${field.name} should be a number`,
      });
    }
    if (field.type === 'boolean' && typeof value !== 'boolean') {
      problems.push({
        check: 'fixture',
        message: `${where}: ${entity.name}/${id}.${field.name} should be a boolean`,
      });
    }
  }
  return problems;
}

/** Writes junk into a returned state, to prove the adapter handed back a copy. */
function mutateDeeply(state: CanonicalState): void {
  const copy = cloneState(state);
  void copy;
  for (const table of Object.values(state.entities)) {
    for (const row of Object.values(table)) {
      row['__conformance_probe__'] = true;
    }
    table['__conformance_probe__'] = { id: '__conformance_probe__' };
  }
}
