/**
 * Copying a workspace out, and putting one back.
 *
 * The rule running through all four commands is the same one that decides what
 * `project.json` holds: the *names* of credentials travel, the values do not.
 * A backup gets copied to a laptop, attached to a support thread and forgotten
 * in a downloads folder, and the failure mode of putting a production token in
 * one is not recoverable by deleting the file.
 *
 * So `--with-secrets` exists, it is never the default, and when it is used the
 * command prints every name it wrote so nobody is surprised later.
 *
 * The other rule is about the way back in. A project that arrives in a file
 * carries a connector — a command to run, or a URL to open with your
 * credentials — that somebody else chose. Importing one marks it untrusted, and
 * it will not connect until a person has looked at the command and said yes.
 */
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ProjectStore,
  describeConnectorAction,
  parseProject,
  storeRoot,
  type Project,
} from '@rigorrun/daemon';
import { CliError } from './io.ts';
import { c, heading, line, table } from './ui.ts';
import type { Flags } from './commands.ts';

/** Bumped when the shape of an exported bundle changes. */
const BUNDLE_VERSION = 1;

/** Artefacts worth carrying: everything a project needs to run again. */
const CORE_ARTEFACTS = ['discovery', 'induced', 'schema', 'contract', 'benchmark'] as const;
/** The customer's own data. Only travels when asked for by name. */
const PRIVATE_ARTEFACTS = ['trace', 'demonstration'] as const;

interface Bundle {
  bundleVersion: number;
  exportedAt: string;
  exportedBy: string;
  project: Project;
  artefacts: Record<string, unknown>;
  /** Always present, so an importer is told what to set even without values. */
  secretNames: string[];
  containsSecrets: boolean;
  secrets?: Record<string, string>;
  runs?: { runId: string; result: unknown }[];
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/* ----------------------------------------------------------------- backup */

export async function cmdBackup(flags: Flags): Promise<number> {
  const home = storeRoot(flags.home);
  const destination = resolve(flags.out ?? join(home, 'backups', `manual-${stamp()}`));

  await mkdir(destination, { recursive: true });
  await cp(join(home, 'projects'), join(destination, 'projects'), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  for (const file of ['workspace.json', 'activation.jsonl', 'secrets.index.json']) {
    await cp(join(home, file), join(destination, file), { force: true }).catch(() => undefined);
  }

  const projects = await new ProjectStore(home).listAll();
  heading('Backed up');
  line(`  ${destination}`);
  line();
  line(c.grey(`  ${projects.projects.length} project(s), and the names of your credentials.`));
  // Said rather than assumed. Somebody restoring on a new machine needs to know
  // that this file will not bring their keys with it.
  line(c.grey('  Not your credentials themselves — those stay where they are.'));
  if (projects.broken.length > 0) {
    line(c.grey(`  ${projects.broken.length} unreadable project directory copied as it is.`));
  }
  return 0;
}

export async function cmdRestore(
  from: string | undefined,
  flags: Flags & { force?: boolean | undefined },
): Promise<number> {
  if (!from) throw new CliError('Which backup? Try `rigorrun restore ~/.rigorrun/backups/…`.');
  const source = resolve(from);
  const home = storeRoot(flags.home);

  const projectsDir = join(source, 'projects');
  if (!(await stat(projectsDir).catch(() => undefined))) {
    throw new CliError(`${source} does not look like a RigorRun backup — it has no projects/.`);
  }

  // Read every project before writing any. A restore that fails halfway leaves
  // a workspace that is neither the old one nor the new one, which is worse
  // than either.
  const store = new ProjectStore(home);
  const incoming: Project[] = [];
  const unreadable: string[] = [];
  for (const id of await readdir(projectsDir)) {
    const raw = await readFile(join(projectsDir, id, 'project.json'), 'utf8').catch(() => '');
    if (!raw) {
      unreadable.push(id);
      continue;
    }
    try {
      incoming.push(parseProject(JSON.parse(raw)));
    } catch {
      unreadable.push(id);
    }
  }

  const existing = new Set((await store.listAll()).projects.map((project) => project.id));
  const clashes = incoming.filter((project) => existing.has(project.id)).map((p) => p.id);
  if (clashes.length > 0 && !flags.force) {
    throw new CliError(
      `${clashes.length} project(s) in this backup already exist here: ${clashes.join(', ')}. ` +
        'Pass --force to overwrite them, or restore into a different --home first and look.',
    );
  }

  for (const id of await readdir(projectsDir)) {
    await cp(join(projectsDir, id), join(home, 'projects', id), { recursive: true, force: true });
  }

  heading('Restored');
  table(
    ['id', 'name'],
    incoming.map((project) => [project.id, project.name]),
  );
  if (unreadable.length > 0) {
    line();
    line(
      c.grey(`  ${unreadable.length} directory copied but not readable: ${unreadable.join(', ')}`),
    );
  }
  line();
  line(c.grey('  Credentials are not in a backup. Set them again with `rigorrun secrets set`.'));
  return 0;
}

/* ------------------------------------------------------------ one project */

export async function cmdExportProject(
  projectId: string | undefined,
  flags: Flags & { withSecrets?: boolean | undefined; withRuns?: boolean | undefined },
): Promise<number> {
  if (!projectId) throw new CliError('Which project? Try `rigorrun export-project p_1a2b3c`.');
  const store = new ProjectStore(storeRoot(flags.home));
  const project = await store.read(projectId);

  const artefacts: Record<string, unknown> = {};
  for (const name of CORE_ARTEFACTS) {
    const value = await store.readArtefact(projectId, name);
    if (value !== undefined) artefacts[name] = value;
  }
  // The recording is the customer's own work in their own system, and it can
  // carry values a contract never does. Carried only when asked for.
  if (flags.withSecrets || flags.withRuns) {
    for (const name of PRIVATE_ARTEFACTS) {
      const value = await store.readArtefact(projectId, name);
      if (value !== undefined) artefacts[name] = value;
    }
  }

  const secretNames = project.connector?.secretNames ?? [];
  const bundle: Bundle = {
    bundleVersion: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: 'rigorrun',
    project,
    artefacts,
    secretNames,
    containsSecrets: flags.withSecrets === true,
  };

  if (flags.withSecrets) {
    const all = await store.secrets();
    bundle.secrets = Object.fromEntries(
      secretNames.filter((name) => all[name] !== undefined).map((name) => [name, all[name]!]),
    );
  }
  if (flags.withRuns) {
    bundle.runs = [];
    for (const summary of project.runs) {
      const result = await store.readRun(projectId, summary.runId);
      if (result !== undefined) bundle.runs.push({ runId: summary.runId, result });
    }
  }

  const out = resolve(flags.out ?? `${projectId}.rigorrun.json`);
  await writeFile(out, `${JSON.stringify(bundle, null, 2)}\n`, {
    // A bundle carrying credentials is as sensitive as the store it came from.
    mode: flags.withSecrets ? 0o600 : 0o644,
  });

  heading(`Exported ${project.name}`);
  line(`  ${out}`);
  line();
  if (flags.withSecrets) {
    line(c.red('  This file contains credential values:'));
    // Names, so nobody discovers later what they emailed.
    for (const name of Object.keys(bundle.secrets ?? {})) line(c.red(`    ${name}`));
    line(c.grey('  Written 0600. Do not attach it to anything.'));
  } else {
    line(
      c.grey(`  No credential values. The ${secretNames.length} name(s) it needs travel with it:`),
    );
    for (const name of secretNames) line(c.grey(`    ${name}`));
  }
  return 0;
}

export async function cmdImportProject(
  file: string | undefined,
  flags: Flags & { as?: string | undefined },
): Promise<number> {
  if (!file)
    throw new CliError('Which file? Try `rigorrun import-project p_1a2b3c.rigorrun.json`.');
  const raw = await readFile(resolve(file), 'utf8').catch(() => {
    throw new CliError(`Could not read ${file}.`);
  });

  let bundle: Bundle;
  try {
    bundle = JSON.parse(raw) as Bundle;
  } catch {
    throw new CliError(`${file} is not readable JSON.`);
  }
  if (bundle.bundleVersion !== BUNDLE_VERSION) {
    throw new CliError(
      `This bundle is format ${String(bundle.bundleVersion)}; this RigorRun reads ${BUNDLE_VERSION}.`,
    );
  }

  const store = new ProjectStore(storeRoot(flags.home));
  const source = parseProject(bundle.project);
  // A new id, always. Importing the same bundle twice should give two projects,
  // not silently overwrite the first — and an id chosen by whoever wrote the
  // file should never decide what it lands on top of.
  const id = `p_${Math.random().toString(36).slice(2, 10)}`;

  const imported: Project = {
    ...source,
    id,
    name: flags.as ?? `${source.name} (imported)`,
    // Runs belong to the machine that produced them.
    runs: [],
    baselineRunId: null,
    agents: source.agents.map((agent) => ({
      ...agent,
      // Nothing here has been probed from this machine.
      lastProbeAt: null,
      lastProbeOk: false,
      lastProbeProblem: '',
      // And a command that arrived in a file is not a command anybody here has
      // agreed to run. Cleared unconditionally, whatever the file claimed —
      // the field is written by the person who typed it, and nobody typed this.
      ...(agent.kind === 'process' ? { confirmedByOperatorAt: null } : {}),
    })),
    connectorTrust: { origin: 'imported', confirmedAt: null },
  };
  await store.write(imported);
  for (const [name, value] of Object.entries(bundle.artefacts ?? {})) {
    await store.writeArtefact(id, name, value);
  }
  if (bundle.secrets) {
    for (const [name, value] of Object.entries(bundle.secrets)) await store.setSecret(name, value);
  }

  heading(`Imported as ${imported.name}`);
  line(`  ${id}`);
  line();
  const connector = imported.connector;
  if (connector) {
    line(c.grey('  Its connector, which came from this file rather than from you:'));
    line(`    ${describeConnectorAction(connector)}`);
    line();
    line(c.grey('  RigorRun will not open it until you have read that line and said yes,'));
    line(c.grey(`  in the interface or with \`rigorrun trust ${id}\`.`));
  }
  const missing = (connector?.secretNames ?? []).filter(() => !bundle.secrets);
  if (missing.length > 0) {
    line();
    line(c.grey('  Credentials it needs and this machine does not have:'));
    for (const name of missing) line(c.grey(`    ${name}`));
  }
  return 0;
}

export async function cmdTrust(
  projectId: string | undefined,
  flags: Flags & { yes?: boolean | undefined },
): Promise<number> {
  if (!projectId) throw new CliError('Which project? Try `rigorrun trust p_1a2b3c`.');
  const store = new ProjectStore(storeRoot(flags.home));
  const project = await store.read(projectId);
  const connector = project.connector;
  if (!connector) throw new CliError(`${project.name} has no connector to trust.`);

  heading(`Opening ${project.name} would`);
  line(`  ${describeConnectorAction(connector)}`);
  line();

  if (!flags.yes) {
    line(c.grey('  Read that line. If it is what you expect, run this again with --yes.'));
    // 2, not 1: nothing failed. This is a question waiting for an answer.
    return 2;
  }

  await store.write({
    ...project,
    connectorTrust: {
      origin: project.connectorTrust.origin,
      confirmedAt: new Date().toISOString(),
    },
  });
  line(c.grey('  Trusted. RigorRun will open it from now on.'));
  return 0;
}
