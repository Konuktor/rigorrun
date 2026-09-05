/**
 * A web application, as a system RigorRun can watch an agent work in.
 *
 * The whole design rests on one sentence: **the DOM is not authoritative
 * state.** A page saying "Refund issued" is a claim by the page, made by the
 * same system that would have to be wrong for the refund not to exist. Reading
 * it back and calling it verification is the exact mistake this product exists
 * to stop people making about an agent's own report — and it does not become
 * acceptable because the claim is rendered in a div.
 *
 * So a browser connection has a `stateRead` of `none` on its own. Everything a
 * run against it produces is labelled `OBSERVATIONAL`: RigorRun watched what
 * the agent did and did not check what changed.
 *
 * That is often not good enough, and it is meant to feel that way. A browser
 * connection may be given a **verifier** — an MCP or OpenAPI connection to the
 * same system — and then the clicking is watched in the browser while the
 * verdict comes from records, which is the arrangement worth having. The
 * verifier is typed as `SystemConnection`, and a browser connection is not one
 * that can be nominated: the type forbids a browser verifying itself, so
 * "verification never rests on the DOM" is a fact about the code rather than a
 * paragraph in a document.
 */
import {
  type CallResult,
  type DiscoveryResult,
  type SystemConnection,
  assertSafeSystemUrl,
} from '@rigorrun/connector';
import { BROWSER_ACTIONS, parseLocator, type Locator } from './actions.ts';
import {
  loadPlaywright,
  type Browser,
  type BrowserContext,
  type BrowserLocator,
  type BrowserPage,
} from './playwright.ts';

export interface BrowserConfig {
  /** Where the job starts. Every navigation is checked against its origin. */
  startUrl: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  /**
   * A connection to the same system that can be read for records.
   *
   * Not a browser: the type says so, because a page verifying itself is not
   * verification.
   */
  verifier?: Exclude<SystemConnection, BrowserConnection>;
  /** Where screenshots go. Paths are kept in evidence, never image data. */
  evidenceDir?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class BrowserConnection implements SystemConnection {
  readonly discovery: DiscoveryResult;
  readonly childPid = null;
  /** The reads that actually decide anything, or nothing. */
  readonly verifier: SystemConnection | undefined;
  /**
   * False unless a verifier was attached, and that is the whole design.
   *
   * A run against a browser with nothing behind it is OBSERVATIONAL: RigorRun
   * watched what the agent did and did not check what changed. Saying anything
   * stronger would mean treating a page's own words as evidence about the
   * system that rendered them.
   */
  readonly canReadState: boolean;

  private shots = 0;

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: BrowserPage,
    private readonly config: BrowserConfig,
    private readonly origin: string,
    latencyMs: number,
  ) {
    this.verifier = config.verifier;
    this.canReadState = config.verifier !== undefined;
    this.discovery = {
      serverName: origin,
      serverVersion: '',
      protocolVersion: '',
      tools: BROWSER_ACTIONS.map((action) => ({
        name: action.name,
        description: action.description,
        params: [...action.params],
        unsupported: [],
        schemaTruncated: false,
        // A page publishes no claims about itself, so there are none to carry.
        hints: {},
        risk: action.readOnly
          ? {
              level: 'read' as const,
              source: 'protocol' as const,
              rationale: 'Looking at the page changes nothing on the server.',
            }
          : {
              level: 'write' as const,
              source: 'protocol' as const,
              rationale: 'Anything that touches the page may change the system behind it.',
            },
      })),
      latencyMs,
    };
  }

  static async open(config: BrowserConfig): Promise<BrowserConnection> {
    const startedAt = Date.now();
    const start = assertSafeSystemUrl(config.startUrl);
    const playwright = await loadPlaywright();

    const browser = await playwright[config.browser ?? 'chromium'].launch({
      headless: config.headless ?? true,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(start.toString(), { waitUntil: 'domcontentloaded' });

    return new BrowserConnection(
      browser,
      context,
      page,
      config,
      start.origin,
      Date.now() - startedAt,
    );
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallResult> {
    const startedAt = Date.now();
    const done = (value: Partial<CallResult>): CallResult => ({
      ok: true,
      durationMs: Date.now() - startedAt,
      ...value,
    });
    const failed = (code: string, message: string): CallResult => ({
      ok: false,
      error: { code, message },
      durationMs: Date.now() - startedAt,
    });

    try {
      switch (name) {
        case 'navigate': {
          const url = assertSafeSystemUrl(String(args['url'] ?? ''));
          // Confined to the site under test. A page can link anywhere, and an
          // agent following a link off-site would be RigorRun driving a browser
          // to an address the operator never named.
          if (url.origin !== this.origin) {
            return failed(
              'OFF_SITE',
              `${url.origin} is not the site under test (${this.origin}). RigorRun stays where you pointed it.`,
            );
          }
          await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
          return done({ structured: { url: this.page.url() } });
        }
        case 'click':
          await this.find(parseLocator(args['selector'])).click({ timeout: this.timeout() });
          return done({ structured: { url: this.page.url() } });
        case 'fill':
          await this.find(parseLocator(args['selector'])).fill(String(args['value'] ?? ''), {
            timeout: this.timeout(),
          });
          return done({ structured: { url: this.page.url() } });
        case 'select':
          await this.find(parseLocator(args['selector'])).selectOption(
            String(args['value'] ?? ''),
            { timeout: this.timeout() },
          );
          return done({ structured: { url: this.page.url() } });
        case 'press':
          await this.page.keyboard.press(String(args['key'] ?? 'Enter'));
          return done({ structured: { url: this.page.url() } });
        case 'read_page':
          return done({ structured: await this.observe() });
        case 'screenshot': {
          const path = `${this.config.evidenceDir ?? '.'}/page-${++this.shots}.png`;
          await this.page.screenshot({ path, fullPage: true }).catch(() => undefined);
          // The path, never the bytes. A run artefact with base64 images in it
          // is how a 200MB run artefact happens.
          return done({ structured: { screenshot: path, url: this.page.url() } });
        }
        default: {
          // Not a browser action. If a verifier was attached, this is one of
          // its reads — which is how a nominated read reaches records rather
          // than reaching the page that would have to be wrong.
          if (this.verifier) return this.verifier.call(name, args);
          return failed('NO_SUCH_ACTION', `A browser cannot "${name}".`);
        }
      }
    } catch (error) {
      return failed('ACTION_FAILED', (error as Error).message);
    }
  }

  /**
   * What is on the page, as roles and names rather than as markup.
   *
   * The accessibility tree rather than the DOM, because it is the closest thing
   * a page has to a description of itself in terms a person would use — and
   * because it is stable against the styling changes that break every selector
   * written against class names.
   *
   * It is still not state. It goes into the evidence so somebody can see what
   * the agent was looking at; nothing is verified against it.
   */
  async observe(): Promise<Record<string, unknown>> {
    const snapshot = await this.page
      .locator('body')
      .ariaSnapshot({ timeout: this.timeout() })
      .catch(() => '');
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ''),
      page: snapshot.slice(0, 20_000),
    };
  }

  private timeout(): number {
    return this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Turns a locator into a Playwright one. Data in, never an expression. */
  private find(locator: Locator): BrowserLocator {
    if (locator.testId !== undefined) return this.page.getByTestId(locator.testId).first();
    if (locator.role !== undefined) {
      return this.page
        .getByRole(locator.role, ...(locator.name === undefined ? [] : [{ name: locator.name }]))
        .first();
    }
    if (locator.label !== undefined) return this.page.getByLabel(locator.label).first();
    if (locator.css !== undefined) return this.page.locator(locator.css).first();
    return this.page.getByText(locator.text ?? '').first();
  }

  async close(): Promise<void> {
    await this.page.close().catch(() => undefined);
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
    await this.verifier?.close().catch(() => undefined);
  }
}
