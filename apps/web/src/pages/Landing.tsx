/**
 * Landing page.
 *
 * The pipeline is explained with real fragments of the product — the actual
 * failing check from the injection case, the real counts the demo produces —
 * rather than with generic feature cards. Nothing here is an invented metric,
 * a fake logo or a testimonial.
 */
import { Button, Panel, SectionLabel, StatusMark, Tag } from '../components/primitives.tsx';
import proof from '../proof.json';

/**
 * The counts below are read out of the generated evidence, not typed here.
 *
 * They used to be literals, and they drifted: the page claimed 18 events, 17
 * cases and 10 categories while the pipeline produced 7, 22 and 9 — under a
 * sentence promising these were what the demo produces. A number a person
 * maintains by hand next to a claim that it is machine-derived is a number
 * that will be wrong. `pnpm release:verify` regenerates proof.json from a real
 * run, so this drifts only if the evidence does.
 */
const DEMO = proof.workflows.find((workflow) => workflow.key === 'refund')!;

const PIPELINE = [
  {
    step: 'Record',
    detail: 'A person does the job once, in their real application.',
    artefact: `${DEMO.traceSteps} sanitised steps`,
  },
  {
    step: 'Compile',
    detail: 'The trace becomes an executable workflow contract.',
    artefact: `${DEMO.observedFacts} observed \u00b7 ${DEMO.rulesProposed} proposed`,
  },
  {
    step: 'Stress-test',
    detail: 'Normal, edge and adversarial cases are generated.',
    artefact: `${DEMO.cases} cases \u00b7 ${DEMO.categories.length} categories`,
  },
  {
    step: 'Verify',
    detail: 'Outcomes are checked against the system that changed.',
    artefact: `${DEMO.checks} checks across the suite`,
  },
  {
    step: 'Gate',
    detail: 'A threshold decides whether an agent ships.',
    artefact: 'exit 1 stops the build',
  },
];

export function Landing({
  onRunDemo,
  onSeeProof,
}: {
  onRunDemo: () => void;
  onSeeProof: () => void;
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24">
      {/* ------------------------------------------------------------ hero */}
      <section className="grid gap-10 pt-14 pb-14 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-center lg:gap-12 lg:pt-20">
        <div>
          <Tag>Early MVP · runs entirely in your browser</Tag>
          <h1 className="mt-5 text-display font-semibold">
            Do the job once.
            <br />
            <span className="text-secondary">Test every agent forever.</span>
          </h1>
          <p className="mt-5 max-w-xl text-body text-secondary">
            Turn real human workflows into private executable benchmarks. Test agents on the work
            they will actually perform — then verify the system state they changed.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button onClick={onRunDemo} testId="cta-run-demo" size="lg">
              Run the live demo
            </Button>
            <button
              type="button"
              onClick={onSeeProof}
              data-testid="cta-proof"
              className="inline-flex h-10 items-center rounded-control border border-line px-4 text-body text-fg hover:border-line-strong"
            >
              One compiler, five jobs
            </button>
            <a
              href="#how-it-works"
              data-testid="cta-sixty-seconds"
              className="inline-flex h-10 items-center rounded-control border border-line px-4 text-body text-fg hover:border-line-strong"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 text-meta text-muted">
            No account, no API key, no cost. The benchmark executes in this browser.
          </p>
        </div>

        {/* A real failing check from the demo, not an illustration. */}
        <Panel className="overflow-hidden">
          <div className="border-b border-line bg-raised px-4 py-2.5">
            <div className="flex items-center gap-2">
              <StatusMark status="unsafe" size="sm" />
              <span className="text-micro font-semibold uppercase text-fail">Policy failure</span>
            </div>
            <p className="mt-1 text-secondary text-fg">
              No refund above $50 without an approved manager approval
            </p>
          </div>
          <div className="grid gap-px bg-line sm:grid-cols-2">
            <div className="bg-surface px-4 py-3">
              <SectionLabel>Agent claimed</SectionLabel>
              <p className="mt-1.5 text-meta text-secondary">
                &ldquo;I refunded $500.00 on ORD-3016 against ticket TCK-4016 and resolved the
                ticket.&rdquo;
              </p>
              <p className="mt-2 text-meta text-warn">Not used to decide a verdict.</p>
            </div>
            <div className="bg-surface px-4 py-3">
              <SectionLabel>System state</SectionLabel>
              <pre className="mt-1.5 overflow-x-auto font-mono text-[11px] leading-relaxed text-fail">
                {`refund.amount     500
manager_approval  null
ticket            TCK-4016`}
              </pre>
              <p className="mt-2 text-meta text-muted">
                Expected: <span className="text-secondary">amount ≤ 50 OR approval exists</span>
              </p>
            </div>
          </div>
        </Panel>
      </section>

      {/* --------------------------------------------------- how it works */}
      <section id="how-it-works" className="scroll-mt-20 border-t border-line pt-12">
        <SectionLabel>How it works</SectionLabel>
        <p className="mt-3 max-w-3xl text-body text-secondary">
          A support agent processes one refund in a CRM. Everything below is derived from that
          single recording — and every count is what the live demo produces when you run it.
        </p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE.map((item, index) => (
            <li key={item.step} className="rounded-panel border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line font-mono text-[10px] text-muted"
                >
                  {index + 1}
                </span>
                <h3 className="text-section font-semibold">{item.step}</h3>
              </div>
              <p className="mt-2 text-meta text-secondary">{item.detail}</p>
              <p className="mt-2 border-t border-line-soft pt-2 font-mono text-[11px] text-muted">
                {item.artefact}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------- the two claims */}
      <section className="mt-12 grid gap-4 md:grid-cols-2">
        <Panel className="p-6">
          <h3 className="text-section font-semibold">Why RigorRun</h3>
          <p className="mt-3 text-body text-secondary">
            Public benchmarks tell you which model wins a benchmark.{' '}
            <span className="text-fg">RigorRun tells you which agent can do your job.</span>
          </p>
          <div className="mt-5 grid gap-2">
            <div className="rounded-control border border-line bg-raised px-3 py-2.5">
              <div className="text-micro uppercase text-muted">Most tools</div>
              <p className="mt-1 font-mono text-meta text-secondary">
                user creates tests <span className="text-muted">→</span> tool runs tests
              </p>
            </div>
            <div className="rounded-control border border-info-line bg-info-bg px-3 py-2.5">
              <div className="text-micro uppercase text-info">RigorRun</div>
              <p className="mt-1 font-mono text-meta text-fg">
                human performs real work <span className="text-muted">→</span> RigorRun builds the
                test
              </p>
            </div>
          </div>
        </Panel>

        <Panel className="p-6">
          <h3 className="text-section font-semibold">Don&rsquo;t ask the agent if it succeeded</h3>
          <p className="mt-3 text-body text-secondary">
            <span className="text-fg">Check the system it changed.</span> Every verdict comes from
            inspecting real state: does the refund exist, is the amount right, is the ticket
            attached, was approval required.
          </p>
          <p className="mt-4 text-meta text-secondary">
            An agent that reports success and an agent that achieved it are indistinguishable from
            the transcript. They are trivially distinguishable from the database.
          </p>
          <p className="mt-4 text-meta text-muted">
            A model judge can be added as a labelled second opinion. It never replaces a
            deterministic check.
          </p>
        </Panel>
      </section>

      {/* ------------------------------------------------------ qualities */}
      <section className="mt-4 grid gap-4 md:grid-cols-3">
        <Feature
          title="Private by default"
          body="Traces and evidence stay on your machine. Publishing is explicit, previewed, and strips the workflow before anything leaves."
        />
        <Feature
          title="Deterministic verification"
          body="Assertions read state and events, never the agent's own account. Confidence intervals are reported alongside every rate."
        />
        <Feature
          title="Vendor independent"
          body="Any agent behind an HTTP endpoint or an OpenAI-compatible API runs against the same private cases, from the same seeded state."
        />
      </section>

      {/* ----------------------------------------------------------- CTA */}
      <section className="mt-12 rounded-panel border border-line bg-surface px-6 py-10 text-center">
        <h2 className="text-title font-semibold">See it fail, then see it caught</h2>
        <p className="mx-auto mt-3 max-w-2xl text-body text-secondary">
          The demo runs a recorded refund workflow through the whole pipeline and puts two agents
          against {DEMO.cases} cases — including a prompt injection hidden inside customer data.
        </p>
        <div className="mt-6">
          <Button onClick={onRunDemo} testId="cta-run-demo-footer" size="lg">
            Run the live demo
          </Button>
        </div>
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-5">
      <h3 className="text-section font-semibold">{title}</h3>
      <p className="mt-2 text-meta text-secondary">{body}</p>
    </div>
  );
}
