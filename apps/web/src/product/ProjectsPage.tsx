/**
 * What you see when the runner is up: your projects.
 *
 * Not a demo, not a tour. If there are none, the page is one form, because the
 * only useful thing a person can do at that moment is make one — and the
 * example is offered underneath as a way out for somebody who is not ready,
 * rather than as the thing being sold.
 */
import { useEffect, useState } from 'react';
import { Button, Panel, SectionLabel, Spinner } from '../components/primitives.tsx';
import { Field, Problem, TextInput } from './inputs.tsx';
import { api, type ProjectView } from './api.ts';

export function ProjectsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    api
      .projects()
      .then((result) => setProjects(result.projects))
      .catch((error: Error) => {
        setProblem(error.message);
        setProjects([]);
      });
  }, []);

  async function create(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const created = await api.createProject(name.trim(), goal.trim());
      onOpen(created.project.id);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (projects === null) {
    return (
      <div className="flex items-center gap-2 text-body text-muted">
        <Spinner /> Reading your projects…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-title font-semibold">Projects</h1>
        <p className="max-w-2xl text-body text-secondary">
          A project is one job you want an agent to do, in one of your systems. Everything about it
          — the connection, what it learned, your recordings — stays on this machine.
        </p>
      </header>

      {problem ? <Problem>{problem}</Problem> : null}

      {projects.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionLabel>Yours</SectionLabel>
          <ul className="flex flex-col gap-3">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectCard project={project} onOpen={() => onOpen(project.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionLabel>{projects.length > 0 ? 'New project' : 'Start here'}</SectionLabel>
        <Panel>
          <div className="flex max-w-xl flex-col gap-4">
            <Field
              label="What is it called?"
              hint="Something you will recognise in a list later."
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  value={name}
                  onChange={setName}
                  placeholder="My agent"
                  testId="project-name"
                  autoFocus
                />
              )}
            </Field>
            <Field
              label="What is the job?"
              hint="One sentence, the way you would explain it to a new colleague. This becomes the instruction your agent is given."
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  value={goal}
                  onChange={setGoal}
                  placeholder="Approve one item of work end to end."
                  testId="project-goal"
                />
              )}
            </Field>
            <div>
              <Button onClick={create} disabled={busy || name.trim().length === 0} testId="create-project">
                {busy ? 'Creating…' : 'Create project'}
              </Button>
            </div>
          </div>
        </Panel>
      </section>

      {projects.length === 0 ? (
        <p className="text-meta text-muted">
          Not ready to connect anything?{' '}
          <a className="text-accent underline underline-offset-2" href="#/demo">
            Walk through the bundled example
          </a>{' '}
          instead. It runs entirely offline and touches nothing of yours.
        </p>
      ) : null}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectView; onOpen: () => void }) {
  const last = project.runs[project.runs.length - 1];
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            onClick={onOpen}
            data-testid={`open-${project.id}`}
            className="text-left text-section font-semibold text-fg hover:text-accent"
          >
            {project.name}
          </button>
          {project.goal ? <p className="text-meta text-muted">{project.goal}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-meta">
          <Fact
            label="Environment"
            value={project.connector ? `MCP · ${project.connector.transport}` : 'not connected'}
          />
          <Fact
            label="Agent"
            value={
              project.agents.length === 0
                ? 'none'
                : `${project.agents.length} · ${project.agents.some((a) => a.lastProbeOk) ? 'answering' : 'not answering'}`
            }
          />
          <Fact
            label="Last run"
            value={
              last
                ? `${(last.taskSuccessRate * 100).toFixed(1)}% · ${last.thresholdsPassed ? 'PASS' : 'FAIL'}`
                : 'never run'
            }
          />
        </div>
      </div>
      {project.nextSteps.length > 0 ? (
        <p className="mt-3 border-t border-line-soft pt-3 text-meta text-muted">
          Next: {project.nextSteps[0]!.what}
        </p>
      ) : null}
    </Panel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted">{label}</span>
      <span className="text-secondary">{value}</span>
    </div>
  );
}
