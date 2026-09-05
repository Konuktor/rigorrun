/**
 * One bundle, two products.
 *
 * Served by the runner on somebody's machine, this is the product: their
 * projects, their systems, their agents. Served from the public site, it is the
 * landing page and the bundled example, because there is nothing on that origin
 * it could connect to — a page on https cannot reach http://127.0.0.1.
 *
 * Which one it is, it asks. Baking a flag in at build time would mean two
 * bundles that drift apart, and the answer is one unauthenticated request.
 */
import { useEffect, useState } from 'react';
import { Landing } from './pages/Landing.tsx';
import { Proof } from './pages/Proof.tsx';
import { Quickstart } from './pages/Quickstart.tsx';
import { DemoPage } from './demo/DemoPage.tsx';
import { Button, Spinner, Wordmark } from './components/primitives.tsx';
import { ProjectsPage } from './product/ProjectsPage.tsx';
import { ProjectPage } from './product/ProjectPage.tsx';
import { api } from './product/api.ts';

type Route = 'home' | 'demo' | 'proof' | 'projects' | 'project' | 'quickstart';

function currentRoute(): { route: Route; projectId?: string } {
  const hash = window.location.hash;
  if (hash.startsWith('#/demo')) return { route: 'demo' };
  if (hash.startsWith('#/proof')) return { route: 'proof' };
  if (hash.startsWith('#/quickstart')) return { route: 'quickstart' };
  const project = /^#\/projects\/([A-Za-z0-9_-]+)/.exec(hash);
  if (project?.[1]) return { route: 'project', projectId: project[1] };
  if (hash.startsWith('#/projects')) return { route: 'projects' };
  return { route: 'home' };
}

export function App() {
  const [location, setLocation] = useState(currentRoute);
  const [runner, setRunner] = useState<{
    runner: boolean;
    paired: boolean;
    version: string;
  } | null>(null);

  useEffect(() => {
    const onHashChange = () => setLocation(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    void api.runner().then(setRunner);
  }, []);

  const local = runner?.runner === true;
  const route = location.route === 'home' && local ? 'projects' : location.route;

  useEffect(() => {
    document.title =
      route === 'demo'
        ? 'Live demo — RigorRun'
        : route === 'proof'
          ? 'One compiler, five jobs — RigorRun'
          : route === 'projects' || route === 'project'
            ? 'Projects — RigorRun'
            : route === 'quickstart'
              ? 'Test your agent — RigorRun'
              : 'RigorRun — Acceptance testing for tool-using AI agents';
  }, [route]);

  const go = (hash: string) => {
    window.location.hash = hash;
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="flex min-h-full flex-col">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header
        className="sticky top-0 border-b border-line bg-canvas/90 backdrop-blur"
        style={{ zIndex: 'var(--z-sticky)' }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
          <button
            type="button"
            onClick={() => go(local ? '#/projects' : '#/')}
            className="text-left"
            data-testid="brand"
            aria-label="RigorRun home"
          >
            <Wordmark />
          </button>
          <nav className="flex items-center gap-3" aria-label="Primary">
            {local ? (
              <Button variant="ghost" size="sm" onClick={() => go('#/demo')} testId="nav-demo">
                Bundled example
              </Button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => go('#/proof')}
                  data-testid="nav-proof"
                  // A real hit area, not just a label: the release gate measures
                  // every control on the page and this one was 17px tall.
                  className={`inline-flex h-9 items-center rounded-control px-2 text-meta ${
                    route === 'proof' ? 'text-fg' : 'text-muted hover:text-fg'
                  }`}
                >
                  Five workflows
                </button>
                <Button
                  variant={route === 'demo' ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={() => go(route === 'demo' ? '#/' : '#/demo/record')}
                  testId="nav-demo"
                >
                  {route === 'demo' ? 'Overview' : 'Try the demo'}
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {runner === null ? (
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-5 py-16 text-body text-muted">
            <Spinner /> Loading…
          </div>
        ) : route === 'demo' ? (
          <DemoPage />
        ) : route === 'proof' ? (
          <Proof />
        ) : route === 'quickstart' ? (
          <Quickstart />
        ) : route === 'projects' ? (
          <div className="mx-auto max-w-5xl px-5 py-10">
            <ProjectsPage onOpen={(id) => go(`#/projects/${id}`)} />
          </div>
        ) : route === 'project' && location.projectId ? (
          <div className="mx-auto max-w-5xl px-5 py-10">
            <ProjectPage projectId={location.projectId} onBack={() => go('#/projects')} />
          </div>
        ) : (
          <Landing onTestYourAgent={() => go('#/quickstart')} onRunDemo={() => go('#/demo/record')} onSeeProof={() => go('#/proof')} />
        )}
      </main>

      <footer className="border-t border-line px-5 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-meta text-muted">
          {/* The version the runner reports, not one typed in here. It ends up
              in bug reports, so it has to be the one somebody is running. */}
          <span>
            {/* A path into the repository is useless to somebody who installed
                from npm and has no repository. A link works from both. */}
            RigorRun {local && runner?.version ? runner.version : 'alpha'} — early.{' '}
            <a
              className="underline hover:text-fg"
              href="https://github.com/Konuktor/rigorrun/blob/master/docs/PRODUCT_REALITY_AUDIT.md"
              target="_blank"
              rel="noreferrer"
            >
              What is and is not built
            </a>
            .
          </span>
          <span>
            {local
              ? 'Your systems, credentials and recordings stay on this machine.'
              : 'Local-first. The runner does the work; this page never sees your systems.'}
          </span>
        </div>
      </footer>
    </div>
  );
}
