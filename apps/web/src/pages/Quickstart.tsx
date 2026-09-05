/**
 * What "test your agent" actually costs, said before anybody commits to it.
 *
 * This page exists because the honest answer to the primary call to action is
 * "you have to run something locally", and burying that behind a sign-up form
 * would be a worse experience than saying it in the first paragraph. The reason
 * is not a preference: a page on https cannot reach http://127.0.0.1, so a
 * hosted interface could never see the systems most people want tested.
 */
import { Panel, SectionLabel, Tag } from '../components/primitives.tsx';

const STEPS = [
  {
    title: 'Start the runner',
    body: 'It serves the interface and does the work. Nothing is uploaded.',
    code: 'pnpm dlx rigorrun',
  },
  {
    title: 'Open the link it prints',
    body: 'It carries a one-time pairing code, so only the tab you opened can drive it.',
    code: 'http://127.0.0.1:7777/?code=F7K2-M9PX',
  },
  {
    title: 'Connect your system',
    body: 'An MCP server, local or remote. RigorRun discovers what it can do and asks you which of those only read.',
    code: null,
  },
  {
    title: 'Do the job once',
    body: 'Through your system’s own tools, while RigorRun watches what changes.',
    code: null,
  },
  {
    title: 'Rule on what it learned',
    body: 'It proposes rules and enforces none of them until you say so.',
    code: null,
  },
  {
    title: 'Point it at your agent',
    body: 'Any agent that speaks MCP works as-is. Ten lines if you use the SDK instead.',
    code: null,
  },
];

export function Quickstart() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <Tag>About ten minutes</Tag>
      <h1 className="mt-4 text-title font-semibold">Testing your own agent</h1>
      <p className="mt-4 text-body text-secondary">
        This part runs on your machine, and that is not a preference. Your MCP server, your
        internal API, your staging box — a page served over https cannot reach any of them, so the
        interface for this work is served by a small local process instead. Your credentials, your
        recordings and your systems never touch our infrastructure, because there is no path by
        which they could.
      </p>

      <ol className="mt-8 flex flex-col gap-3">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Panel>
              <div className="flex gap-4">
                <span className="text-metric-sm font-semibold text-muted">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-section font-semibold">{step.title}</h2>
                  <p className="mt-1 text-body text-secondary">{step.body}</p>
                  {step.code ? (
                    <pre className="mt-3 overflow-x-auto rounded-control bg-inset px-3 py-2 font-mono text-meta text-fg">
                      {step.code}
                    </pre>
                  ) : null}
                </div>
              </div>
            </Panel>
          </li>
        ))}
      </ol>

      <section className="mt-10 flex flex-col gap-3">
        <SectionLabel>Before you start</SectionLabel>
        <Panel>
          <p className="text-body text-secondary">
            Point RigorRun at something you are willing to have changed — a staging system, a
            scratch instance, anything with a way to put it back. It will ask which kind of system
            it is, and it refuses to run anything that writes against production. A system with no
            reset still works; RigorRun simply says on every result that its cases were not
            isolated from each other.
          </p>
        </Panel>
      </section>

      <p className="mt-8 text-meta text-muted">
        Not ready?{' '}
        <a className="text-accent underline underline-offset-2" href="#/demo/record">
          The bundled example
        </a>{' '}
        runs entirely in this page against a synthetic system, and connects to nothing.
      </p>
    </div>
  );
}
