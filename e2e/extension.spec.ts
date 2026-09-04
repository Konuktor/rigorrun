import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fromWorkflowTrace, parseTrace, surfaceText } from '@rigorrun/core';


/**
 * Smoke-tests the real unpacked extension in a real browser: record a human
 * doing the refund workflow in Northstar, then check that what comes out is a
 * schema-valid trace the compiler can actually turn into a contract.
 */
const EXTENSION_PATH = resolve(process.cwd(), 'dist/rigorrun-extension');
const CRM = 'http://127.0.0.1:5174';

const hasBuild = existsSync(join(EXTENSION_PATH, 'manifest.json'));

test.describe('the recorder extension', () => {
  test.skip(!hasBuild, 'run `pnpm build:extension` first');
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let profile: string;
  let extensionId: string;
  /** The extension's own popup, used as a privileged page to drive the worker. */
  let popup: Page;

  test.beforeAll(async () => {
    profile = await mkdtemp(join(tmpdir(), 'rigorrun-ext-'));
    const systemChromium = '/usr/bin/chromium';
    context = await chromium.launchPersistentContext(profile, {
      ...(existsSync(systemChromium) ? { executablePath: systemChromium } : {}),
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).host;

    // Chrome does not deliver a runtime message back to the context that sent
    // it, so the worker cannot drive itself. The popup is a separate context
    // and is what a user would actually click, so we drive that instead.
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#status-text')).toBeVisible();
  });

  test.afterAll(async () => {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  });

  const ask = async (message: unknown): Promise<Record<string, unknown>> =>
    (await popup.evaluate(
      async (msg) => (await chrome.runtime.sendMessage(msg)) as Record<string, unknown>,
      message,
    )) as Record<string, unknown>;

  test('loads as a service worker with the expected identity', async () => {
    expect(context.serviceWorkers()[0]?.url()).toContain('background.js');
    const manifest = await popup.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.name).toBe('RigorRun Recorder');
    expect(manifest.manifest_version).toBe(3);
    // No remote host permissions: the extension cannot upload anywhere.
    expect(manifest.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
  });

  test('records a real workflow and produces a compilable trace', async () => {
    const page = await context.newPage();
    await page.goto(`${CRM}/`);

    // Start from the popup exactly as a user would.
    await ask({ type: 'recorder:reset' });
    await popup.locator('#start').click();
    await expect(popup.locator('#status-text')).toHaveText('Recording');

    // Reload so the content script picks up the recording flag deterministically.
    await page.goto(`${CRM}/customers/CUST-2001`);
    await page.waitForTimeout(300);

    await page.getByTestId('ticket-row-TCK-4001').click();
    await page.getByTestId('order-link-ORD-3001').click();
    await page.getByTestId('open-refund-form').click();
    await page.getByTestId('refund-amount').fill('42.00');
    await page.getByTestId('refund-reason').fill('Partial refund for defective earcup');
    await page.getByTestId('submit-refund').click();
    await page.waitForTimeout(500);

    await popup.locator('#stop').click();
    await expect(popup.locator('#status-text')).toHaveText('Idle');
    expect(Number(await popup.locator('#counter').textContent())).toBeGreaterThan(3);

    const exported = await ask({ type: 'recorder:export' });
    const trace = parseTrace(exported['trace']);

    expect(trace.app.origin).toBe(CRM);
    expect(trace.meta.recorder).toBe('rigorrun-chrome-extension');

    // Semantic observations from the instrumented app came through.
    const observations = trace.events
      .filter((event) => event.type === 'app_observation')
      .map((event) => event.observation?.name);
    expect(observations).toContain('customer.viewed');
    expect(observations).toContain('refund.created');

    // Selectors were ranked by durability, not scraped blindly.
    const clicks = trace.events.filter((event) => event.type === 'click');
    expect(clicks.length).toBeGreaterThan(0);
    expect(clicks.every((event) => event.target?.selectorStrategy === 'test_id')).toBe(true);

    // The typed amount was recorded; nothing resembling page markup was.
    const amountEvent = trace.events.find((event) => event.target?.testId === 'refund-amount');
    expect(amountEvent?.value).toBe('42.00');
    expect(JSON.stringify(trace)).not.toContain('<div');
    expect(JSON.stringify(trace)).not.toContain('</');

    // And the whole point: it normalises into the trace the compiler reads,
    // with the UI text a policy could be read out of still attached.
    const canonical = fromWorkflowTrace(trace, { environmentId: 'support-refund' });
    expect(canonical.source).toBe('browser_recorder');
    expect(canonical.steps.length).toBe(trace.events.length);
    expect(surfaceText(canonical).some((entry) => /\$50/.test(entry.text))).toBe(true);

    await page.close();
  });

  test('never records the value of a credential-like field', async () => {
    const page = await context.newPage();
    // A page with a password field, an OTP field and a hidden CSRF token.
    await page.goto(`${CRM}/`);
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<form id="danger">
           <label for="pw">Password</label><input id="pw" name="password" type="password" />
           <label for="otp">Code</label><input id="otp" autocomplete="one-time-code" type="text" />
           <input id="csrf" type="hidden" name="csrf" />
           <label for="amount">Amount</label><input id="amount" name="amount" type="text" />
         </form>`,
      );
    });

    await ask({ type: 'recorder:reset' });
    await ask({ type: 'recorder:start' });
    await page.waitForTimeout(200);

    await page.fill('#pw', 'hunter2-super-secret');
    await page.fill('#otp', '831902');
    await page.fill('#amount', '42.00');
    await page.locator('#amount').blur();
    await page.waitForTimeout(400);

    await ask({ type: 'recorder:stop' });
    const exported = await ask({ type: 'recorder:export' });
    const serialised = JSON.stringify(exported['trace']);

    expect(serialised).not.toContain('hunter2-super-secret');
    expect(serialised).not.toContain('831902');
    expect(serialised).toContain('42.00');

    const state = (await ask({ type: 'recorder:getState' }))['state'] as {
      droppedSensitiveEvents: number;
    };
    expect(state.droppedSensitiveEvents).toBeGreaterThan(0);

    await page.close();
  });

  test('strips credential parameters out of recorded URLs', async () => {
    const page = await context.newPage();
    await ask({ type: 'recorder:reset' });
    await ask({ type: 'recorder:start' });
    await page.goto(`${CRM}/customers?token=SUPERSECRETVALUE&page=2`);
    await page.waitForTimeout(400);
    await ask({ type: 'recorder:stop' });

    const exported = await ask({ type: 'recorder:export' });
    const serialised = JSON.stringify(exported['trace']);
    expect(serialised).not.toContain('SUPERSECRETVALUE');
    expect(serialised).toContain('page=2');

    await page.close();
  });
});
