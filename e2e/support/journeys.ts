/**
 * Shared journey helpers.
 *
 * The same steps drive the local suite and the production suite, so a
 * behavioural change cannot pass in one and fail silently in the other. These
 * are ordinary Playwright actions with web-first assertions — no fixed waits,
 * no polling loops.
 */
import {
  expect,
  type ConsoleMessage,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';

export interface PageWatchers {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/**
 * Records anything that would make a reviewer distrust the page. Third-party
 * noise is not filtered out because the product loads no third-party anything.
 */
export function watchPage(page: Page): PageWatchers {
  const watchers: PageWatchers = { consoleErrors: [], pageErrors: [], failedRequests: [] };

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') watchers.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => watchers.pageErrors.push(error.message));
  page.on('requestfailed', (request: Request) => {
    watchers.failedRequests.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      watchers.failedRequests.push(`${response.url()} — HTTP ${response.status()}`);
    }
  });

  return watchers;
}

export function expectClean(watchers: PageWatchers): void {
  expect(watchers.consoleErrors, `console errors: ${watchers.consoleErrors.join(' | ')}`).toEqual(
    [],
  );
  expect(watchers.pageErrors, `page errors: ${watchers.pageErrors.join(' | ')}`).toEqual([]);
  expect(
    watchers.failedRequests,
    `failed requests: ${watchers.failedRequests.join(' | ')}`,
  ).toEqual([]);
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

export async function expectNoOverflow(page: Page): Promise<void> {
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
}

/* ------------------------------------------------------------- navigation */

export async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('cta-run-demo').click();
  await expect(page.getByRole('heading', { name: 'A person did the job once' })).toBeVisible();
}

export async function goToContract(page: Page): Promise<void> {
  await page.getByTestId('step-compile').click();
  await expect(
    page.getByRole('heading', { name: /One recording does not reveal a policy/ }),
  ).toBeVisible();
}

export async function goToBenchmark(page: Page): Promise<void> {
  await page.getByTestId('step-generate').click();
  await expect(
    page.getByRole('heading', { name: /Normal, edge and adversarial cases/ }),
  ).toBeVisible();
}

export async function runBenchmarkAndWait(page: Page): Promise<void> {
  await page.getByTestId('step-run').click();
  await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });
}

/** Landing → verdict, the whole golden path. */
export async function runGoldenPath(page: Page): Promise<void> {
  await openDemo(page);
  await goToContract(page);
  await goToBenchmark(page);
  await runBenchmarkAndWait(page);
}

/** Straight to a verdict via a deep link, for tests that only need the result. */
export async function deepLinkToVerdict(page: Page): Promise<void> {
  await page.goto('/#/demo/verdict');
  await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });
}

export function evidenceDrawer(page: Page): Locator {
  return page.getByTestId('evidence-drawer');
}

export async function openEvidence(page: Page, agentId: string, caseId: string): Promise<Locator> {
  await page.getByTestId(`cell-${agentId}-${caseId}`).click();
  const drawer = evidenceDrawer(page);
  await expect(drawer).toBeVisible();
  return drawer;
}

/* ---------------------------------------------------------------- fixtures */

/**
 * Cases are generated, so their ids are not knowable in advance. Journeys ask
 * for "a case this agent has a result for" instead of naming one.
 */
export async function firstCaseId(page: Page, agentId: string): Promise<string> {
  const testId = await page
    .locator(`[data-testid^="cell-${agentId}-"]`)
    .first()
    .getAttribute('data-testid');
  return (testId ?? '').replace(`cell-${agentId}-`, '');
}
export const WEAK = 'naive';
export const ROBUST = 'careful';
export const REFERENCE = 'reference';
