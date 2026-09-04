/**
 * One renderer, four products.
 *
 * Everything that distinguishes the finance console from the CRM, the access
 * register and the warehouse arrives as declarations on the environment
 * adapter: labels, navigation, which view suits a collection, which columns
 * matter, what the sections on a record are, what each status value means,
 * which actions belong on a page, layout, density and accent.
 *
 * There is deliberately no branch anywhere in this app on which workflow is
 * being shown, and a test asserts it. If a demo needs a special case to look
 * convincing, then the product does not really generalise and the demo is
 * lying about it.
 */
import { useState } from 'react';
import {
  entityByName,
  presentationFor,
  rowsOf,
  type EntityPresentation,
  type EnvironmentSchema,
  type PresentationHints,
} from '@rigorrun/environment';
import { Collection } from './render/Collection.tsx';
import { Detail } from './render/Detail.tsx';
import { humanise } from './render/values.tsx';
import { ENVIRONMENTS, reset, useEnvironment } from './store.ts';
import { hrefFor, useRoute } from './router.ts';

export function App() {
  const route = useRoute();
  const environmentId = route.environmentId ?? ENVIRONMENTS[0]?.id ?? null;
  const live = useEnvironment(environmentId);

  if (!live || !environmentId) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16">
        <h1 className="text-[20px] font-semibold">No such system</h1>
        <p className="mt-2 text-ink-soft">
          Pick one of {ENVIRONMENTS.map((entry) => entry.definition.title).join(', ')}.
        </p>
      </main>
    );
  }

  const adapter = live.adapter;
  const schema = adapter.describeEntities();
  const hints = adapter.describePresentation();
  const entity = route.entity ?? hints.navEntities[0] ?? hints.focusEntity;
  const presentation = resolvePresentation(schema, hints, entity);

  return (
    <div
      className={`themed density-${hints.density ?? 'comfortable'} flex min-h-full flex-col`}
      style={
        {
          '--accent': hints.accent,
          '--accent-soft': `color-mix(in srgb, ${hints.accent} 8%, white)`,
        } as React.CSSProperties
      }
      data-environment={environmentId}
      data-layout={hints.layout ?? 'topbar'}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <div className="bg-amber-100 px-4 py-1.5 text-center text-[12px] font-medium text-amber-900">
        Demo environment — every record below is synthetic.
      </div>

      <SystemSwitcher current={environmentId} />

      {(hints.layout ?? 'topbar') === 'sidebar' ? (
        <div className="flex flex-1 flex-col md:flex-row">
          <Sidebar hints={hints} schema={schema} environmentId={environmentId} active={entity} />
          <main id="main" className="min-w-0 flex-1 px-4 py-5 md:px-6">
            <Body {...{ live, schema, hints, presentation, environmentId, route }} />
          </main>
        </div>
      ) : (
        <>
          <Topbar hints={hints} schema={schema} environmentId={environmentId} active={entity} />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:px-6">
            <Body {...{ live, schema, hints, presentation, environmentId, route }} />
          </main>
        </>
      )}

      <footer className="border-t border-rule px-4 py-3 text-[12px] text-ink-faint">
        <button
          type="button"
          data-testid="reset"
          onClick={() => reset(environmentId)}
          className="underline underline-offset-2 hover:text-ink"
        >
          Reset this system
        </button>
      </footer>
    </div>
  );
}

/**
 * A collection has a presentation whether or not one was declared: without
 * declarations the renderer falls back to a table of the entity's own
 * role-tagged fields, so a brand-new adapter is usable before anybody has
 * written a line of presentation.
 */
function resolvePresentation(
  schema: EnvironmentSchema,
  hints: PresentationHints,
  entityName: string,
): EntityPresentation {
  const declared = presentationFor(hints, entityName);
  if (declared) return declared;

  const entity = entityByName(schema, entityName);
  const fields = (entity?.fields ?? []).filter(
    (field) => field.role !== undefined && field.role !== 'freetext',
  );
  return {
    entity: entityName,
    plural: hints.navLabels?.[entityName] ?? humanise(entityName),
    view: 'table',
    columns: fields.slice(0, 5).map((field, index) => ({
      field: field.name,
      ...(index === 0 ? { emphasis: true } : {}),
    })),
    sections: [{ title: humanise(entityName), fields: fields.map((field) => field.name) }],
  };
}

function Body({
  live,
  schema,
  hints,
  presentation,
  environmentId,
  route,
}: {
  live: NonNullable<ReturnType<typeof useEnvironment>>;
  schema: EnvironmentSchema;
  hints: PresentationHints;
  presentation: EntityPresentation;
  environmentId: string;
  route: ReturnType<typeof useRoute>;
}) {
  const entity = entityByName(schema, presentation.entity);
  const row = route.recordId
    ? live.state.entities[presentation.entity]?.[route.recordId]
    : undefined;

  if (route.recordId && !row) {
    return (
      <p className="rounded-lg border border-rule bg-surface px-4 py-8 text-center text-ink-faint">
        No such record.
      </p>
    );
  }

  if (row) {
    return (
      <Detail
        adapter={live.adapter}
        schema={schema}
        hints={hints}
        presentation={presentation}
        state={live.state}
        environmentId={environmentId}
        row={row}
      />
    );
  }

  const count = entity ? rowsOf(live.state, presentation.entity).length : 0;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">{presentation.plural}</h1>
        <p className="mt-0.5 text-[13px] text-ink-faint">
          {count} record{count === 1 ? '' : 's'}
        </p>
      </header>
      <Collection
        schema={schema}
        hints={hints}
        presentation={presentation}
        state={live.state}
        environmentId={environmentId}
      />
    </div>
  );
}

function SystemSwitcher({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const active = ENVIRONMENTS.find((entry) => entry.id === current);
  return (
    <div className="border-b border-rule bg-canvas px-4 py-1.5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-[12px]">
        <span className="text-ink-faint">RigorRun demo systems</span>
        <button
          type="button"
          data-testid="system-switcher"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="rounded-md border border-rule bg-surface px-2 py-0.5 font-medium"
        >
          {active?.definition.title ?? current} ▾
        </button>
        {open ? (
          <span className="flex flex-wrap gap-1.5">
            {ENVIRONMENTS.filter((entry) => entry.id !== current).map((entry) => (
              <a
                key={entry.id}
                href={hrefFor(entry.id)}
                data-testid={`switch-${entry.key}`}
                onClick={() => setOpen(false)}
                className="rounded-md border border-rule bg-surface px-2 py-0.5 hover:border-brand"
              >
                {entry.definition.title}
              </a>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function navItems(hints: PresentationHints, schema: EnvironmentSchema) {
  return hints.navEntities.map((name) => ({
    name,
    label:
      hints.navLabels?.[name] ??
      presentationFor(hints, name)?.plural ??
      entityByName(schema, name)?.label ??
      humanise(name),
  }));
}

function Mark({ hints }: { hints: PresentationHints }) {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand text-[11px] font-bold text-white">
        {hints.mark}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold tracking-tight">
          {hints.label}
        </span>
        <span className="block truncate text-[11.5px] text-ink-faint">{hints.tagline}</span>
      </span>
    </span>
  );
}

function Topbar({
  hints,
  schema,
  environmentId,
  active,
}: {
  hints: PresentationHints;
  schema: EnvironmentSchema;
  environmentId: string;
  active: string;
}) {
  return (
    <header className="border-b border-rule bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5 md:px-6">
        <a href={hrefFor(environmentId)} data-testid="brand">
          <Mark hints={hints} />
        </a>
        <nav className="flex flex-wrap items-center gap-1" aria-label="Primary">
          {navItems(hints, schema).map((item) => (
            <a
              key={item.name}
              href={hrefFor(environmentId, item.name)}
              data-testid={`nav-${item.name}`}
              aria-current={item.name === active ? 'page' : undefined}
              className={`inline-flex h-8 items-center rounded-md px-2.5 text-[13px] ${
                item.name === active ? 'bg-brand-soft font-medium text-brand' : 'hover:bg-canvas'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Sidebar({
  hints,
  schema,
  environmentId,
  active,
}: {
  hints: PresentationHints;
  schema: EnvironmentSchema;
  environmentId: string;
  active: string;
}) {
  return (
    <aside className="border-b border-rule bg-surface px-4 py-3 md:w-56 md:shrink-0 md:border-b-0 md:border-r md:px-3 md:py-4">
      <a href={hrefFor(environmentId)} data-testid="brand" className="block px-1">
        <Mark hints={hints} />
      </a>
      <nav className="mt-3 flex flex-wrap gap-1 md:flex-col" aria-label="Primary">
        {navItems(hints, schema).map((item) => (
          <a
            key={item.name}
            href={hrefFor(environmentId, item.name)}
            data-testid={`nav-${item.name}`}
            aria-current={item.name === active ? 'page' : undefined}
            className={`inline-flex h-8 items-center rounded-md px-2.5 text-[13px] md:h-9 ${
              item.name === active ? 'bg-brand-soft font-medium text-brand' : 'hover:bg-canvas'
            }`}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
