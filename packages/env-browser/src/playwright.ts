/**
 * Loading Playwright, and not installing it.
 *
 * `playwright-core` is an optional peer dependency and stays that way. The
 * package with the browsers in it is about 300MB, most projects never need a
 * browser at all, and a tool people install with `npx` to try in ten minutes
 * cannot start with a 300MB download for a connector they may not use.
 *
 * `playwright-core` rather than `playwright`: the latter has a postinstall that
 * downloads browsers, which is exactly the thing being avoided. Somebody who
 * wants the browser lane installs it and runs `playwright install` themselves,
 * once, knowingly.
 *
 * The specifier is built rather than written so the bundler does not try to
 * resolve a module that is absent by design.
 */
export const BROWSER_MISSING = [
  'A browser environment needs Playwright, which RigorRun does not install for you: it is',
  'about 300MB of browser binaries, and most projects never need one.',
  '',
  '  npm i -g playwright-core',
  '  npx playwright install chromium',
  '',
  'Then reconnect. Nothing about this project changes and nothing you have set up is lost.',
].join('\n');

/**
 * Only what this package uses, declared here rather than imported.
 *
 * Importing Playwright's types would make the build depend on a package that
 * is optional by design — an install without it would not typecheck, which is
 * the opposite of optional. So the surface is written out: five methods, and
 * the compiler still checks every call against them.
 */
export interface BrowserPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  keyboard: { press(key: string): Promise<void> };
  screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  locator(selector: string): BrowserLocator;
  getByRole(role: string, options?: { name?: string }): BrowserLocator;
  getByLabel(label: string): BrowserLocator;
  getByTestId(id: string): BrowserLocator;
  getByText(text: string): BrowserLocator;
  accessibility?: { snapshot(): Promise<unknown> };
  close(): Promise<void>;
}

export interface BrowserLocator {
  first(): BrowserLocator;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  selectOption(value: string, options?: { timeout?: number }): Promise<unknown>;
  ariaSnapshot(options?: { timeout?: number }): Promise<string>;
}

export interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

export interface Browser {
  newContext(options?: { storageState?: unknown }): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface Playwright {
  chromium: { launch(options?: { headless?: boolean }): Promise<Browser> };
  firefox: { launch(options?: { headless?: boolean }): Promise<Browser> };
  webkit: { launch(options?: { headless?: boolean }): Promise<Browser> };
}

let cached: Playwright | undefined;

export async function loadPlaywright(): Promise<Playwright> {
  if (cached) return cached;
  try {
    const specifier = 'playwright' + '-core';
    cached = (await import(/* @vite-ignore */ specifier)) as Playwright;
    return cached;
  } catch {
    throw new Error(BROWSER_MISSING);
  }
}
