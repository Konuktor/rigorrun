import { useEffect, useState } from 'react';
import { Landing } from './pages/Landing.tsx';
import { Proof } from './pages/Proof.tsx';
import { DemoPage } from './demo/DemoPage.tsx';
import { Button, Wordmark } from './components/primitives.tsx';

type Route = 'home' | 'demo' | 'proof';

function currentRoute(): Route {
  if (window.location.hash.startsWith('#/demo')) return 'demo';
  if (window.location.hash.startsWith('#/proof')) return 'proof';
  return 'home';
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title =
      route === 'demo'
        ? 'Live demo — RigorRun'
        : route === 'proof'
          ? 'One compiler, five jobs — RigorRun'
          : 'RigorRun — Do the job once. Test every agent forever.';
  }, [route]);

  const go = (next: Route) => {
    window.location.hash = next === 'demo' ? '#/demo/record' : next === 'proof' ? '#/proof' : '#/';
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
            onClick={() => go('home')}
            className="text-left"
            data-testid="brand"
            aria-label="RigorRun home"
          >
            <Wordmark />
          </button>
          <nav className="flex items-center gap-3" aria-label="Primary">
            <button
              type="button"
              onClick={() => go('proof')}
              data-testid="nav-proof"
              className={`text-meta ${route === 'proof' ? 'text-fg' : 'text-muted hover:text-fg'}`}
            >
              Five workflows
            </button>
            <Button
              variant={route === 'demo' ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => go(route === 'demo' ? 'home' : 'demo')}
              testId="nav-demo"
            >
              {route === 'demo' ? 'Overview' : 'Run the live demo'}
            </Button>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {route === 'demo' ? (
          <DemoPage />
        ) : route === 'proof' ? (
          <Proof />
        ) : (
          <Landing onRunDemo={() => go('demo')} onSeeProof={() => go('proof')} />
        )}
      </main>

      <footer className="border-t border-line px-5 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-meta text-muted">
          <span>
            RigorRun 0.1.0 — early MVP. Every demo environment is synthetic.
          </span>
          <span>Local-first. Nothing leaves this machine unless you publish it.</span>
        </div>
      </footer>
    </div>
  );
}
