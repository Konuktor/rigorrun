/**
 * The demo shell: step progress, the current step's screen, and the CLI
 * equivalent of whatever the user is looking at.
 */
import { STEPS, STEP_META, reachedSteps, useDemo, type Step } from './useDemo.ts';
import {
  BenchmarkStep,
  ContractStep,
  LearnedStep,
  RecordStep,
  RunStep,
  StepHeader,
} from './steps.tsx';
import { VerdictStep } from './verdict.tsx';
import { Button, Panel, Spinner, Tag } from '../components/primitives.tsx';

export function DemoPage() {
  const { state, setStep, compile, toggleRule, approveAndGenerate, run, reset } = useDemo();
  const reached = reachedSteps(state);
  const currentIndex = STEPS.indexOf(state.step);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6">
      <StepProgress
        current={state.step}
        reached={reached}
        onSelect={setStep}
        disabled={state.running}
      />

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_13rem]">
        {/*
          Reserve the fold for the content column. On a deep link the first
          paint has no step content yet, so both footers land near the top of
          the viewport and are then pushed down — measured as a 0.107 layout
          shift on desktop and 0.322 on a phone, over the 0.1 Core Web Vitals
          budget. Reserving down to the fold keeps them off-screen until the
          content arrives, and is a no-op once a real step is rendered.
        */}
        <div className="min-h-[calc(100vh-8.5rem)] min-w-0">
          {state.error ? (
            <div
              role="alert"
              className="mb-4 flex flex-wrap items-center gap-3 rounded-panel border border-fail-line bg-fail-bg px-4 py-3"
            >
              <span className="min-w-[14rem] flex-1 text-secondary text-fail">{state.error}</span>
              <Button size="sm" variant="secondary" onClick={reset} testId="error-reset">
                Start over
              </Button>
            </div>
          ) : null}

          {state.hydrating ? <Hydrating step={state.step} /> : <StepScreen />}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-panel border border-line bg-surface p-3">
            <div className="text-micro font-medium uppercase text-muted">The same thing, in CI</div>
            <code className="mt-1.5 block break-words font-mono text-[11px] leading-relaxed text-secondary">
              {STEP_META[state.step].cli}
            </code>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              testId="reset-demo"
              disabled={state.running}
            >
              Start over
            </Button>
          </div>
        </aside>
      </div>

      <footer className="mt-8 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-meta text-muted">
        <Tag>Offline</Tag>
        <span className="min-w-[16rem] flex-1">
          Step {currentIndex + 1} of {STEPS.length}. Executed in this browser with no backend, no
          API key and no network calls — the same packages power the CLI and CI.
        </span>
      </footer>
    </div>
  );

  function StepScreen() {
    if (state.step === 'record') {
      return (
        <RecordStep
          trace={state.trace}
          environmentName={state.workflow.registration.name}
          onCompile={() => void compile()}
        />
      );
    }

    if (state.step === 'learned') {
      if (!state.draftContract) return <Hydrating step="learned" />;
      return (
        <LearnedStep
          contract={state.draftContract}
          onContinue={() => setStep('confirm')}
        />
      );
    }

    if (state.step === 'confirm') {
      if (!state.draftContract) return <Hydrating step="confirm" />;
      return (
        <ContractStep
          contract={state.draftContract}
          rejected={state.rejected}
          confirmed={state.confirmed}
          onDecide={toggleRule}
          onApprove={() => void approveAndGenerate()}
        />
      );
    }

    if (state.step === 'benchmark') {
      if (!state.benchmark) return <Hydrating step="benchmark" />;
      return (
        <BenchmarkStep
          benchmark={state.benchmark}
          onRun={() => void run()}
          running={state.running}
        />
      );
    }

    if (state.step === 'run') {
      return <RunStep state={state} total={(state.benchmark?.cases.length ?? 0) * 2} />;
    }

    if (state.result) {
      return (
        <VerdictStep result={state.result} contract={state.contract} benchmark={state.benchmark} />
      );
    }

    return (
      <div className="space-y-4">
        <StepHeader
          title="Nothing has been run yet"
          lede="Run the benchmark to see a verdict. Every number on that screen comes from executions that happen when you press the button."
        />
        <Panel>
          <div className="px-4 py-5">
            <Button onClick={() => setStep('record')} testId="verdict-restart">
              Back to the recording
            </Button>
          </div>
        </Panel>
      </div>
    );
  }
}

function Hydrating({ step }: { step: Step }) {
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="flex items-center gap-2 text-secondary text-muted">
        <Spinner />
        Rebuilding the {STEP_META[step].label.toLowerCase()} from the recorded trace…
      </div>
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-panel border border-line bg-surface" />
        ))}
      </div>
    </div>
  );
}

/**
 * Progress, not a wizard: completed steps are marked, the current one is
 * emphasised, and upcoming ones stay legible rather than being greyed into
 * invisibility.
 */
function StepProgress({
  current,
  reached,
  onSelect,
  disabled,
}: {
  current: Step;
  reached: Set<Step>;
  onSelect: (step: Step) => void;
  disabled: boolean;
}) {
  const currentIndex = STEPS.indexOf(current);

  return (
    <nav aria-label="Demo progress">
      {/* Phones get the step name and position; the list below stays usable. */}
      <div className="mb-2 flex items-center justify-between gap-3 sm:hidden">
        <span className="text-section font-semibold">{STEP_META[current].label}</span>
        <span className="text-meta text-muted">
          Step {currentIndex + 1} of {STEPS.length}
        </span>
      </div>

      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {STEPS.map((step, index) => {
          const isCurrent = step === current;
          const isDone = index < currentIndex && reached.has(step);
          const available = reached.has(step);

          return (
            <li key={step} className="min-w-0 shrink-0 lg:flex-1">
              <button
                type="button"
                disabled={!available || disabled}
                onClick={() => onSelect(step)}
                data-testid={`nav-${step}`}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex h-10 w-full items-center gap-2 rounded-control px-2.5 text-left text-meta transition-colors ${
                  isCurrent
                    ? 'bg-raised font-semibold text-fg ring-1 ring-line-strong'
                    : available
                      ? 'text-secondary hover:bg-raised hover:text-fg'
                      : 'cursor-not-allowed text-disabled'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                    isDone
                      ? 'bg-pass-bg text-pass'
                      : isCurrent
                        ? 'bg-fg text-canvas'
                        : 'border border-line text-muted'
                  }`}
                >
                  {isDone ? '✓' : index + 1}
                </span>
                <span className="whitespace-nowrap lg:truncate">{STEP_META[step].label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-1 h-px w-full bg-line">
        <div
          className="h-px bg-info transition-[width] duration-300"
          style={{ width: `${((currentIndex + 1) / STEPS.length) * 100}%` }}
        />
      </div>
    </nav>
  );
}
