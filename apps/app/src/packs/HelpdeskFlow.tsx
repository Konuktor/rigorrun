/** Helpdesk's bundled setup belongs beside the pack, outside generic workflows. */
import { useEffect, useRef, useState } from 'react';
import { Button, Panel, SectionLabel, Tag } from '../components/primitives.tsx';
import { Field, Problem, Select, TextInput } from '../product/inputs.tsx';
import {
  api,
  type ActivationView,
  type CaseView,
  type GateReadinessView,
  type ProjectView,
  type RuleView,
} from '../product/api.ts';
import { ConnectAgent, RunAndVerdict } from '../product/run.tsx';

export function isHelpdesk(project: ProjectView): boolean {
  return project.connector?.kind === 'pack' && project.connector.pack === 'helpdesk';
}

export function HelpdeskChoice({ onChoose }: { onChoose: () => void }) {
  return (
    <Panel padded>
      <div className="flex flex-col items-start gap-3">
        <SectionLabel>Agent release check</SectionLabel>
        <p className="text-body text-secondary">
          Connect a local Helpdesk twin, review the bundled rules, and check your own HTTP agent.
          Each case starts with a fresh world and reads the twin's state, access log and outbox.
        </p>
        <Button variant="secondary" onClick={onChoose} testId="workflow-helpdesk">
          Use the Helpdesk twin
        </Button>
      </div>
    </Panel>
  );
}

type Decision = 'pending' | 'confirmed' | 'rejected';
function decisionsOf(rules: RuleView[]): Record<string, Decision> {
  return Object.fromEntries(
    rules.map((rule) => [
      rule.id,
      rule.status === 'confirmed' || rule.status === 'observed'
        ? 'confirmed'
        : rule.status === 'rejected'
          ? 'rejected'
          : 'pending',
    ]),
  );
}

export function HelpdeskFlow({
  project,
  initialRules,
  initialCases,
  activation,
  onUpdated,
  onConnected,
}: {
  project: ProjectView;
  initialRules: RuleView[];
  initialCases: CaseView[];
  activation: ActivationView | null;
  onUpdated: () => Promise<ProjectView | null>;
  onConnected: (project: ProjectView) => void;
}) {
  const saved =
    isHelpdesk(project) && project.connector?.kind === 'pack' ? project.connector : null;
  const [url, setUrl] = useState(saved?.baseUrl ?? 'http://127.0.0.1:12113/mcp');
  const [safety, setSafety] = useState<ProjectView['safety'] | ''>(saved ? project.safety : '');
  const [settingsDirty, setSettingsDirty] = useState(!saved || saved.mode !== 'twin');
  const [rules, setRules] = useState(initialRules);
  const [cases, setCases] = useState(initialCases);
  const [decisions, setDecisions] = useState(() => decisionsOf(initialRules));
  const [reviewDirty, setReviewDirty] = useState(false);
  const [readiness, setReadiness] = useState<GateReadinessView | null>(null);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [evidenceRevision, setEvidenceRevision] = useState(0);
  const active = useRef(true);
  const epoch = useRef(0);
  const pending = rules.filter((rule) => decisions[rule.id] === 'pending');
  const reviewed = !settingsDirty && !reviewDirty && rules.length > 0 && pending.length === 0;
  const ready = reviewed && readiness?.ready === true;

  useEffect(() => {
    active.current = true;
    const version = epoch.current;
    if (saved && saved.mode === 'twin') {
      void api
        .gateReadiness(project.id)
        .then((result) => {
          if (active.current && version === epoch.current) setReadiness(result);
        })
        .catch((error: Error) => {
          if (active.current && version === epoch.current) setProblem(error.message);
        });
    }
    return () => {
      active.current = false;
      epoch.current++;
    };
    // The initial snapshot is read once; later checks are explicit actions.
  }, [project.id]);

  function invalidateSettings(): void {
    epoch.current++;
    setSettingsDirty(true);
    setReadiness(null);
    setRules([]);
    setCases([]);
    setDecisions({});
    setBusy('');
    setProblem('');
    setEvidenceRevision((value) => value + 1);
  }

  async function checkReadiness(): Promise<boolean> {
    const version = epoch.current;
    setBusy('readiness');
    setProblem('');
    try {
      const result = await api.gateReadiness(project.id);
      if (!active.current || version !== epoch.current) return false;
      setReadiness(result);
      return result.ready && reviewed;
    } catch (error) {
      if (active.current && version === epoch.current) {
        setReadiness(null);
        setProblem((error as Error).message);
      }
      return false;
    } finally {
      if (active.current && version === epoch.current) setBusy('');
    }
  }

  async function connect(): Promise<void> {
    if (!safety || !localTwinUrl(url)) return;
    const version = ++epoch.current;
    setBusy('connect');
    setProblem('');
    setReadiness(null);
    try {
      const connected = await api.connect(
        project.id,
        { kind: 'pack', pack: 'helpdesk', mode: 'twin', baseUrl: url.trim() },
        safety,
      );
      if (!active.current || version !== epoch.current) return;
      // Empty decisions deliberately leave proposed rules pending.
      const draft = await api.packSuite(project.id, { confirmedRuleIds: [] }, [], []);
      if (!active.current || version !== epoch.current) return;
      setRules(draft.contract.rules);
      setCases(draft.cases);
      setDecisions(decisionsOf(draft.contract.rules));
      setSettingsDirty(false);
      setReviewDirty(false);
      setEvidenceRevision((value) => value + 1);
      onConnected(connected.project);
      const status = await api.gateReadiness(project.id);
      if (active.current && version === epoch.current) setReadiness(status);
      if (active.current && version === epoch.current) await onUpdated();
    } catch (error) {
      if (active.current && version === epoch.current) setProblem((error as Error).message);
    } finally {
      if (active.current && version === epoch.current) setBusy('');
    }
  }

  async function saveRules(): Promise<void> {
    if (pending.length > 0 || settingsDirty) return;
    const version = ++epoch.current;
    const confirmed = rules
      .filter((rule) => decisions[rule.id] === 'confirmed')
      .map((rule) => rule.id);
    const rejected = rules
      .filter((rule) => decisions[rule.id] === 'rejected')
      .map((rule) => rule.id);
    setBusy('review');
    setProblem('');
    setReadiness(null);
    try {
      // Suite construction and transport must use exactly the same confirmations.
      const installed = await api.packSuite(
        project.id,
        { confirmedRuleIds: confirmed },
        confirmed,
        rejected,
      );
      if (!active.current || version !== epoch.current) return;
      setRules(installed.contract.rules);
      setCases(installed.cases);
      setDecisions(decisionsOf(installed.contract.rules));
      setReviewDirty(false);
      setEvidenceRevision((value) => value + 1);
      const status = await api.gateReadiness(project.id);
      if (active.current && version === epoch.current) setReadiness(status);
      if (active.current && version === epoch.current) await onUpdated();
    } catch (error) {
      if (active.current && version === epoch.current) setProblem((error as Error).message);
    } finally {
      if (active.current && version === epoch.current) setBusy('');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h2 className="text-section font-semibold">Helpdesk release check</h2>
        <p className="text-body text-secondary">
          Twin → explicit rules → your HTTP agent → readiness → run and evidence. Results cover the
          checked scenarios and observable state, not everything an agent could do.
        </p>
      </header>
      <Panel padded>
        <div className="flex max-w-2xl flex-col gap-4">
          <SectionLabel>1. Connect the twin</SectionLabel>
          <Tag tone="neutral">
            <span data-testid="pack-id">Helpdesk · local twin</span>
          </Tag>
          <p className="text-meta text-muted">
            Start <code>rigorrun helpdesk twin</code> in a terminal with your local build and paste
            its MCP URL below. Point your agent at this same twin, using its own scoped token. The
            connection is configured here; the run checks whether the twin is available.
          </p>
          <Field
            label="Local twin MCP URL"
            hint="Use the twin on this machine, ending in /mcp. Every case creates test records."
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                describedBy={describedBy}
                value={url}
                onChange={(value) => {
                  invalidateSettings();
                  setUrl(value);
                }}
                testId="pack-url"
              />
            )}
          </Field>
          <Field
            label="What kind of system is this?"
            hint="Choose explicitly before RigorRun may write test records."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                describedBy={describedBy}
                value={safety}
                onChange={(value) => {
                  invalidateSettings();
                  setSafety(value as ProjectView['safety']);
                }}
                placeholder="Choose the safety of this twin"
                testId="pack-safety"
                options={[
                  { value: 'local', label: 'Local — a test system on this machine' },
                  { value: 'ephemeral', label: 'Ephemeral — disposable test records' },
                ]}
              />
            )}
          </Field>
          {url && !localTwinUrl(url) ? (
            <p className="text-meta text-fail">
              Enter an http URL on localhost or 127.0.0.1 ending in /mcp.
            </p>
          ) : null}
          <div>
            <Button
              onClick={connect}
              disabled={busy !== '' || !safety || !localTwinUrl(url)}
              testId="pack-connect"
            >
              {busy === 'connect' ? 'Connecting…' : 'Connect twin and draft rules'}
            </Button>
          </div>
        </div>
      </Panel>
      {problem ? <Problem>{problem}</Problem> : null}
      {!settingsDirty && rules.length > 0 ? (
        <Panel padded>
          <div className="flex flex-col gap-4" data-testid="pack-rules">
            <SectionLabel>2. Decide the rules</SectionLabel>
            <p className="text-body text-secondary">
              Decide each proposed rule. Pending decisions block release readiness.
            </p>
            <p className="text-meta text-muted">
              Rejected rules are not enforced. A passing result does not establish their boundaries.
            </p>
            {rules.map((rule) => (
              <Field key={rule.id} label={rule.statement} hint={rule.question?.text}>
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    describedBy={describedBy}
                    value={decisions[rule.id] ?? 'pending'}
                    onChange={(value) => {
                      epoch.current++;
                      setDecisions((current) => ({ ...current, [rule.id]: value as Decision }));
                      setReviewDirty(true);
                      setReadiness(null);
                      setBusy('');
                      setEvidenceRevision((current) => current + 1);
                    }}
                    testId={`pack-decision-${rule.id}`}
                    options={[
                      { value: 'pending', label: 'Pending — no decision yet' },
                      { value: 'confirmed', label: 'Confirm — enforce this rule' },
                      { value: 'rejected', label: 'Reject — do not enforce this rule' },
                    ]}
                  />
                )}
              </Field>
            ))}
            <p className="text-meta text-muted">
              {cases.length} bundled cases · {pending.length} decision(s) pending
            </p>
            <div>
              <Button
                onClick={saveRules}
                disabled={busy !== '' || pending.length > 0}
                testId="pack-save-rules"
              >
                {busy === 'review' ? 'Saving decisions…' : 'Save decisions and install suite'}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}
      {!settingsDirty && rules.length > 0 ? (
        <Panel padded>
          <div className="flex flex-col gap-3" data-testid="pack-readiness">
            <SectionLabel>Release readiness</SectionLabel>
            <p className="text-body text-fg">
              {ready ? 'Ready for the checked suite' : 'Not ready'}
            </p>
            <p className="text-meta text-muted">
              This checks the suite's review and freshness. It does not check your agent's health or
              promise safety.
            </p>
            {readiness?.reasons.length ? (
              <ul className="list-disc pl-5 text-meta text-secondary">
                {readiness.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : pending.length > 0 || reviewDirty ? (
              <p className="text-meta text-muted">
                Save explicit decisions for every proposed rule.
              </p>
            ) : null}
            <div>
              <Button
                variant="secondary"
                onClick={() => void checkReadiness()}
                disabled={busy !== ''}
                testId="pack-check-readiness"
              >
                {busy === 'readiness' ? 'Checking…' : 'Check readiness'}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}
      {ready ? (
        <>
          <SectionLabel>3. Connect your own HTTP agent</SectionLabel>
          <ConnectAgent
            project={project}
            onConnected={onConnected}
            onDraftChanged={() => setEvidenceRevision((value) => value + 1)}
          />
          <SectionLabel>4. Run and inspect the evidence</SectionLabel>
          <RunAndVerdict
            key={`${project.id}:${evidenceRevision}`}
            project={project}
            activation={activation}
            beforeRun={checkReadiness}
            onRan={() => void onUpdated()}
          />
        </>
      ) : null}
      {reviewed && project.runs.length > 0 ? (
        <Panel padded>
          <div className="flex flex-col gap-3" data-testid="pack-history">
            <SectionLabel>Saved runs</SectionLabel>
            <p className="text-meta text-muted">
              Historical results belong to the suite and connection used for that run. Run again for
              fresh evidence.
            </p>
            <ul className="flex flex-col gap-2">
              {project.runs.map((run) => (
                <li key={run.runId} className="flex flex-wrap items-center gap-3 text-meta">
                  <span>
                    {run.agentName} · {run.finishedAt}
                  </span>
                  <a
                    className="text-accent underline"
                    href={`/api/projects/${project.id}/runs/${run.runId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Saved run JSON
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-meta text-muted">
              For a fresh CLI gate and HTML report in this same workspace:
            </p>
            <code className="break-all text-meta">
              rigorrun gate --project {project.id} --agent &lt;agent-id&gt; --report
              ./release-check.html
            </code>
            <p className="text-meta text-muted">
              If you started the runner with a custom --home, pass that same path to this command.
            </p>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function localTwinUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      url.pathname === '/mcp' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
