/**
 * Noticing that somebody else's system changed under us.
 *
 * A project holds a contract and a suite compiled against a set of tools. If
 * those tools change — a rename, an argument added, a tool withdrawn, a
 * read-only claim reversed — the suite is still runnable and may quietly mean
 * something different. That is the worst failure this product can have: a
 * confident verdict about a system that is no longer the one it learned.
 *
 * So a reconnect compares what came back with what was there before, and says
 * what moved. It does not repair anything, and it does not block: deciding
 * whether a change matters needs somebody who knows what the tools are for.
 */
import type { DiscoveredTool } from '@rigorrun/mcp';

/** What the last successful connection found. Written to disk. */
export interface Discovery {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  discoveredAt: string;
  latencyMs: number;
  tools: DiscoveredTool[];
}

export type DriftKind =
  | 'tool_added'
  | 'tool_removed'
  | 'argument_added'
  | 'argument_removed'
  | 'argument_required'
  | 'argument_optional'
  | 'hint_changed'
  | 'server_changed';

export interface Drift {
  kind: DriftKind;
  tool: string;
  /** One sentence, written for somebody deciding whether it matters. */
  detail: string;
  /**
   * Whether this could change what a verdict means.
   *
   * A tool that vanished breaks cases outright. A tool that gained an optional
   * argument almost certainly does not. Sorting by this is the difference
   * between a warning somebody reads and a warning somebody dismisses.
   */
  serious: boolean;
}

export interface DriftReport {
  drifts: Drift[];
  /** True when nothing moved. The ordinary case, and worth saying plainly. */
  unchanged: boolean;
  /** The subset a person should look at before trusting the next run. */
  serious: Drift[];
}

export function detectDrift(before: Discovery, after: Discovery): DriftReport {
  const drifts: Drift[] = [];

  if (before.serverName !== after.serverName) {
    drifts.push({
      kind: 'server_changed',
      tool: '',
      detail: `This connector answered as "${before.serverName}" before and "${after.serverName}" now.`,
      serious: true,
    });
  }

  const was = new Map(before.tools.map((tool) => [tool.name, tool]));
  const now = new Map(after.tools.map((tool) => [tool.name, tool]));

  for (const [name, tool] of now) {
    if (!was.has(name)) {
      drifts.push({
        kind: 'tool_added',
        tool: name,
        detail: `${name} is new since this project was set up. Nothing uses it yet.`,
        // A tool nothing references cannot change an existing verdict.
        serious: false,
      });
      continue;
    }
    const previous = was.get(name)!;
    drifts.push(...compareParams(name, previous, tool));

    if (previous.hints.readOnly !== tool.hints.readOnly) {
      drifts.push({
        kind: 'hint_changed',
        tool: name,
        detail:
          `${name} used to claim readOnlyHint ${describe(previous.hints.readOnly)} and now claims ` +
          `${describe(tool.hints.readOnly)}. RigorRun never acted on that claim, but you may have.`,
        serious: true,
      });
    }
  }

  for (const [name] of was) {
    if (now.has(name)) continue;
    drifts.push({
      kind: 'tool_removed',
      tool: name,
      detail: `${name} is gone. Any case that calls it will fail for that reason rather than because of your agent.`,
      serious: true,
    });
  }

  const ordered = drifts.sort((a, b) => Number(b.serious) - Number(a.serious));
  return {
    drifts: ordered,
    unchanged: ordered.length === 0,
    serious: ordered.filter((drift) => drift.serious),
  };
}

function compareParams(name: string, before: DiscoveredTool, after: DiscoveredTool): Drift[] {
  const drifts: Drift[] = [];
  const was = new Map(before.params.map((param) => [param.name, param]));
  const now = new Map(after.params.map((param) => [param.name, param]));

  for (const [param, spec] of now) {
    const previous = was.get(param);
    if (!previous) {
      drifts.push({
        kind: 'argument_added',
        tool: name,
        detail: `${name} takes a new argument "${param}"${spec.required ? ', and it is required' : ''}.`,
        // A newly required argument breaks every existing call to that tool.
        serious: spec.required,
      });
      continue;
    }
    if (!previous.required && spec.required) {
      drifts.push({
        kind: 'argument_required',
        tool: name,
        detail: `"${param}" on ${name} is now required and used not to be.`,
        serious: true,
      });
    }
    if (previous.required && !spec.required) {
      drifts.push({
        kind: 'argument_optional',
        tool: name,
        detail: `"${param}" on ${name} is now optional.`,
        serious: false,
      });
    }
  }

  for (const [param] of was) {
    if (now.has(param)) continue;
    drifts.push({
      kind: 'argument_removed',
      tool: name,
      detail: `${name} no longer takes "${param}". Cases that pass it may be refused.`,
      serious: true,
    });
  }

  return drifts;
}

function describe(value: boolean | undefined): string {
  return value === undefined ? 'nothing' : String(value);
}
