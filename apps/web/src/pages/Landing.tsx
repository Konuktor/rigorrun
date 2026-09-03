import { Button, Panel, Tag, Wordmark } from '../components/primitives.tsx';

const PIPELINE = [
  { step: 'Record', detail: 'A person does the job once, in their real application.' },
  { step: 'Compile', detail: 'The trace becomes an executable workflow contract.' },
  { step: 'Stress-test', detail: 'Normal, edge and adversarial cases are generated.' },
  { step: 'Verify', detail: 'Outcomes are checked against the system that changed.' },
  { step: 'Gate', detail: 'A threshold decides whether an agent ships.' },
];

export function Landing({ onRunDemo }: { onRunDemo: () => void }) {
  return (
    <div className="mx-auto max-w-5xl px-5 pb-24">
      <section className="pt-20 pb-16 sm:pt-28">
        <Tag tone="neutral">Early MVP · runs entirely offline</Tag>
        <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-6xl">
          Do the job once.
          <br />
          <span className="text-muted">Test every agent forever.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">
          Turn real human workflows into private executable benchmarks. Compare AI agents on
          success, policy compliance, latency and cost before they touch production.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button onClick={onRunDemo} testId="cta-run-demo">
            Run the live demo
          </Button>
          <a
            href="#how-it-works"
            className="rounded-lg border border-line px-3.5 py-2 text-[13px] text-fg hover:border-dim"
          >
            See how it works
          </a>
        </div>
        <p className="mt-4 text-[12px] text-dim">
          No account, no API key, no cost. The demo executes in this browser.
        </p>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-t border-line pt-12">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-muted">
          How it works
        </h2>
        <ol className="mt-6 grid gap-3 sm:grid-cols-5">
          {PIPELINE.map((item, index) => (
            <li key={item.step} className="rounded-xl border border-line bg-panel p-4">
              <div className="font-mono text-[11px] text-dim">
                {String(index + 1).padStart(2, '0')}
              </div>
              <div className="mt-1 text-[14px] font-semibold tracking-tight">{item.step}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{item.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 grid gap-4 md:grid-cols-2">
        <Panel className="p-6">
          <h3 className="text-[15px] font-semibold tracking-tight">Why RigorRun</h3>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            Public benchmarks tell you which model wins a benchmark.
            <span className="text-fg"> RigorRun tells you which agent can do your job.</span>
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-dim">
            Most evaluation tools start by asking you to write datasets, rubrics and assertions.
            RigorRun starts from a recording of someone doing the work, and writes the benchmark for
            you.
          </p>
        </Panel>

        <Panel className="p-6">
          <h3 className="text-[15px] font-semibold tracking-tight">
            Don&rsquo;t ask the agent if it succeeded
          </h3>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            <span className="text-fg">Check the system it changed.</span> Every verdict comes from
            inspecting real state: does the refund exist, is the amount right, is the ticket
            attached, was approval required.
          </p>
          <div className="mt-4 space-y-2 rounded-lg border border-line bg-panel-2 p-3 font-mono text-[11.5px]">
            <div className="text-muted">
              agent:{' '}
              <span className="text-fg">&ldquo;I successfully refunded the customer.&rdquo;</span>
            </div>
            <div className="text-fail">verifier: refund.amount = 500, manager_approval = false</div>
            <div className="text-fail">verdict: FAIL — unsafe action</div>
          </div>
        </Panel>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-3">
        <Feature
          title="Private by default"
          body="Traces, screenshots and results stay on your machine. Only what you explicitly publish ever leaves it, and publishing strips the workflow first."
        />
        <Feature
          title="Deterministic verification"
          body="Assertions read state and events, never the agent's own account of what it did. A model judge can be added as a second opinion, never as a replacement."
        />
        <Feature
          title="Vendor independent"
          body="Any agent behind an HTTP endpoint or an OpenAI-compatible API can be run against the same private benchmark, on the same cases."
        />
      </section>

      <section className="mt-16 border-t border-line pt-12">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-muted">
          The difference
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel p-5">
            <div className="text-[11px] uppercase tracking-[0.07em] text-dim">Most tools</div>
            <p className="mt-2 font-mono text-[13px] text-muted">
              user creates tests <span className="text-dim">→</span> tool runs tests
            </p>
          </div>
          <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-5">
            <div className="text-[11px] uppercase tracking-[0.07em] text-accent">RigorRun</div>
            <p className="mt-2 font-mono text-[13px] text-fg">
              human performs real work <span className="text-dim">→</span> RigorRun builds the test
            </p>
          </div>
        </div>
      </section>

      <section className="mt-16 rounded-xl border border-line bg-panel p-8 text-center">
        <Wordmark size="lg" />
        <p className="mx-auto mt-4 max-w-xl text-[14px] leading-relaxed text-muted">
          The demo runs a recorded refund workflow through the whole pipeline and puts two agents
          against seventeen cases, including a prompt injection hidden in customer data.
        </p>
        <div className="mt-6">
          <Button onClick={onRunDemo} testId="cta-run-demo-footer">
            Run the live demo
          </Button>
        </div>
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
