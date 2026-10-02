/**
 * An agent RigorRun only sends work to: `rigorrun/task/1`.
 *
 * Every other way in hands the agent an MCP address and watches its calls. That
 * asks a founder to rewire the agent they ship — through RigorRun's proxy, onto
 * this machine — before they learn anything, and the agent they end up testing
 * is not quite the one in production. This one asks for nothing but an address
 * the agent already answers on: RigorRun posts the case's work, the agent does
 * it the way it always does, wherever it runs, and RigorRun reads the system
 * afterwards through its own connection.
 *
 * What that costs is said on every result rather than hidden: RigorRun did not
 * see the agent's calls, so checks about their order are not made. Everything
 * decided by what the system holds afterwards is made in full, and made on a
 * reading the agent never touched.
 *
 * Remote hosts are allowed here, unlike the other kinds, because an agent in
 * the cloud is the common case this exists for — but only over https, only to
 * hosts a person named, never following a redirect, and only once somebody on
 * this machine agreed that the case's work may leave it.
 */
import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentRunInput, AgentRunOutput } from '@rigorrun/agents';
import type { Principal } from '@rigorrun/core';

export const TASK_PROTOCOL = 'rigorrun/task/1';

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_CLAIM_CHARS = 8000;
const POLL_INTERVAL_MS = 1000;

export type BlackBoxCompletion = 'response' | 'poll' | 'settle';

export interface BlackBoxAgentConfig {
  id: string;
  name: string;
  endpoint: string;
  /** Hosts outside loopback this agent may be reached on. https only. */
  allowedHosts: readonly string[];
  /** Resolved at call time, so credentials never sit in the adapter. */
  headers?: () => Promise<Record<string, string>>;
  /** A JSON body with `{{placeholders}}`, or null for the task envelope. */
  bodyTemplate: string | null;
  completion: BlackBoxCompletion;
  /** Where the agent's final message is in its answer, as a dotted path. */
  claimPath: string;
  /** How long to wait after the answer, for work done after answering. */
  settleQuietMs: number;
  /** How long one case may take in total. */
  timeoutMs: number;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The address, if it is one RigorRun may send a case's work to.
 *
 * Loopback over http or https; anything else over https and only when named.
 * A name is compared exactly — `api.example.com` does not admit
 * `evil.api.example.com` — because a suffix match is how an allowlist becomes a
 * suggestion.
 */
export function assertBlackBoxUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`The agent's address is not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`The agent's address must be http or https, not ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error(
      "The agent's address must not carry credentials. Put them in a header, from a secret.",
    );
  }
  const host = url.hostname.toLowerCase();
  if (LOOPBACK.has(host)) return url;
  if (url.protocol !== 'https:') {
    throw new Error(`${host} is not on this machine, so RigorRun will only reach it over https.`);
  }
  if (!allowedHosts.map((entry) => entry.toLowerCase()).includes(host)) {
    throw new Error(
      `${host} is not on this agent's list of hosts. Add it deliberately: each case's work is sent there.`,
    );
  }
  return url;
}

/**
 * Words in a query parameter's name that say its value is a credential.
 * Matched as whole words of the name, so `api_key`, `apiKey`, `x-api-key` and
 * `client_secret` are all caught and `author` is not.
 */
const CREDENTIAL_WORDS = new Set([
  'key',
  'token',
  'secret',
  'password',
  'auth',
  'signature',
  'sig',
]);
/** Names that run the words together. */
const CREDENTIAL_NAMES = new Set(['apikey', 'accesstoken']);
/** Values shaped like an API key or a webhook signing secret, whatever the parameter is called. */
const CREDENTIAL_VALUE = /^(?:sk|rk|pk)_|^whsec_/;

function isCredentialName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((word) => CREDENTIAL_WORDS.has(word)) || CREDENTIAL_NAMES.has(words.join(''));
}

/**
 * The first query parameter of an address that carries a credential, by its
 * name or by the shape of its value; undefined when none does, or when the
 * text is not an address at all (which is refused elsewhere, in its own words).
 */
export function credentialInQuery(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  for (const [name, value] of url.searchParams) {
    if (isCredentialName(name) || CREDENTIAL_VALUE.test(value)) return name;
  }
  return undefined;
}

/**
 * Refuses an agent's address with a credential in its query. The address is
 * stored in the project — a file meant to be copied — and printed wherever the
 * agent is listed, so a credential there would end up in both. Only the name
 * is repeated, never the value.
 */
export function refuseCredentialInQuery(raw: string): void {
  const name = credentialInQuery(raw);
  if (name === undefined) return;
  throw new Error(
    `The agent's address carries a credential in its query (${name}). An address is stored in ` +
      'the project and printed wherever the agent is listed; send the credential in a header from ' +
      'a secret instead (--header Name=secret_name).',
  );
}

/**
 * An agent's own address: one RigorRun may send work to, with no credential in
 * its query. A status address an answer names is held only to the first: it is
 * never stored or printed, and a signed one is ordinary.
 */
export function assertBlackBoxEndpoint(raw: string, allowedHosts: readonly string[]): URL {
  const url = assertBlackBoxUrl(raw, allowedHosts);
  refuseCredentialInQuery(raw);
  return url;
}

/**
 * An address as a person is shown it: without its query or fragment, whole.
 * A parameter's name is not a reliable sign of whether its value is private,
 * so none of them is shown.
 */
export function redactEndpoint(endpoint: string): string {
  const cut = endpoint.search(/[?#]/);
  return cut === -1 ? endpoint : `${endpoint.slice(0, cut)}${endpoint[cut]}…`;
}

/** What one case asks of the agent, as the envelope and as plain text. */
export interface TaskEnvelope {
  protocol: typeof TASK_PROTOCOL;
  caseId: string;
  task: {
    /** The work order, in words a person or an agent could act on. */
    text: string;
    instruction: string;
    inputs: Record<string, unknown>;
    policyBrief: string;
    /** Whom the agent acts for, when the case says. */
    principal?: Principal;
  };
}

export function taskEnvelope(input: AgentRunInput): TaskEnvelope {
  const { instruction, inputs, policyBrief, principal } = input.task;
  const details = [
    ...Object.entries(inputs).map(
      ([name, value]) => `${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
    ),
    ...(principal
      ? [
          `acting_for: ${principal.tenant}${principal.user ? ` / ${principal.user}` : ''}${
            principal.role ? ` (role: ${principal.role})` : ''
          }`,
        ]
      : []),
  ].join('\n');
  return {
    protocol: TASK_PROTOCOL,
    caseId: input.caseId,
    task: {
      text: details ? `${instruction}\n\n${details}` : instruction,
      instruction,
      inputs,
      policyBrief,
      ...(principal ? { principal } : {}),
    },
  };
}

/**
 * Fills a body template. Values go in JSON-string-escaped, so a ticket that
 * contains a quote cannot end the string it was put into and rewrite the
 * request around it. A template that does not come out as JSON is refused.
 */
export function renderBody(template: string | null, envelope: TaskEnvelope): string {
  if (template === null) return JSON.stringify(envelope);
  const lookup = (path: string): unknown => {
    if (path === 'caseId') return envelope.caseId;
    if (path.startsWith('task.')) return (envelope.task as Record<string, unknown>)[path.slice(5)];
    if (path.startsWith('inputs.')) return envelope.task.inputs[path.slice(7)];
    if (path.startsWith('principal.')) {
      return (envelope.task.principal as Record<string, unknown> | undefined)?.[path.slice(10)];
    }
    return undefined;
  };
  const body = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_whole, path: string) => {
    const value = lookup(path);
    if (value === undefined)
      throw new Error(`The body template names {{${path}}}, which this case does not have.`);
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return JSON.stringify(text).slice(1, -1);
  });
  try {
    JSON.parse(body);
  } catch {
    throw new Error('The body template does not produce JSON once filled in.');
  }
  return body;
}

/** The value at a dotted path, as text. */
export function claimAt(answer: unknown, path: string): string {
  let value: unknown = answer;
  for (const part of path.split('.').filter(Boolean)) {
    if (value === null || typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[part];
  }
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.slice(0, MAX_CLAIM_CHARS);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES)
    throw new Error('The agent sent more than RigorRun will read.');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    // An endpoint that answers in prose still answered; its words are the claim.
    return { output: text.slice(0, MAX_CLAIM_CHARS) };
  }
}

const TERMINAL = new Set(['completed', 'failed', 'declined']);

/**
 * Checks the address answers at all, without sending any work.
 *
 * A native endpoint — one that takes its own request shape through a body
 * template — cannot be asked whether it speaks a protocol it has never heard
 * of, so reachability is the most that can honestly be claimed before a case.
 */
export async function probeBlackBox(
  config: Pick<BlackBoxAgentConfig, 'endpoint' | 'allowedHosts' | 'headers' | 'bodyTemplate'>,
): Promise<{ ok: true; detail: string } | { ok: false; problem: string }> {
  let url: URL;
  try {
    url = assertBlackBoxEndpoint(config.endpoint, config.allowedHosts);
  } catch (error) {
    return { ok: false, problem: (error as Error).message };
  }
  try {
    const headers = { 'content-type': 'application/json', ...((await config.headers?.()) ?? {}) };
    if (config.bodyTemplate === null) {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers,
        body: JSON.stringify({ protocol: TASK_PROTOCOL, probe: true }),
        signal: AbortSignal.timeout(10_000),
      });
      const answer = (await readJson(response)) as { ok?: unknown };
      if (!response.ok || answer.ok !== true) {
        return {
          ok: false,
          problem: `The endpoint answered ${response.status}, not {"ok":true}. It should answer a probe without doing any work.`,
        };
      }
      return { ok: true, detail: 'answers rigorrun/task/1' };
    }
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    return {
      ok: true,
      detail: `reachable (answered ${response.status}); a case will show whether it does the work`,
    };
  } catch (error) {
    return { ok: false, problem: `Could not reach the endpoint: ${(error as Error).message}` };
  }
}

export function createBlackBoxAgent(config: BlackBoxAgentConfig): AgentAdapter {
  const url = assertBlackBoxEndpoint(config.endpoint, config.allowedHosts);

  return {
    id: config.id,
    name: config.name,
    kind: 'blackbox',
    description: `Your agent at ${url.origin}, working on the system itself; RigorRun reads the result.`,

    // The environment is deliberately unused: this agent never calls tools
    // through RigorRun. What it changed is read afterwards, independently.
    async execute(input: AgentRunInput): Promise<AgentRunOutput> {
      const deadline = Date.now() + config.timeoutMs;
      const envelope = taskEnvelope(input);
      const headers = {
        'content-type': 'application/json',
        'idempotency-key': `${input.caseId}.${randomUUID()}`,
        'x-rigorrun-case': input.caseId,
        ...((await config.headers?.()) ?? {}),
      };

      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers,
        body: renderBody(config.bodyTemplate, envelope),
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (!response.ok && response.status !== 202) {
        throw new Error(`the agent's endpoint answered ${response.status}`);
      }
      if (response.status === 202 && config.completion === 'response') {
        // 202 says the work was accepted, not done. Reading the system now
        // would judge it before it lands and fail a correct asynchronous
        // agent, so the case ends as the agent not finishing — never a
        // verdict — and says how to wait for it.
        await response.body?.cancel();
        throw new Error(
          "the agent's endpoint answered 202 Accepted — the work is not done yet; add the agent " +
            'with --completion poll (statusUrl) or --completion settle',
        );
      }
      let answer = await readJson(response);

      if (config.completion === 'poll') {
        const statusUrl = (answer as { statusUrl?: unknown }).statusUrl;
        if (typeof statusUrl !== 'string') {
          throw new Error('the endpoint was set to be polled, but its answer carried no statusUrl');
        }
        // The status address is held to the same list: an answer must not be
        // able to send RigorRun, with the agent's headers, somewhere new.
        const poll = assertBlackBoxUrl(new URL(statusUrl, url).toString(), config.allowedHosts);
        for (;;) {
          const status = (answer as { status?: unknown }).status;
          if (typeof status === 'string' && TERMINAL.has(status)) break;
          if (Date.now() + POLL_INTERVAL_MS > deadline)
            throw new Error('the agent did not finish before the case budget');
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          const next = await fetch(poll, {
            redirect: 'error',
            headers,
            signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          });
          if (!next.ok) throw new Error(`the status address answered ${next.status}`);
          answer = await readJson(next);
        }
      }

      if (config.completion === 'settle') {
        // Fire-and-forget endpoints answer before the work is done. Waiting a
        // stated interval is the honest thing available; the result says so.
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(config.settleQuietMs, Math.max(0, deadline - Date.now()))),
        );
      }

      const status = (answer as { status?: unknown }).status;
      const claim = claimAt(answer, config.claimPath);
      return {
        report:
          claim ||
          (typeof status === 'string'
            ? `The agent reported ${status}.`
            : 'The agent answered without saying what it did.'),
        usage: null,
        costUsd: null,
        costNote: 'not reported by a black-box agent',
      };
    },
  };
}
