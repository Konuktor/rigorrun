/**
 * The evidence page.
 *
 * Every number here is read from `proof.json`, which is written by
 * `node scripts/build-proof.mjs` running the real pipeline over all five
 * workflows. Nothing on this page is typed by a person, and the commit it was
 * generated from is printed at the bottom so a reader can regenerate it and
 * compare.
 */
import { Mono, Panel, SectionLabel, Tag, pct } from '../components/primitives.tsx';
import proof from '../proof.json';

const OPS_URL = import.meta.env['VITE_OPS_URL'] ?? 'http://127.0.0.1:5175';

interface WorkflowProof {
  key: string;
  title: string;
  discipline: string;
  environment: string;
  entities: number;
  actions: number;
  traceSteps: number;
  observedFacts: number;
  rulesProposed: number;
  rulesConfirmed: number;
  templates: string[];
  provenance: { strong: number; moderate: number; weak: number };
  cases: number;
  categories: string[];
  mustPerform: number;
  mustRefuse: number;
  timings: { record: number; compile: number; review: number; generate: number; total: number };
  quality: {
    falsePositiveRate: number | null;
    caseDiscrimination: number | null;
    boundaryDiscrimination: boolean | string | null;
    ruleDecisiveness: number | null;
    mutantKillRate: number;
    independentKillRate: number;
    falseAccusationRate: number | null;
    replayStable: boolean;
    hiddenAnswerIsolated: boolean;
    deadRules: number;
    wallClockMs: number;
  };
  mutants: {
    id: string;
    defect: string;
    independence: string;
    expectation: string;
    caught: boolean;
    asExpected: boolean;
  }[];
  agents: {
    id: string;
    name: string;
    taskSuccess: number;
    policyCompliance: number;
    unsafeActions: number;
    passed: boolean;
  }[];
}

const workflows = proof.workflows as WorkflowProof[];

const ALL_TEMPLATES = [...new Set(workflows.flatMap((w) => w.templates))].sort();

export function Proof() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <header className="max-w-3xl">
        <SectionLabel>Evidence</SectionLabel>
        <h1 className="mt-2 text-display font-semibold tracking-tight">
          One compiler. Five different jobs.
        </h1>
        <p className="mt-3 text-body text-secondary">
          A refund desk, an accounts-payable queue, an inbound sales pipeline, an IT access
          register and a warehouse. Each is a schema, some fixture rows and a recording of somebody
          doing the work once. Nothing in the compiler, the generator, the verifier or the runner
          knows any of them exist — a build check fails if a business noun appears in any of them.
        </p>
        <p className="mt-3 text-body text-secondary">
          Every number below was produced by running the real pipeline. Regenerate it with{' '}
          <Mono>node scripts/build-proof.mjs</Mono>.
        </p>
        <p className="mt-4">
          <a
            href={OPS_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="open-systems"
            className="inline-flex h-10 items-center rounded-control border border-line px-4 text-body text-fg hover:border-line-strong"
          >
            Open the four systems ↗
          </a>
          <span className="ml-3 text-meta text-muted">
            A finance console, a CRM, an access register and a warehouse — one renderer, and a
            build check that fails if it names any of them.
          </span>
        </p>
      </header>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        {workflows.map((workflow) => (
          <Panel
            key={workflow.key}
            title={workflow.title}
            subtitle={`${workflow.discipline} · ${workflow.environment} · ${workflow.entities} record types, ${workflow.actions} actions`}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4">
              <Figure label="Recorded steps" value={workflow.traceSteps} />
              <Figure label="Facts observed" value={workflow.observedFacts} />
              <Figure label="Rules proposed" value={workflow.rulesProposed} />
              <Figure label="Rules confirmed" value={workflow.rulesConfirmed} />
              <Figure label="Cases generated" value={workflow.cases} />
              <Figure label="Must be done" value={workflow.mustPerform} />
              <Figure label="Must be refused" value={workflow.mustRefuse} />
              <Figure
                label="Time to benchmark"
                value={`${(workflow.timings.total / 1000).toFixed(2)}s`}
              />
            </div>

            <div className="border-t border-line-soft px-4 py-3">
              <div className="text-micro font-medium uppercase text-muted">Benchmark quality</div>
              <ul className="mt-2 space-y-1.5">
                <Check
                  label="Fails no correct implementation"
                  ok={workflow.quality.falsePositiveRate === 0}
                  detail={pct(1 - (workflow.quality.falsePositiveRate ?? 0))}
                />
                <Check
                  label="Injected defects caught"
                  ok={workflow.quality.mutantKillRate >= 0.75}
                  detail={pct(workflow.quality.mutantKillRate)}
                />
                <Check
                  label="Never fails harmless behaviour"
                  ok={workflow.quality.falseAccusationRate === 0}
                  detail={pct(1 - (workflow.quality.falseAccusationRate ?? 0))}
                />
                <Check
                  label="Same seed, same world"
                  ok={workflow.quality.replayStable}
                  detail={workflow.quality.replayStable ? 'stable' : 'flaky'}
                />
                <Check
                  label="Answer never reaches the agent"
                  ok={workflow.quality.hiddenAnswerIsolated}
                  detail={workflow.quality.hiddenAnswerIsolated ? 'isolated' : 'leaks'}
                />
                <Check
                  label="Cases that separate implementations"
                  ok={(workflow.quality.caseDiscrimination ?? 0) > 0.4}
                  detail={pct(workflow.quality.caseDiscrimination ?? 0)}
                />
              </ul>
            </div>

            <div className="border-t border-line-soft px-4 py-3">
              <div className="text-micro font-medium uppercase text-muted">Agents</div>
              <table className="mt-2 w-full text-meta">
                <thead className="text-muted">
                  <tr>
                    <th className="pb-1 text-left font-medium">Implementation</th>
                    <th className="pb-1 text-right font-medium">Task</th>
                    <th className="pb-1 text-right font-medium">Policy</th>
                    <th className="pb-1 text-right font-medium">Unsafe</th>
                    <th className="pb-1 text-right font-medium">Gate</th>
                  </tr>
                </thead>
                <tbody>
                  {workflow.agents.map((agent) => (
                    <tr key={agent.id} className="border-t border-line-soft">
                      <td className="py-1 text-secondary">{agent.name}</td>
                      <td data-numeric className="py-1 text-right">
                        {pct(agent.taskSuccess)}
                      </td>
                      <td data-numeric className="py-1 text-right">
                        {pct(agent.policyCompliance)}
                      </td>
                      <td data-numeric className="py-1 text-right">
                        {agent.unsafeActions}
                      </td>
                      <td className="py-1 text-right">
                        <Tag tone={agent.passed ? 'pass' : 'fail'}>
                          {agent.passed ? 'pass' : 'fail'}
                        </Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-meta text-muted">
                The reference implementation replays the plan the expectation engine derived. It is
                given the answer, so its result says the benchmark is satisfiable — and nothing at
                all about agent quality.
              </p>
            </div>
          </Panel>
        ))}
      </div>

      <Panel
        className="mt-4"
        title="Rule shapes, across all five"
        subtitle="No workflow needs all of them, and none of them names a business object."
      >
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {ALL_TEMPLATES.map((template) => (
            <Tag key={template}>{template.replace(/_/g, ' ')}</Tag>
          ))}
        </div>
        <div className="border-t border-line-soft px-4 py-3">
          <table className="w-full text-meta">
            <thead className="text-muted">
              <tr>
                <th className="pb-1 text-left font-medium">Job</th>
                {ALL_TEMPLATES.map((template) => (
                  <th key={template} className="pb-1 text-center font-medium">
                    {template.split('_')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.key} className="border-t border-line-soft">
                  <td className="py-1 text-secondary">{workflow.title}</td>
                  {ALL_TEMPLATES.map((template) => (
                    <td key={template} className="py-1 text-center">
                      {workflow.templates.includes(template) ? (
                        <span className="text-pass">●</span>
                      ) : (
                        <span className="text-muted">·</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        className="mt-4"
        title="Injected defects"
        subtitle="Deliberately broken implementations, and one control that must survive."
      >
        <ul>
          {(workflows[0]?.mutants ?? []).map((mutant) => (
            <li
              key={mutant.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 last:border-0"
            >
              <Tag tone={mutant.expectation === 'must_survive' ? 'info' : 'neutral'}>
                {mutant.expectation === 'must_survive' ? 'control' : 'defect'}
              </Tag>
              <span className="min-w-[16rem] flex-1 text-secondary">{mutant.defect}</span>
              <Mono className="text-muted">{mutant.independence.replace(/_/g, ' ')}</Mono>
              <span className="text-meta text-muted">
                caught in{' '}
                {workflows.filter((w) => w.mutants.find((m) => m.id === mutant.id)?.caught).length}{' '}
                of {workflows.length}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <footer className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted">
        <span>
          Generated from commit <Mono>{proof.commit}</Mono>
        </span>
        <span>{new Date(proof.generatedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
        <span>{(proof.generationMs / 1000).toFixed(1)}s to produce every number on this page</span>
      </footer>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-micro font-medium uppercase text-muted">{label}</div>
      <div data-numeric className="text-metric-sm font-semibold">
        {value}
      </div>
    </div>
  );
}

function Check({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-center gap-2 text-meta">
      <span className={ok ? 'text-pass' : 'text-fail'} aria-hidden="true">
        {ok ? '✓' : '✕'}
      </span>
      <span className="min-w-[12rem] flex-1 text-secondary">{label}</span>
      <Mono className={ok ? 'text-pass' : 'text-fail'}>{detail}</Mono>
    </li>
  );
}
