/**
 * The local product.
 *
 * This used to be one bundle serving two products: it probed for a runner on
 * boot and, if none answered, rendered the marketing site instead. That meant
 * every visitor to rigorrun.xyz downloaded the whole product UI, every person
 * running `npx rigorrun` downloaded the landing page, and the first paint of
 * both was gated on a network request. The public site is now its own static
 * build, and this is only ever the thing the runner serves.
 */
import { lazy, Suspense, useEffect, useState } from 'react';

/**
 * The bundled example runs the real compiler, generator, runner and verifier
 * in the browser — that is what makes it a demonstration rather than a video.
 * It is also most of the bundle, so somebody connecting their own system does
 * not download it in order to look at a form.
 */
const DemoPage = lazy(() => import('./demo/DemoPage.tsx').then((m) => ({ default: m.DemoPage })));

/**
 * One place for the repository address. A path into a checkout is useless to
 * somebody who installed from npm and has no checkout, so every route out of
 * here is an absolute URL.
 */
export const REPO_URL = 'https://github.com/Konuktor/rigorrun';
export const SITE_URL = 'https://rigorrun.xyz';

/**
 * Injected by vite.config.ts, which resolves the custom domain at build time
 * and falls back to the deployment's own hostname while it has no DNS record.
 * This interface ships inside the npm package, so a link that does not resolve
 * would sit in the header of every install until the next release.
 */
declare const __RIGORRUN_DOCS__: string;
export const DOCS_URL = __RIGORRUN_DOCS__;

import { Spinner, Wordmark } from './components/primitives.tsx';
import { ProjectsPage } from './product/ProjectsPage.tsx';
import { ProjectPage } from './product/ProjectPage.tsx';
import { api } from './product/api.ts';
import { RIGORRUN_VERSION } from './version.ts';

type Route = 'projects' | 'project' | 'demo';

function currentRoute(): { route: Route; projectId?: string } {
  const hash = window.location.hash;
  if (hash.startsWith('#/demo')) return { route: 'demo' };
  const project = /^#\/projects\/([A-Za-z0-9_-]+)/.exec(hash);
  if (project?.[1]) return { route: 'project', projectId: project[1] };
  return { route: 'projects' };
}

const TITLES: Record<Route, string> = {
  projects: 'Projects — RigorRun',
  project: 'Project — RigorRun',
  demo: 'Bundled example — RigorRun',
};

export function App() {
  const [location, setLocation] = useState(currentRoute);
  /**
   * The version the runner reports, which is the one somebody is actually
   * running and the one that ends up in a bug report. It starts at the build
   * constant so the page renders complete on first paint — the previous
   * version held the entire UI behind this request, which cost a spinner on
   * every load and a 0.17 layout shift when it resolved.
   */
  const [version, setVersion] = useState(RIGORRUN_VERSION);

  useEffect(() => {
    const onHashChange = () => setLocation(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    void api.runner().then((info) => {
      if (info?.version) setVersion(info.version);
    });
  }, []);

  const { route, projectId } = location;

  useEffect(() => {
    document.title = TITLES[route];
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
        <div className="mx-auto flex h-14 max-w-[var(--container-app)] items-center justify-between gap-4 px-[var(--spacing-gutter)]">
          <a href="#/projects" className="rounded-control" data-testid="brand" aria-label="Projects">
            <Wordmark />
          </a>
          <nav className="flex items-center gap-1" aria-label="Primary">
            <a
              href="#/demo"
              data-testid="nav-demo"
              className={`inline-flex h-9 items-center rounded-control px-2.5 text-meta ${
                route === 'demo' ? 'text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              Bundled example
            </a>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="nav-docs"
              className="inline-flex h-9 items-center rounded-control px-2.5 text-meta text-muted hover:text-fg"
            >
              Docs
            </a>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {route === 'demo' ? (
          <Suspense fallback={<PageLoading />}>
            <DemoPage />
          </Suspense>
        ) : route === 'project' && projectId ? (
          <div className="mx-auto max-w-[var(--container-app)] px-[var(--spacing-gutter)] py-10">
            <ProjectPage projectId={projectId} onBack={() => go('#/projects')} />
          </div>
        ) : (
          <div className="mx-auto max-w-[var(--container-app)] px-[var(--spacing-gutter)] py-10">
            <ProjectsPage onOpen={(id) => go(`#/projects/${id}`)} />
          </div>
        )}
      </main>

      <footer className="border-t border-line px-[var(--spacing-gutter)] py-6">
        <div className="mx-auto flex max-w-[var(--container-app)] flex-wrap items-center justify-between gap-3 text-meta text-muted">
          <span>
            RigorRun v{version} — Early Access.{' '}
            <a
              className="inline-flex min-h-[24px] items-center underline hover:text-fg"
              href={`${SITE_URL}/what-is-built`}
              target="_blank"
              rel="noreferrer"
            >
              What is and is not built
            </a>
            {' · '}
            <a
              className="inline-flex min-h-[24px] items-center underline hover:text-fg"
              href={DOCS_URL}
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
          <span>Your systems, credentials and recordings stay on this machine.</span>
        </div>
      </footer>
    </div>
  );
}

/**
 * Reserves the viewport so the lazy chunk arriving does not move the footer.
 * A shift below the fold is not a shift anybody sees; one that pushes the
 * footer off a phone screen is.
 */
function PageLoading() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[var(--container-app)] items-start gap-2 px-[var(--spacing-gutter)] py-16 text-body text-muted">
      <Spinner /> Loading…
    </div>
  );
}
