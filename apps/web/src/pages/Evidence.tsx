/**
 * The evidence page.
 *
 * The only page on this site whose numbers come from software nobody here
 * wrote. Everything below is read from `evidence.json`, written by
 * `node scripts/build-evidence.mjs` running the shipped `rigorrun verify`
 * against four published third-party MCP servers.
 *
 * The page leads with what the run could not reach. Half of a typical server's
 * surface is not exercisable by a harness with no credentials and no fixtures,
 * and a page that showed only the half that worked would be describing a
 * different product.
 */
import { Mono, Panel, SectionLabel, Tag } from '../components/primitives.tsx';
import evidence from '../evidence.json';

const EXIT_MEANING: Record<number, string> = {
  0: 'verified, nothing contradicted',
  1: 'a declaration was contradicted',
  3: 'ran, established too little to mean much',
};

/** Every value of `UntestedReason`, so a new one cannot render as a raw enum. */
const REASON_MEANING: Record<string, string> = {
  NEEDS_FIXTURE: 'needs a fixture the harness will not invent',
  NEEDS_CREDENTIAL: 'needs a credential the harness does not have',
  UNSAFE_TO_EXERCISE: 'declared destructive, and believed rather than tried',
  UNDETERMINED: 'exercised, and the result settled nothing',
};

export function Evidence() {
  const { totals, servers } = evidence;
  const exercisedShare = totals.toolsDiscovered
    ? (totals.toolsExercised / totals.toolsDiscovered) * 100
    : 0;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-10">
      <SectionLabel>Evidence</SectionLabel>
      <h1 className="mt-3 text-display font-semibold">
        Four servers we did not write.
      </h1>
      <p className="mt-4 max-w-3xl text-body text-secondary">
        Each one was fetched from the public registry, pinned to the exact bytes the registry
        published, and run in a container with no network, no mounts and no access to this
        machine. Every tool was called with arguments derived from its own schema, and the
        container&rsquo;s filesystem was read before and after to see what actually changed. Then
        that was compared against what the server declared about itself.
      </p>
      <p className="mt-3 max-w-3xl text-body text-secondary">
        Reproduce any row with one command:{' '}
        <Mono className="text-fg">rigorrun verify {servers[0]?.ref}</Mono>
      </p>

      {/* ------------------------------------------------ the denominator */}
      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <Panel className="p-6">
          <h2 className="text-section font-semibold">What it reached</h2>
          <p className="mt-3 text-body text-secondary">
            <span className="font-mono text-fg">
              {totals.toolsExercised} of {totals.toolsDiscovered}
            </span>{' '}
            tools were exercised — {exercisedShare.toFixed(0)}%. The other {totals.toolsUntested}{' '}
            are named below with the reason each one was not.
          </p>
          <p className="mt-3 text-meta text-secondary">
            That is the shape of the answer and it is worth stating plainly rather than tuning
            away: a general harness with no credentials and no fixtures verifies about half of a
            typical server&rsquo;s surface. A fabricated 100% would be worth less than a measured{' '}
            {exercisedShare.toFixed(0)}% with the remainder itemised.
          </p>
        </Panel>

        <Panel className="p-6">
          <h2 className="text-section font-semibold">What this does not establish</h2>
          <ul className="mt-3 grid gap-2 text-meta text-secondary">
            <li>
              <span className="text-fg">Nothing about the wider registry.</span> Four servers, all
              published by <Mono>{evidence.publisher}</Mono>, all well maintained. That is the
              weakest possible sample.
            </li>
            <li>
              <span className="text-fg">No security claim about any of them.</span> A server that
              contradicted nothing here contradicted nothing <em>this harness can observe</em>, on
              the tools it could exercise, at one digest, on one day.
            </li>
            <li>
              <span className="text-fg">No claim that unexercised tools are safe.</span> They are
              unexercised.
            </li>
            <li>
              <span className="text-fg">No market validation.</span> Our own scan is not a user.
            </li>
          </ul>
        </Panel>
      </section>

      {/* ------------------------------------------------------ per server */}
      <section className="mt-10 grid gap-4">
        {servers.map((server) => (
          <Panel key={server.ref} className="overflow-hidden">
            <div className="border-b border-line bg-raised px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Mono className="text-fg">{server.ref}</Mono>
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={server.contradicted > 0 ? 'fail' : 'pass'} mono>
                    exit {server.exitCode}
                  </Tag>
                  <span className="text-meta text-muted">
                    {EXIT_MEANING[server.exitCode] ?? 'unknown result'}
                  </span>
                </div>
              </div>
              <p className="mt-1.5 break-all font-mono text-[11px] text-muted">
                {server.digest}
              </p>
            </div>

            <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
              <Cell label="Tools discovered" value={String(server.toolsDiscovered)} />
              <Cell
                label="Exercised"
                value={`${server.toolsExercised} of ${server.toolsDiscovered}`}
              />
              <Cell label="Contradicted" value={String(server.contradicted)} />
              <Cell label="Undetermined" value={String(server.undetermined)} />
            </div>

            <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
              <Cell
                label="Isolation"
                value={`${server.isolation} · ${server.resets} starts compared`}
              />
              <Cell label="Network egress" value={server.networkEgress ? 'permitted' : 'none'} />
              <Cell label="Server reports" value={`${server.serverName} ${server.serverVersion}`} />
              <Cell label="Base image" value={server.baseImage.slice(0, 26) + '…'} />
            </div>

            {server.untested.length > 0 && (
              <div className="border-t border-line px-4 py-3">
                <SectionLabel>Not exercised</SectionLabel>
                <ul className="mt-2 grid gap-1 text-meta text-secondary sm:grid-cols-2">
                  {server.untested.map((item) => (
                    <li key={item.tool}>
                      <Mono className="text-fg">{item.tool}</Mono>{' '}
                      <span className="text-muted">
                        — {REASON_MEANING[item.reason] ?? item.reason.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        ))}
      </section>

      {/* -------------------------------------------------------- caveats */}
      <section className="mt-8">
        <Panel className="p-6">
          <h2 className="text-section font-semibold">
            What the harness itself cannot do
          </h2>
          <p className="mt-2 text-meta text-muted">
            Carried on every record it writes, not only on this page.
          </p>
          <ul className="mt-3 grid gap-2 text-meta text-secondary">
            {(servers[0]?.caveats ?? []).map((caveat) => (
              <li key={caveat}>· {caveat}</li>
            ))}
          </ul>
        </Panel>
      </section>

      {/* ----------------------------------------------------- provenance */}
      <footer className="mt-8 border-t border-line pt-4 text-meta text-muted">
        Produced by <Mono>node scripts/build-evidence.mjs</Mono> at commit{' '}
        <Mono className="text-secondary">{evidence.commit}</Mono> on{' '}
        {new Date(evidence.generatedAt).toISOString().slice(0, 10)}, using RigorRun{' '}
        <Mono className="text-secondary">{evidence.rigorrunVersion}</Mono> and Docker{' '}
        <Mono className="text-secondary">{evidence.dockerVersion}</Mono>. Took{' '}
        {(evidence.generationMs / 1000).toFixed(0)}s. Re-run it and compare.
      </footer>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <SectionLabel>{label}</SectionLabel>
      <p className="mt-1 font-mono text-meta text-fg">{value}</p>
    </div>
  );
}
