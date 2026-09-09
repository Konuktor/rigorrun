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
import { lazy, Suspense, useEffect, useState } from 'react';
import { Landing } from './pages/Landing.tsx';
import { Quickstart } from './pages/Quickstart.tsx';

/**
 * The demo runs the real compiler, generator, runner and verifier in the
 * browser — that is what makes it evidence rather than a video. It is also
 * most of the bundle, and until now every project page paid for it: somebody
 * connecting their own system downloaded the whole engine and the entire
 * bundled example in order to look at a form.
 *
 * So the two pages that are only ever reached deliberately are split out. The
 * product path loads what the product path needs.
 */
const DemoPage = lazy(() =>
  import('./demo/DemoPage.tsx').then((m) => ({ default: m.DemoPage })),
);
const Evidence = lazy(() => import('./pages/Evidence.tsx').then((m) => ({ default: m.Evidence })));

/**
 * One place for the repository address.
 *
 * A path into a checkout is useless to somebody who installed from npm and has
 * no checkout, so every route out of this page is an absolute URL.
 */
export const REPO_URL = 'https://github.com/Konuktor/rigorrun';
import { Button, Spinner, Wordmark } from './components/primitives.tsx';
import { ProjectsPage } from './product/ProjectsPage.tsx';
import { ProjectPage } from './product/ProjectPage.tsx';
import { api } from './product/api.ts';
import { RIGORRUN_VERSION } from './version.ts';

type Route = 'home' | 'demo' | 'evidence' | 'projects' | 'project' | 'quickstart';

function currentRoute(): { route: Route; projectId?: string } {
  const hash = window.location.hash;
  if (hash.startsWith('#/demo')) return { route: 'demo' };
  // `#/proof` was this page's address for the whole of 0.1. It is a link
  // people may have, so it still resolves rather than silently landing on the
  // homepage the way every other unknown hash does.
  if (hash.startsWith('#/evidence') || hash.startsWith('#/proof')) return { route: 'evidence' };
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
        : route === 'evidence'
          ? 'Evidence — RigorRun'
          : route === 'projects' || route === 'project'
            ? 'Projects — RigorRun'
            : route === 'quickstart'
              ? 'Get started — RigorRun'
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
                {/* Real anchors, not buttons. The whole page used to have two
                    links on it, so nothing here was crawlable and there was no
                    route to the documentation or the source. A real hit area
                    too: the release gate measures every control and one of
                    these was 17px tall. */}
                <a
                  href="#/evidence"
                  data-testid="nav-evidence"
                  className={`inline-flex h-9 items-center rounded-control px-2 text-meta ${
                    route === 'evidence' ? 'text-fg' : 'text-muted hover:text-fg'
                  }`}
                >
                  Evidence
                </a>
                <a
                  href={`${REPO_URL}/tree/master/docs`}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="nav-docs"
                  // Four controls do not fit beside the wordmark at 390px, and
                  // the release gate measures that. Docs is the one that also
                  // lives in the footer, so it is the one that folds.
                  className="hidden h-9 items-center rounded-control px-2 text-meta text-muted hover:text-fg sm:inline-flex"
                >
                  Docs
                </a>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="nav-github"
                  className="inline-flex h-9 items-center rounded-control px-2 text-meta text-muted hover:text-fg"
                >
                  GitHub
                </a>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => go('#/quickstart')}
                  testId="nav-get-started"
                >
                  Get started
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {runner === null ? (
          <PageLoading />
        ) : route === 'demo' ? (
          <Suspense fallback={<PageLoading />}>
            <DemoPage />
          </Suspense>
        ) : route === 'evidence' ? (
          <Suspense fallback={<PageLoading />}>
            <Evidence />
          </Suspense>
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
          <Landing
            onTestYourAgent={() => go('#/quickstart')}
            onRunDemo={() => go('#/demo/record')}
            onSeeEvidence={() => go('#/evidence')}
          />
        )}
      </main>

      {/* Not rendered until there is content to sit under.
          While the runner probe was in flight the page was a spinner and this
          footer, which put it in the middle of a phone's viewport; when the
          real content arrived the footer moved off the bottom of the screen.
          That single movement was a CLS of 0.17 against a budget of 0.1 — the
          whole of the mobile score. Appearing in its final position moves
          nothing. */}
      {runner === null ? null : (
      <footer className="border-t border-line px-5 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-meta text-muted">
          {/* The version the runner reports, not one typed in here. It ends up
              in bug reports, so it has to be the one somebody is running. */}
          <span>
            {/* A path into the repository is useless to somebody who installed
                from npm and has no repository. A link works from both. */}
            RigorRun {local && runner?.version ? `v${runner.version}` : `v${RIGORRUN_VERSION}`} —
            Early Access.{' '}
            <a
              className="inline-flex min-h-[24px] items-center underline hover:text-fg"
              href={`${REPO_URL}/blob/master/docs/V1_GAP_AUDIT.md`}
              target="_blank"
              rel="noreferrer"
            >
              What is and is not built
            </a>
            {' · '}
            {/* The nav folds Docs away on a narrow screen, so the footer keeps
                a route to both from every viewport. */}
            <a
              className="inline-flex min-h-[24px] items-center underline hover:text-fg"
              href={`${REPO_URL}/tree/master/docs`}
              target="_blank"
              rel="noreferrer"
            >
              Docs
            </a>
            {' · '}
            <a
              className="inline-flex min-h-[24px] items-center underline hover:text-fg"
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </span>
          <span>
            {local
              ? 'Your systems, credentials and recordings stay on this machine.'
              : 'Local-first. The runner does the work; this page never sees your systems.'}
          </span>
        </div>
      </footer>
      )}
    </div>
  );
}

/** The same shape as the pre-pairing state, so a split does not read as a jump. */
/**
 * A loading state that reserves the viewport.
 *
 * Without the min-height this is a short page, so the footer renders in the
 * middle of a phone's screen and then moves off the bottom when the real
 * content arrives. That one movement was the whole of the mobile CLS score.
 * A shift below the fold is not a shift anybody sees, and does not count.
 */
function PageLoading() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-6xl items-start gap-2 px-5 py-16 text-body text-muted">
      <Spinner /> Loading…
    </div>
  );
}
