import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  entityByName,
  fieldByName,
  relationshipsFrom,
  rowsOf,
  type EnvironmentSchema,
} from '@rigorrun/environment';
import { WORKFLOWS } from '@rigorrun/environments';

const rendererDir = resolve(import.meta.dirname, '..', 'src');

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The renderer must not know which product it is drawing.
 *
 * Four demo systems that look nothing alike is only evidence of anything if
 * they are genuinely one implementation. A single `if (workflow === 'invoice')`
 * would make the whole demonstration a lie, and it would be an easy one to add
 * under deadline, so it is checked rather than trusted.
 */
describe('one renderer, no branches', () => {
  it('never names an environment or a workflow', async () => {
    const identifiers = [
      ...WORKFLOWS.map((workflow) => workflow.registration.id),
      ...WORKFLOWS.map((workflow) => workflow.key),
    ];
    const offences: string[] = [];

    for (const file of await sourceFiles(rendererDir)) {
      const source = await readFile(file, 'utf8');
      // The store legitimately enumerates the registered environments; it is
      // the only file allowed to, and it still names none of them.
      for (const identifier of identifiers) {
        if (source.includes(`'${identifier}'`) || source.includes(`"${identifier}"`)) {
          offences.push(`${file} names ${identifier}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('contains no comparison against a workflow name', async () => {
    const pattern = /===\s*['"](finance|sales|it|ops|support)[-a-z]*['"]/i;
    for (const file of await sourceFiles(rendererDir)) {
      const source = await readFile(file, 'utf8');
      expect(pattern.test(source), `${file} branches on a workflow`).toBe(false);
    }
  });

  it('reads its differences from declarations, and there are real differences to read', () => {
    const hints = WORKFLOWS.map((workflow) => workflow.registration.create().describePresentation());
    // If every system declared the same thing, one renderer would prove
    // nothing: they would look identical because they are identical.
    expect(new Set(hints.map((h) => h.accent)).size).toBe(WORKFLOWS.length);
    expect(new Set(hints.map((h) => h.layout)).size).toBeGreaterThan(1);
    expect(new Set(hints.map((h) => h.density)).size).toBeGreaterThan(1);
    const views = hints.flatMap((h) => (h.entities ?? []).map((entity) => entity.view));
    expect(new Set(views).size).toBeGreaterThan(1);
  });
});

/**
 * A generic renderer moves the risk rather than removing it: a declaration
 * naming a field that does not exist renders a blank where a number should be,
 * and nothing complains. These checks are where that fails loudly instead.
 */
describe('every presentation declaration resolves', () => {
  for (const workflow of WORKFLOWS) {
    describe(workflow.key, () => {
      const adapter = workflow.registration.create();
      const schema = adapter.describeEntities();
      const hints = adapter.describePresentation();

      function resolves(entityName: string, path: string): boolean {
        const [head, tail] = path.split('__');
        const entity = entityByName(schema, entityName);
        if (!entity) return false;
        if (!tail) return fieldByName(entity, path) !== undefined;
        const relationship = relationshipsFrom(schema, entityName).find((r) => r.name === head);
        if (!relationship || relationship.via.kind !== 'fk') return false;
        const target = entityByName(schema, relationship.to);
        return target !== undefined && fieldByName(target, tail) !== undefined;
      }

      it('names only entities the environment declares', () => {
        for (const entity of hints.entities ?? []) {
          expect(entityByName(schema, entity.entity), entity.entity).toBeDefined();
        }
        for (const name of hints.navEntities) {
          expect(entityByName(schema, name), name).toBeDefined();
        }
      });

      it('names only fields that exist, one hop out at most', () => {
        for (const entity of hints.entities ?? []) {
          for (const column of entity.columns) {
            expect(resolves(entity.entity, column.field), `${entity.entity}.${column.field}`).toBe(
              true,
            );
          }
          for (const section of entity.sections) {
            for (const field of section.fields) {
              expect(resolves(entity.entity, field), `${entity.entity}.${field}`).toBe(true);
            }
          }
          if (entity.subtitleField) {
            expect(resolves(entity.entity, entity.subtitleField)).toBe(true);
          }
        }
      });

      it('groups a board by a real status field', () => {
        for (const entity of hints.entities ?? []) {
          if (entity.view !== 'board') continue;
          expect(entity.groupBy, `${entity.entity} is a board with no groupBy`).toBeDefined();
          const schemaEntity = entityByName(schema, entity.entity);
          const field = schemaEntity ? fieldByName(schemaEntity, entity.groupBy!) : undefined;
          expect(field?.enumValues?.length ?? 0).toBeGreaterThan(1);
        }
      });

      it('offers only actions the environment has', () => {
        const names = new Set(adapter.getActions().map((action) => action.name));
        for (const entity of hints.entities ?? []) {
          for (const action of entity.actions ?? []) expect(names.has(action), action).toBe(true);
        }
        for (const action of Object.keys(hints.actionLabels ?? {})) {
          expect(names.has(action), action).toBe(true);
        }
      });

      it('gives a tone to every lifecycle value a person will see', () => {
        // An undeclared status renders neutral grey, which quietly makes
        // "refused" look like "pending". Every value gets an opinion.
        const values = new Set<string>();
        for (const entity of schema.entities) {
          for (const field of entity.fields) {
            if (field.role !== 'status') continue;
            for (const value of field.enumValues ?? []) values.add(value);
          }
        }
        const declared = new Set(Object.keys(hints.statusTones ?? {}));
        expect([...values].filter((value) => !declared.has(value))).toEqual([]);
      });

      it('opens on a page that has something on it', () => {
        // An empty landing screen is a bad first impression and a sign the
        // navigation was declared in the wrong order.
        const fixture = workflow.registration.fixtures.find((f) => f.id === workflow.fixtureId)!;
        const landing = hints.navEntities[0]!;
        expect(rowsOf(fixture.state, landing).length, `${landing} is empty`).toBeGreaterThan(0);
      });
    });
  }
});

export type { EnvironmentSchema };
