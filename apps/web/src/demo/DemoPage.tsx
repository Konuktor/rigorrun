import { STEPS, useDemo, type Step } from './useDemo.ts';
import { CompileStep, GenerateStep, RecordStep, RunStep } from './steps.tsx';
import { VerdictStep } from './verdict.tsx';
import { Button, Panel, Tag } from '../components/primitives.tsx';

const STEP_LABELS: Record<Step, string> = {
  record: 'Record',
  compile: 'Compile',
  generate: 'Stress-test',
  run: 'Verify',
  verdict: 'Gate',
};

const CLI_EQUIVALENT: Record<Step, string> = {
  record: 'rigorrun record',
  compile: 'rigorrun compile trace.json -o contract.json',
  generate: 'rigorrun generate contract.json -o benchmark.json',
  run: 'rigorrun compare benchmark.json --agent demo-weak --agent demo-robust',
  verdict: 'rigorrun gate benchmark.json --agent demo-robust --min-success 0.95',
};

export function DemoPage() {
  const { state, goto, compile, toggleRule, approveAndGenerate, run, reset } = useDemo();
  const reached = reachedSteps(state);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[190px_minmax(0,1fr)]">
      {/* min-w-0 lets the horizontal step list scroll on narrow screens
          instead of widening its grid track. */}
      <nav className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <ol className="flex gap-2 overflow-x-auto lg:block lg:space-y-1">
          {STEPS.map((step, index) => {
            const active = state.step === step;
            const available = reached.has(step);
            return (
              <li key={step}>
                <button
                  type="button"
                  disabled={!available}
                  onClick={() => goto(step)}
                  data-testid={`nav-${step}`}
                  className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    active
                      ? 'bg-panel-2 font-medium text-fg ring-1 ring-line'
                      : available
                        ? 'text-muted hover:text-fg'
                        : 'cursor-not-allowed text-dim/60'
                  }`}
                >
                  <span className="font-mono text-[11px] text-dim">{index + 1}</span>
                  {STEP_LABELS[step]}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-4 hidden rounded-lg border border-line bg-panel p-3 lg:block">
          <div className="text-[10.5px] uppercase tracking-[0.07em] text-dim">
            Same thing, in CI
          </div>
          <code className="mt-1 block break-words font-mono text-[10.5px] leading-relaxed text-muted">
            {CLI_EQUIVALENT[state.step]}
          </code>
        </div>

        <div className="mt-3 hidden lg:block">
          <Button variant="ghost" size="sm" onClick={reset} testId="reset-demo">
            Start over
          </Button>
        </div>
      </nav>

      <div className="min-w-0">
        {state.error ? (
          <div className="mb-4 rounded-lg border border-fail/40 bg-fail/[0.06] px-4 py-3 text-[13px] text-fail">
            {state.error}
          </div>
        ) : null}

        {state.step === 'record' ? <RecordStep trace={state.trace} onCompile={compile} /> : null}

        {state.step === 'compile' && state.draftContract ? (
          <CompileStep
            contract={state.draftContract}
            rejected={state.rejected}
            onToggle={toggleRule}
            onApprove={() => void approveAndGenerate()}
          />
        ) : null}

        {state.step === 'generate' && state.benchmark ? (
          <GenerateStep benchmark={state.benchmark} onRun={() => void run()} />
        ) : null}

        {state.step === 'run' ? (
          <RunStep
            results={state.liveResults}
            total={(state.benchmark?.cases.length ?? 0) * 2}
            active={state.activeCase}
            running={state.running}
          />
        ) : null}

        {state.step === 'verdict' && state.result ? (
          <VerdictStep
            result={state.result}
            contract={state.contract}
            benchmark={state.benchmark}
          />
        ) : null}

        {state.step === 'verdict' && !state.result ? (
          <Panel title="Nothing has been run yet">
            <div className="px-4 py-5">
              <p className="text-[13px] text-muted">Run the benchmark to see a verdict.</p>
              <div className="mt-3">
                <Button onClick={() => goto('record')}>Back to the recording</Button>
              </div>
            </div>
          </Panel>
        ) : null}

        <footer className="mt-8 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[11.5px] text-dim">
          <Tag>offline</Tag>
          <span>
            Executed in this browser with no backend, no API key and no network calls. The same
            packages power the CLI and CI.
          </span>
        </footer>
      </div>
    </div>
  );
}

/** Steps a user may jump back to, based on what has actually been produced. */
function reachedSteps(state: ReturnType<typeof useDemo>['state']): Set<Step> {
  const reached = new Set<Step>(['record']);
  if (state.draftContract) reached.add('compile');
  if (state.benchmark) reached.add('generate');
  if (state.liveResults.length > 0 || state.running) reached.add('run');
  if (state.result) reached.add('verdict');
  return reached;
}
