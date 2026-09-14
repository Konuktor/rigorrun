/**
 * MCP compatibility preflight, through RigorRun's own client and result normaliser.
 *
 *   node_modules/.bin/tsx reports/public-mcp-audit-2026-09/final-qualification/scripts/mcp/mcp-preflight.ts
 *
 * Nothing in the product is changed or wrapped: `McpConnection` (packages/mcp) opens
 * each server exactly as a project connector would, and `normalizeCallResult`
 * (packages/connector) interprets each result exactly as verification does. A raw
 * newline-delimited JSON-RPC client, written here and independent of the SDK, is
 * the reference for what the server actually offers.
 *
 * Each check records what was observed and a status:
 *   PASS      RigorRun behaved as the protocol and its own documentation require
 *   LIMIT     a documented or newly observed limitation (recorded, with its impact)
 *   FAIL      RigorRun misbehaved in a way that would corrupt a verdict
 *
 * Writes evidence/mcp-preflight/<check>.json and evidence/mcp-preflight/summary.json.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpConnection } from '../../../../../packages/mcp/src/client.ts';
import { normalizeCallResult } from '../../../../../packages/connector/src/result.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FQ = resolve(HERE, '..', '..');
const REPO = resolve(FQ, '..', '..', '..');
const OUT = join(FQ, 'evidence', 'mcp-preflight');
mkdirSync(OUT, { recursive: true });
const PYTHON = process.env['PYTHON'] ?? 'python3';

type Status = 'PASS' | 'LIMIT' | 'FAIL';
interface Check { id: string; target: string; check: string; status: Status; observed: unknown; expected: string; impact?: string }
const checks: Check[] = [];
const record = (c: Check) => {
  checks.push(c);
  writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify(c, null, 2) + '\n');
  console.log(`${c.status.padEnd(5)} ${c.id} ${c.check}`);
};

/** A raw client: newline-delimited JSON-RPC over the child's stdio, no SDK. */
async function raw(command: string, args: string[], env: Record<string, string> = {}) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let buffer = '';
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as { id?: number };
        if (typeof message.id === 'number') waiting.get(message.id)?.(message as Record<string, unknown>);
      } catch {
        // not JSON: a server log line on stdout
      }
    }
  });
  child.stderr.on('data', () => undefined);
  let next = 0;
  const request = (method: string, params: unknown, timeoutMs = 15_000) =>
    new Promise<Record<string, unknown>>((resolveMessage, reject) => {
      const id = ++next;
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      waiting.set(id, (m) => { clearTimeout(timer); resolveMessage(m); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const notify = (method: string, params: unknown) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const close = () => { child.stdin.end(); child.kill('SIGTERM'); };
  return { request, notify, close, child };
}

async function rawToolCount(command: string, args: string[], env: Record<string, string> = {}) {
  const c = await raw(command, args, env);
  try {
    const init = await c.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fq-raw-preflight', version: '1.0.0' } });
    c.notify('notifications/initialized', {});
    const names: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await c.request('tools/list', cursor ? { cursor } : {});
      const result = page['result'] as { tools: { name: string }[]; nextCursor?: string };
      names.push(...result.tools.map((t) => t.name));
      cursor = result.nextCursor;
      pages += 1;
    } while (cursor && pages < 50);
    return { negotiated: (init['result'] as { protocolVersion?: string } | undefined)?.protocolVersion ?? null, initError: init['error'] ?? null, names, pages };
  } finally {
    c.close();
  }
}

const alive = (pid: number | null) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function closedWithin(conn: McpConnection, ms: number) {
  const pid = conn.childPid;
  const started = Date.now();
  // A close() that never settles must not end this script: race it against a timer, which also keeps the event loop alive.
  const settled = await Promise.race([conn.close().then(() => true), sleep(ms).then(() => false)]);
  while (alive(pid) && Date.now() - started < ms) await sleep(100);
  const stillAlive = alive(pid);
  if (stillAlive && pid) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  return { pid, closeSettled: settled, aliveAfterClose: stillAlive, waitedMs: Date.now() - started, killedByPreflight: stillAlive };
}

async function main() {
  // ---- SDK facts
  const sdkRoot = join(REPO, 'node_modules', '.pnpm');
  const sdkDir = readFileSync(join(REPO, 'pnpm-lock.yaml'), 'utf8').match(/@modelcontextprotocol\/sdk@(\d+\.\d+\.\d+)/)?.[1] ?? null;
  const sdkTypes = (() => {
    try {
      const dirs = readdirSync(sdkRoot).filter((d: string) => d.startsWith('@modelcontextprotocol+sdk@'));
      return readFileSync(join(sdkRoot, dirs[0], 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'types.js'), 'utf8');
    } catch {
      return '';
    }
  })();
  const latest = /LATEST_PROTOCOL_VERSION = ['"]([^'"]+)['"]/.exec(sdkTypes)?.[1] ?? null;
  const supported = /SUPPORTED_PROTOCOL_VERSIONS = \[([^\]]+)\]/.exec(sdkTypes)?.[1]?.replace(/\s+/g, ' ') ?? null;
  record({
    id: 'sdk-versions', target: 'RigorRun client', check: 'protocol versions the installed MCP SDK can negotiate',
    status: sdkTypes.includes('2026-07-28') ? 'PASS' : 'LIMIT',
    observed: { lockfileSdkVersion: sdkDir, LATEST_PROTOCOL_VERSION: latest, SUPPORTED_PROTOCOL_VERSIONS: supported, knows20260728: sdkTypes.includes('2026-07-28') },
    expected: 'recorded; 2026-07-28 support would need the string in the SDK',
    impact: sdkTypes.includes('2026-07-28') ? undefined : 'RigorRun speaks only the legacy initialize handshake (2024-11-05 … 2025-11-25); a server that supports only 2026-07-28 cannot be connected.',
  });

  // ---- Filesystem MCP
  const fsRoot = mkdtempSync(join(tmpdir(), 'fq-fs-'));
  writeFileSync(join(fsRoot, 'note.txt'), 'preflight\n');
  const fsCommand = join(REPO, 'node_modules', '.bin', 'mcp-server-filesystem');
  const fsRaw = await rawToolCount(fsCommand, [fsRoot]);
  const fsConn = await McpConnection.open({ transport: 'stdio', command: fsCommand, args: [fsRoot] }, { timeoutMs: 30_000 });
  record({
    id: 'filesystem-connect', target: '@modelcontextprotocol/server-filesystem 2026.8.31', check: 'connection, identity and negotiated version',
    status: 'PASS',
    observed: { serverName: fsConn.discovery.serverName, serverVersion: fsConn.discovery.serverVersion, recordedProtocolVersion: fsConn.discovery.protocolVersion, rawNegotiated: fsRaw.negotiated, latencyMs: fsConn.discovery.latencyMs },
    expected: 'connects over stdio with the legacy handshake',
  });
  record({
    id: 'recorded-protocol-version', target: 'RigorRun client', check: 'the negotiated protocol version is recorded for a stdio server',
    status: fsConn.discovery.protocolVersion === fsRaw.negotiated ? 'PASS' : 'LIMIT',
    observed: { recorded: fsConn.discovery.protocolVersion, actuallyNegotiated: fsRaw.negotiated },
    expected: 'the version the server negotiated',
    impact: 'Discovery records the literal "negotiated" for stdio servers; an audit must record the version from its own raw handshake.',
  });
  record({
    id: 'filesystem-tools-list', target: '@modelcontextprotocol/server-filesystem 2026.8.31', check: 'tools/list: RigorRun sees every tool the server offers',
    status: fsConn.discovery.tools.length === fsRaw.names.length ? 'PASS' : 'FAIL',
    observed: { rigorrun: fsConn.discovery.tools.length, raw: fsRaw.names.length, rawPages: fsRaw.pages, missing: fsRaw.names.filter((n) => !fsConn.discovery.tools.some((t) => t.name === n)) },
    expected: 'equal counts',
  });
  const listed = await fsConn.call('list_directory', { path: fsRoot });
  // The expectation follows the result's own shape: structuredContent is records; text without it is prose or JSON text.
  const listedKind = normalizeCallResult(listed).kind;
  const listedHasStructured = listed.structured !== undefined && listed.structured !== null;
  record({
    id: 'filesystem-call', target: '@modelcontextprotocol/server-filesystem 2026.8.31', check: 'tools/call, and normalisation that follows the result shape',
    status: listed.ok && (listedHasStructured ? listedKind === 'structured' : listedKind === 'text' || listedKind === 'json_text') ? 'PASS' : 'FAIL',
    observed: { ok: listed.ok, kind: listedKind, hasStructured: listedHasStructured, structuredKeys: listedHasStructured && typeof listed.structured === 'object' ? Object.keys(listed.structured as object) : null },
    expected: 'ok; structured when the server sends structuredContent, otherwise text or json_text',
  });
  const outside = await fsConn.call('read_text_file', { path: '/etc/hostname' });
  record({
    id: 'filesystem-error', target: '@modelcontextprotocol/server-filesystem 2026.8.31', check: 'a refused call is an error, never data',
    status: !outside.ok && normalizeCallResult(outside).kind === 'error' ? 'PASS' : 'FAIL',
    observed: { ok: outside.ok, kind: normalizeCallResult(outside).kind, error: outside.error ?? null },
    expected: 'ok false, kind error',
  });
  const fsClose = await closedWithin(fsConn, 5000);
  record({
    id: 'filesystem-teardown', target: '@modelcontextprotocol/server-filesystem 2026.8.31', check: 'close() ends the stdio child',
    status: fsClose.aliveAfterClose ? 'FAIL' : 'PASS', observed: fsClose, expected: 'child gone within 5 s',
  });
  rmSync(fsRoot, { recursive: true, force: true });

  // ---- Memory MCP
  const memDir = mkdtempSync(join(tmpdir(), 'fq-mem-'));
  const memConn = await McpConnection.open({ transport: 'stdio', command: join(REPO, 'node_modules', '.bin', 'mcp-server-memory'), args: [], env: { MEMORY_FILE_PATH: join(memDir, 'memory.jsonl') } }, { timeoutMs: 30_000 });
  const created = await memConn.call('create_entities', { entities: [{ name: 'preflight', entityType: 'probe', observations: ['recorded'] }] });
  const graph = await memConn.call('read_graph', {});
  const graphKind = normalizeCallResult(graph).kind;
  record({
    id: 'memory-structured', target: '@modelcontextprotocol/server-memory 2026.8.31', check: 'a structured result is read as records',
    status: created.ok && graph.ok && (graphKind === 'structured' || graphKind === 'json_text') ? 'PASS' : 'FAIL',
    observed: { createOk: created.ok, createKind: normalizeCallResult(created).kind, readKind: graphKind, recordedProtocolVersion: memConn.discovery.protocolVersion, tools: memConn.discovery.tools.length },
    expected: 'structured or json_text',
  });
  const memClose = await closedWithin(memConn, 5000);
  record({ id: 'memory-teardown', target: '@modelcontextprotocol/server-memory 2026.8.31', check: 'close() ends the stdio child', status: memClose.aliveAfterClose ? 'FAIL' : 'PASS', observed: memClose, expected: 'child gone within 5 s' });
  rmSync(memDir, { recursive: true, force: true });

  // ---- Local shapes server
  const shapes = { transport: 'stdio' as const, command: PYTHON, args: [join(HERE, 'preflight_server.py')] };
  const shapesRaw = await rawToolCount(PYTHON, shapes.args);
  const conn = await McpConnection.open(shapes, { timeoutMs: 15_000 });
  record({
    id: 'tools-list-pagination', target: 'RigorRun client', check: 'tools/list follows nextCursor',
    status: conn.discovery.tools.length === shapesRaw.names.length ? 'PASS' : 'LIMIT',
    observed: { rigorrunTools: conn.discovery.tools.map((t) => t.name), rawTools: shapesRaw.names, rawPages: shapesRaw.pages },
    expected: 'every page listed',
    impact: 'Only the first page is discovered. A tool listed after a nextCursor is invisible to setup and to the agent proxy; an audit must compare its tool count with a raw paged tools/list before relying on the catalogue.',
  });
  const kinds: Record<string, unknown> = {};
  for (const name of ['structured_only', 'json_text', 'prose', 'tool_error', 'rpc_error', 'resource_link', 'image_only']) {
    const result = await conn.call(name, {});
    const normalized = normalizeCallResult(result);
    kinds[name] = { ok: result.ok, kind: normalized.kind, error: result.error ?? normalized.error ?? null };
  }
  const k = kinds as Record<string, { ok: boolean; kind: string }>;
  record({
    id: 'normalisation-structured', target: 'RigorRun normaliser', check: 'structuredContent is records', status: k['structured_only']!.kind === 'structured' ? 'PASS' : 'FAIL',
    observed: kinds['structured_only'], expected: 'structured',
  });
  record({
    id: 'normalisation-json-in-text', target: 'RigorRun normaliser', check: 'JSON inside a text block is records (R-8)', status: k['json_text']!.kind === 'json_text' ? 'PASS' : 'FAIL',
    observed: kinds['json_text'], expected: 'json_text',
  });
  record({
    id: 'normalisation-prose', target: 'RigorRun normaliser', check: 'prose is never records', status: k['prose']!.kind === 'text' ? 'PASS' : 'FAIL',
    observed: kinds['prose'], expected: 'text',
  });
  record({
    id: 'errors', target: 'RigorRun client', check: 'isError results and JSON-RPC errors are errors, not data',
    status: !k['tool_error']!.ok && k['tool_error']!.kind === 'error' && !k['rpc_error']!.ok && k['rpc_error']!.kind === 'error' ? 'PASS' : 'FAIL',
    observed: { toolError: kinds['tool_error'], rpcError: kinds['rpc_error'] }, expected: 'both ok false, kind error',
  });
  record({
    id: 'normalisation-links-and-images', target: 'RigorRun normaliser', check: 'resource_link and image-only results',
    status: k['resource_link']!.kind === 'empty' && k['image_only']!.kind === 'empty' ? 'LIMIT' : 'PASS',
    observed: { resourceLink: kinds['resource_link'], imageOnly: kinds['image_only'] },
    expected: 'recorded',
    impact: 'A result made only of a resource_link or an image normalises to empty: it is neither followed nor read. A read that returns state only as a link cannot serve as a verifier read.',
  });
  const slowStarted = Date.now();
  const slow = await conn.call('slow', {}, 20_000);
  record({
    id: 'timeout', target: 'RigorRun client', check: 'a call past its timeout is an error, not an empty result',
    status: !slow.ok && normalizeCallResult(slow).kind === 'error' ? 'PASS' : 'FAIL',
    observed: { ok: slow.ok, kind: normalizeCallResult(slow).kind, error: slow.error ?? null, ms: Date.now() - slowStarted }, expected: 'call_failed after about 20 s',
  });
  await conn.close();

  // stderr flood on a fresh connection, so the slow tool's pending answer cannot interfere
  const flood = await McpConnection.open(shapes, { timeoutMs: 15_000 });
  const floodStarted = Date.now();
  const flooded = await flood.call('stderr_flood', {}, 15_000);
  const second = await flood.call('json_text', {}, 15_000);
  record({
    id: 'stderr-flood', target: 'RigorRun client', check: 'a server writing 200 KB to stderr is still answered',
    status: flooded.ok && second.ok ? 'PASS' : 'LIMIT',
    observed: { firstOk: flooded.ok, firstError: flooded.error ?? null, secondOk: second.ok, secondError: second.error ?? null, ms: Date.now() - floodStarted },
    expected: 'both calls answered',
    impact: 'stderr is piped and never read; a server that logs heavily to stderr can block and time out.',
  });
  const floodClose = await closedWithin(flood, 8000);
  record({ id: 'teardown-local', target: 'RigorRun client', check: 'close() settles and ends the stdio child after a blocked call', status: floodClose.aliveAfterClose ? 'FAIL' : floodClose.closeSettled ? 'PASS' : 'LIMIT', observed: floodClose, expected: 'close settles and the child is gone within 8 s', impact: 'When a server is blocked writing to stderr, close() may not settle; the child is still ended by the transport or by this preflight.' });

  // ---- 2026-07-28 modern-only server
  const modernRaw = await raw(PYTHON, [join(HERE, 'modern_only_server.py')]);
  const discover = await modernRaw.request('server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } });
  modernRaw.close();
  let modernError: string | null = null;
  try {
    const modern = await McpConnection.open({ transport: 'stdio', command: PYTHON, args: [join(HERE, 'modern_only_server.py')] }, { timeoutMs: 15_000 });
    await modern.close();
  } catch (error) {
    modernError = (error as Error).message;
  }
  record({
    id: 'modern-only-server', target: 'RigorRun client', check: 'a server that speaks only 2026-07-28 is refused at connect, visibly',
    status: modernError !== null ? 'PASS' : 'FAIL',
    observed: { serverDiscover: discover['result'] ?? discover['error'] ?? null, rigorrunConnectError: modernError },
    expected: 'connect throws an error naming the refusal; nothing reaches a case or a verdict',
    impact: 'Compatibility with 2026-07-28-only servers is UNSUPPORTED; the failure is a connect error, not a test result.',
  });

  const statuses = Object.fromEntries(['PASS', 'LIMIT', 'FAIL'].map((s) => [s, checks.filter((c) => c.status === s).length]));
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({
    generatedBy: 'final-qualification/scripts/mcp/mcp-preflight.ts',
    statuses,
    checks: checks.map((c) => ({ id: c.id, target: c.target, check: c.check, status: c.status })),
  }, null, 2) + '\n');
  console.log(JSON.stringify(statuses));
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
