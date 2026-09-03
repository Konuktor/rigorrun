import { useEffect, useState } from 'react';
import { Landing } from './pages/Landing.tsx';
import { DemoPage } from './demo/DemoPage.tsx';
import { Wordmark } from './components/primitives.tsx';

type Route = 'home' | 'demo';

function currentRoute(): Route {
  return window.location.hash.startsWith('#/demo') ? 'demo' : 'home';
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const go = (next: Route) => {
    window.location.hash = next === 'demo' ? '#/demo' : '#/';
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <button
            type="button"
            onClick={() => go('home')}
            className="text-left"
            data-testid="brand"
          >
            <Wordmark />
          </button>
          <nav className="flex items-center gap-4 text-[13px]">
            <span className="hidden text-dim sm:inline">
              Do the job once. Test every agent forever.
            </span>
            <button
              type="button"
              onClick={() => go(route === 'demo' ? 'home' : 'demo')}
              data-testid="nav-demo"
              className="rounded-lg border border-line px-3 py-1.5 hover:border-dim"
            >
              {route === 'demo' ? 'Overview' : 'Run the demo'}
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {route === 'demo' ? <DemoPage /> : <Landing onRunDemo={() => go('demo')} />}
      </main>

      <footer className="border-t border-line px-5 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-[12px] text-dim">
          <span>
            RigorRun 0.1.0 — early MVP. Northstar Support is a synthetic demo environment.
          </span>
          <span>Local-first. Nothing leaves this machine unless you publish it.</span>
        </div>
      </footer>
    </div>
  );
}
