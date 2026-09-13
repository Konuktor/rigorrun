#!/usr/bin/env node
/**
 * INJECTED FAULT — a thin stdio JSON-RPC pass-through for MCP servers.
 *
 * Sits between an MCP client (RigorRun) and the real server process. Every
 * message is forwarded unchanged in both directions and logged, except that
 * the RESPONSE to the Nth `tools/call` of a named tool is swallowed once. The
 * server still executed the call; the client only sees a timeout. That is the
 * "action committed, response lost, client retries" scenario.
 *
 * Nothing about the upstream server is modified. Any duplicate side effect this
 * produces is an injected fault and must be reported as such, never as an
 * upstream bug.
 *
 * Usage:
 *   FAULT_DROP_TOOL=send_email FAULT_DROP_NTH=1 FAULT_LOG=/path/log.jsonl \
 *     node fault-proxy.mjs -- <server command> [args...]
 *
 * With FAULT_DROP_TOOL unset the proxy is transparent (useful as a control and
 * as a full-fidelity trace of every JSON-RPC message).
 */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const sep = process.argv.indexOf('--');
const command = process.argv.slice(sep + 1);
if (sep < 0 || command.length === 0) {
  process.stderr.write('usage: fault-proxy.mjs -- <command> [args]\n');
  process.exit(2);
}
const dropTool = process.env.FAULT_DROP_TOOL || '';
const dropNth = Number(process.env.FAULT_DROP_NTH || '1');
const logPath = process.env.FAULT_LOG || '';
const log = (entry) => {
  if (!logPath) return;
  appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
};

const child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));

let seen = 0;
const dropped = new Set(); // request ids whose response must be swallowed

function lines(stream, onLine) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  });
}

// client → server
lines(process.stdin, (line) => {
  let message;
  try { message = JSON.parse(line); } catch { child.stdin.write(line + '\n'); return; }
  if (message.method === 'tools/call' && dropTool && message.params?.name === dropTool) {
    seen += 1;
    if (seen === dropNth && message.id !== undefined) {
      dropped.add(String(message.id));
      log({ direction: 'client→server', injected: 'WILL_DROP_RESPONSE', id: message.id, tool: dropTool, args: message.params?.arguments });
    }
  }
  log({ direction: 'client→server', message });
  child.stdin.write(line + '\n');
});
process.stdin.on('end', () => child.stdin.end());

// server → client
lines(child.stdout, (line) => {
  let message;
  try { message = JSON.parse(line); } catch { process.stdout.write(line + '\n'); return; }
  if (message.id !== undefined && dropped.has(String(message.id))) {
    dropped.delete(String(message.id));
    log({ direction: 'server→client', injected: 'RESPONSE_DROPPED', id: message.id, result: message.result ?? message.error });
    return; // swallowed: the client will time out
  }
  log({ direction: 'server→client', message });
  process.stdout.write(line + '\n');
});
