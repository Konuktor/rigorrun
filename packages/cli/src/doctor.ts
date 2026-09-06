/**
 * `rigorrun doctor` — the thing to run before asking anybody for help.
 *
 * Written against the failure classes people actually hit rather than the ones
 * that are easy to check. Every check answers a question somebody has already
 * asked in frustration: can this machine start the runner at all, is my
 * project's system reachable from *here*, is the credential it needs actually
 * present, and is my agent answering.
 *
 * The output is designed to be pasted into a support request, so it names
 * secrets and never prints one, and it reports a project's connector without
 * its credentials.
 */
import { ProjectStore, Service, storeRoot, nextSteps } from '@rigorrun/daemon';
import { ProxyServer } from '@rigorrun/proxy';
import { inspectRuntime } from '@rigorrun/sandbox';
import { describeAgent, probeAgent, probeProcessAgent } from '@rigorrun/daemon';
import { c, heading, line, table } from './ui.ts';
import type { Flags } from './commands.ts';

interface Check {
  what: string;
  ok: boolean | 'unknown';
  detail: string;
}

export async function cmdDoctor(flags: Flags): Promise<number> {
  const checks: Check[] = [];
  const home = storeRoot(flags.home);
  const store = new ProjectStore(home);

  // ------------------------------------------------------------- this machine
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    what: 'node',
    ok: major >= 20,
    detail: major >= 20 ? process.version : `${process.version} — RigorRun needs 20 or newer`,
  });

  let projects: Awaited<ReturnType<ProjectStore['list']>> = [];
  try {
    projects = await store.list();
    checks.push({ what: 'project store', ok: true, detail: `${home} · ${projects.length} project(s)` });
  } catch (error) {
    checks.push({ what: 'project store', ok: false, detail: (error as Error).message });
  }

  const secretNames = await store.secretNames().catch(() => []);
  const backend = await store.secretBackend().catch(() => undefined);
  checks.push({
    what: 'credentials',
    ok: 'unknown',
    // Names only. A diagnostics bundle that prints a secret is a diagnostics
    // bundle nobody can safely send anywhere.
    detail: secretNames.length > 0 ? secretNames.join(', ') : 'none stored',
  });
  checks.push({
    what: 'credential store',
    // Not a pass or a fail. A file at 0600 is a legitimate answer on a machine
    // with no keyring; what would be wrong is not saying which one you got.
    ok: 'unknown',
    detail: backend ? `${backend.kind} — ${backend.detail}` : 'could not be determined',
  });

  // `verify` cannot run without a container runtime, and finding that out
  // after a package has been downloaded is worse than finding it out here.
  // Not a failure: the v1 flow needs no container at all, so a machine without
  // one is fine for most of the product and only closes off `verify`.
  const runtime = await inspectRuntime();
  checks.push({
    what: 'container runtime',
    ok: runtime.available ? true : 'unknown',
    detail: runtime.available
      ? `docker ${runtime.version}${runtime.rootless ? ' (rootless)' : ' — daemon runs as root, so an escape reaches this host'}`
      : `none — \`rigorrun verify\` needs one. ${runtime.detail}`,
  });

  // Binding a port is the first thing the runner does and the first thing a
  // locked-down machine refuses.
  const proxy = new ProxyServer();
  try {
    const port = await proxy.start();
    checks.push({ what: 'loopback port', ok: port > 0, detail: `bound 127.0.0.1:${port}` });
  } catch (error) {
    checks.push({ what: 'loopback port', ok: false, detail: (error as Error).message });
  }

  heading('This machine');
  printChecks(checks);

  // ----------------------------------------------------------------- projects
  if (projects.length === 0) {
    line();
    line(c.grey('No projects yet. Run `rigorrun` and make one.'));
    await proxy.stop();
    if (flags.json) line(JSON.stringify({ checks }, null, 2));
    return checks.some((check) => check.ok === false) ? 2 : 0;
  }

  const service = new Service({ store, proxy });
  const perProject: { project: string; checks: Check[] }[] = [];

  for (const project of projects) {
    const own: Check[] = [];

    if (!project.connector) {
      own.push({ what: 'system', ok: false, detail: 'nothing connected yet' });
    } else {
      const missing = [];
      for (const name of project.connector.secretNames) {
        if ((await store.secret(name)) === undefined) missing.push(name);
      }
      if (missing.length > 0) {
        own.push({
          what: 'credentials',
          ok: false,
          detail: `${missing.join(', ')} not set on this machine`,
        });
      }

      // The check worth having: reach the system from here, now.
      try {
        const connection = await service.workspace.connect(project);
        own.push({
          what: 'system',
          ok: true,
          detail:
            `${connection.discovery.serverName} · ${connection.discovery.tools.length} tools · ` +
            `${connection.discovery.latencyMs}ms`,
        });
        await service.workspace.disconnect(project.id);
      } catch (error) {
        own.push({ what: 'system', ok: false, detail: (error as Error).message });
      }
    }

    own.push({
      what: 'verifier reads',
      ok: project.verifierReads.length > 0,
      detail:
        project.verifierReads.length > 0
          ? project.verifierReads.map((read) => read.tool).join(', ')
          : 'none — nothing could be verified',
    });

    own.push({
      what: 'reset',
      ok: project.reset.kind === 'tool',
      detail:
        project.reset.kind === 'tool'
          ? project.reset.tool
          : 'none — cases cannot be isolated, repeats are off',
    });

    for (const agent of project.agents) {
      // Probed for real, both kinds. `doctor` exists to answer "would a run
      // work right now", and an agent that was answering yesterday is not an
      // answer to that.
      if (agent.kind === 'external') {
        // Nothing to probe from here. This agent is driven by whoever holds
        // its key, and only the running runner can see one arrive.
        own.push({
          what: `agent ${agent.name}`,
          ok: agent.lastProbeOk,
          detail: agent.lastProbeOk
            ? 'driven by you — it has asked this runner for work'
            : 'driven by you — it has not asked for work yet',
        });
        continue;
      }
      const probe =
        agent.kind === 'process'
          ? await probeProcessAgent({
              command: agent.command,
              args: agent.args,
              ...(agent.cwd ? { cwd: agent.cwd } : {}),
            })
          : await probeAgent({ endpoint: agent.endpoint });
      own.push({
        what: `agent ${agent.name}`,
        ok: probe.ok,
        detail: probe.ok ? `answering — ${describeAgent(agent)}` : probe.problem,
      });
    }
    if (project.agents.length === 0) {
      own.push({ what: 'agent', ok: false, detail: 'none connected' });
    }

    perProject.push({ project: project.name, checks: own });

    heading(project.name);
    printChecks(own);
    const next = nextSteps(project);
    if (next.length > 0) line(c.grey(`next: ${next[0]!.what}`));
  }

  await service.workspace.close();
  await proxy.stop();

  if (flags.json) {
    line(JSON.stringify({ machine: checks, projects: perProject }, null, 2));
  }

  // A failing check is a configuration problem, which is exit 2 by the same
  // contract the gate uses: never confused with an agent that did badly.
  const failed = [...checks, ...perProject.flatMap((entry) => entry.checks)].some(
    (check) => check.ok === false,
  );
  return failed ? 2 : 0;
}

function printChecks(checks: readonly Check[]): void {
  table(
    ['check', '', 'detail'],
    checks.map((check) => [
      check.what,
      check.ok === true ? c.green('ok') : check.ok === false ? c.red('problem') : c.grey('—'),
      check.detail,
    ]),
  );
}
