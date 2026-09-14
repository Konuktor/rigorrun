#!/usr/bin/env node
/**
 * HELD-OUT fault injection — a stdio JSON-RPC pass-through with four modes, for
 * the ambiguous-retry variants. Derived from the audit's scripts/fault-proxy.mjs,
 * which stays unmodified.
 *
 *   FAULT_MODE=drop_response        forward the Nth call; swallow its response
 *   FAULT_MODE=error_after_forward  forward it; answer the client with a tool error instead
 *   FAULT_MODE=delay_response       forward it; hold the response FAULT_DELAY_MS
 *   FAULT_MODE=drop_request         never forward the Nth call, and never answer it
 *
 * FAULT_DROP_TOOL names the tool, FAULT_DROP_NTH which of its calls. Everything
 * else passes through unchanged. Every injection is logged to FAULT_LOG. Local
 * and disposable only: it sits between RigorRun and a server on this machine.
 */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const sep = process.argv.indexOf('--');
const command = process.argv.slice(sep + 1);
if (sep < 0 || command.length === 0) {
  process.stderr.write('usage: fault-proxy-modes.mjs -- <command> [args]\n');
  process.exit(2);
}
const mode = process.env.FAULT_MODE || 'drop_response';
const tool = process.env.FAULT_DROP_TOOL || '';
const nth = Number(process.env.FAULT_DROP_NTH || '1');
const delayMs = Number(process.env.FAULT_DELAY_MS || '0');
const logPath = process.env.FAULT_LOG || '';
const log = (entry) => {
  if (logPath) appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, mode, ...entry }) + '\n');
};

const child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));

let seen = 0;
const targeted = new Set();

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

lines(process.stdin, (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    child.stdin.write(line + '\n');
    return;
  }
  if (message.method === 'tools/call' && tool && message.params?.name === tool) {
    seen += 1;
    log({ direction: 'client→server', call: seen, tool, args: message.params?.arguments });
    if (seen === nth && message.id !== undefined) {
      if (mode === 'drop_request') {
        log({ injected: 'REQUEST_DROPPED', id: message.id, call: seen, tool, args: message.params?.arguments });
        return;
      }
      targeted.add(String(message.id));
      log({ injected: 'WILL_ALTER_RESPONSE', id: message.id, call: seen, tool, args: message.params?.arguments });
    }
  }
  child.stdin.write(line + '\n');
});
process.stdin.on('end', () => child.stdin.end());

lines(child.stdout, (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(line + '\n');
    return;
  }
  const key = message.id !== undefined ? String(message.id) : null;
  if (key !== null && targeted.has(key)) {
    targeted.delete(key);
    if (mode === 'drop_response') {
      log({ injected: 'RESPONSE_DROPPED', id: message.id });
      return;
    }
    if (mode === 'error_after_forward') {
      log({ injected: 'RESPONSE_REPLACED_WITH_ERROR', id: message.id });
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'upstream connection reset before the result was read' }], isError: true } }) + '\n',
      );
      return;
    }
    if (mode === 'delay_response') {
      log({ injected: 'RESPONSE_DELAYED', id: message.id, delayMs });
      setTimeout(() => process.stdout.write(line + '\n'), delayMs);
      return;
    }
  }
  process.stdout.write(line + '\n');
});
