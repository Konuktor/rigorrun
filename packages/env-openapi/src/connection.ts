/**
 * A live connection to an HTTP API described by an OpenAPI document.
 *
 * It satisfies `SystemConnection`, which is the entire integration: the
 * environment adapter, the compiler, the generator, the runner and the verifier
 * were all written against what operations exist and how to call one, so none
 * of them learn that a second connector arrived.
 *
 * The one thing this has that the MCP connector does not is a mode.
 *
 * While a person is setting a project up, RigorRun calls their system: it tries
 * the nominated reads to find out whether they answer in records, and it samples
 * them to work out what the records are. Against MCP that is safe because the
 * operator has ticked the tools RigorRun may call. Against an OpenAPI document
 * every operation arrives at once, described by a file, and `POST /orders` is
 * indistinguishable from `GET /orders` to anything that is not reading the
 * method. Calling one during setup would mean RigorRun placed an order in
 * somebody's system in order to find out what an order looks like.
 *
 * So a connection in `setup` mode refuses anything that is not classified READ,
 * and the refusal is here rather than in the callers — a rule enforced at the
 * one place every call passes through is a rule that holds when somebody adds
 * a caller.
 */
import {
  assertSafeSystemUrl,
  type CallResult,
  type DiscoveryResult,
  type SystemConnection,
} from '@rigorrun/connector';
import { loadDocument, type OpenApiDocument } from './document.ts';
import { operationsFrom, type OpenApiOperation } from './operations.ts';

export interface OpenApiConfig {
  /** The document itself, already fetched or read from disk by the caller. */
  spec: string;
  /** Where the API actually is. Overrides whatever `servers` claims. */
  baseUrl: string;
  /** Sent on every request. Held in the runner's secret store, never synced. */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type ConnectionMode = 'setup' | 'run';

const DEFAULT_TIMEOUT_MS = 20_000;
/** A response beyond this is not read. A test harness is not a download tool. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export class WriteRefusedDuringSetup extends Error {
  constructor(name: string, method: string) {
    super(
      `RigorRun will not call ${name} while you are setting this project up: ${method} changes ` +
        'your system, and nothing here is worth a write you did not ask for. It will be called ' +
        'during a run, by your agent.',
    );
    this.name = 'WriteRefusedDuringSetup';
  }
}

export class OpenApiConnection implements SystemConnection {
  readonly discovery: DiscoveryResult;
  /** Nothing is spawned. Present because the interface asks. */
  readonly childPid = null;

  private mode: ConnectionMode = 'setup';

  private constructor(
    readonly document: OpenApiDocument,
    readonly operations: OpenApiOperation[],
    private readonly config: OpenApiConfig,
    private readonly base: URL,
    latencyMs: number,
  ) {
    this.discovery = {
      serverName: document.info?.title ?? 'an HTTP API',
      serverVersion: document.info?.version ?? 'unknown',
      // Not a negotiation. Reported so a person can see which reader was used.
      protocolVersion: document.openapi ?? document.swagger ?? 'openapi',
      tools: operations.filter((op) => op.classification !== 'IGNORE').map((op) => op.tool),
      latencyMs,
    };
  }

  static async open(config: OpenApiConfig): Promise<OpenApiConnection> {
    const startedAt = Date.now();
    const document = await loadDocument(config.spec);
    const operations = operationsFrom(document);
    if (operations.length === 0) {
      throw new Error(
        'That document describes no operations RigorRun can call. Check it is an OpenAPI 3 ' +
          'document with a `paths` section.',
      );
    }
    const base = assertSafeSystemUrl(config.baseUrl || document.servers?.[0]?.url || '');
    return new OpenApiConnection(document, operations, config, base, Date.now() - startedAt);
  }

  /** Ends setup. Called once, when a run begins and writes become the point. */
  allowWrites(): void {
    this.mode = 'run';
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallResult> {
    const startedAt = Date.now();
    const operation = this.operations.find((entry) => entry.name === name);
    if (!operation) {
      return {
        ok: false,
        error: { code: 'NO_SUCH_OPERATION', message: `This API publishes no "${name}".` },
        durationMs: 0,
      };
    }
    if (this.mode === 'setup' && operation.classification !== 'READ') {
      throw new WriteRefusedDuringSetup(name, operation.method);
    }

    const { url, body } = this.buildRequest(operation, args);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: operation.method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...this.config.headers,
          ...this.headersFrom(operation, args),
        },
        ...(body === undefined ? {} : { body }),
        // A redirect is a request to somewhere the operator did not configure.
        redirect: 'error',
        signal: controller.signal,
      });

      const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
      const durationMs = Date.now() - startedAt;
      let structured: unknown;
      try {
        structured = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        // Not JSON. Carried as content, never as state — RigorRun compares
        // records and never prose.
        structured = undefined;
      }

      if (!response.ok) {
        return {
          ok: false,
          content: text,
          ...(structured !== undefined ? { structured } : {}),
          error: {
            code: `HTTP_${response.status}`,
            message: `${response.status} ${response.statusText}`,
          },
          durationMs,
        };
      }
      return {
        ok: true,
        content: text,
        ...(structured !== undefined ? { structured } : {}),
        durationMs,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: controller.signal.aborted ? 'TIMEOUT' : 'REQUEST_FAILED',
          message: (error as Error).message,
        },
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Nothing to close. Present because the interface asks. */
  async close(): Promise<void> {
    return undefined;
  }

  private buildRequest(
    operation: OpenApiOperation,
    args: Record<string, unknown>,
  ): { url: URL; body: string | undefined } {
    let path = operation.path;
    const query: [string, string][] = [];
    const body: Record<string, unknown> = {};

    for (const [name, value] of Object.entries(args)) {
      if (value === undefined) continue;
      switch (operation.placement[name]) {
        case 'path':
          // Encoded, so an id containing a slash cannot reach into the route.
          path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
          break;
        case 'query':
          query.push([name, String(value)]);
          break;
        case 'header':
          break;
        default:
          body[name] = value;
      }
    }

    const url = new URL(
      `${this.base.pathname.replace(/\/$/, '')}${path}`.replace(/^\/*/, '/'),
      this.base,
    );
    for (const [name, value] of query) url.searchParams.set(name, value);
    return {
      url,
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    };
  }

  private headersFrom(
    operation: OpenApiOperation,
    args: Record<string, unknown>,
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(args)) {
      if (operation.placement[name] === 'header' && value !== undefined) {
        headers[name] = String(value);
      }
    }
    return headers;
  }
}
