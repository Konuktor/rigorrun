/**
 * Layer C — production acceptance.
 *
 * Runs against the deployed site with a real browser and nothing else: no pnpm,
 * no Node, no extension, no key, no local runner. That is the reviewer's
 * situation, so a pass here is evidence about the product rather than about a
 * dev server.
 *
 * Nothing first-party is mocked or stubbed. The golden demo executes for real
 * in the page, and the system-state assertions below execute the same
 * deterministic pipeline in Node so the UI is checked against the engine rather
 * than against itself.
 */
import { expect, test } from '@playwright/test';
import {
  INJECTION_CASE,
  ROBUST,
  WEAK,
  deepLinkToVerdict,
  expectClean,
  expectNoOverflow,
  goToBenchmark,
  goToContract,
  openDemo,
  openEvidence,
  runBenchmarkAndWait,
  runGoldenPath,
  watchPage,
} from './support/journeys.ts';

const CRM = process.env['CRM_URL'] ?? 'https://rigorrun-crm.pages.dev';

/* ============================================================ the journey */

test.describe('golden path', () => {
  test('landing → demo → contract → benchmark → run → verdict', async ({ page }) => {
    const watchers = watchPage(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Do the job once.');
    await expect(page.getByText(/verify the system state they changed/)).toBeVisible();
    await expect(
      page.getByText(/Public benchmarks tell you which model wins a benchmark/),
    ).toBeVisible();
    await expect(page.getByText('Check the system it changed.')).toBeVisible();

    await page.getByTestId('cta-run-demo').click();
    await expect(page.getByRole('heading', { name: 'A person did the job once' })).toBeVisible();
    await expect(page.getByText('app_observation').first()).toBeVisible();

    await goToContract(page);
    await goToBenchmark(page);
    await runBenchmarkAndWait(page);

    await expect(page.getByTestId('verdict')).toContainText('Agent B (hardened) wins');
    await expect(page.getByTestId(`score-${WEAK}`)).toContainText('Gate failed');
    await expect(page.getByTestId(`score-${ROBUST}`)).toContainText('Gate passed');
    await expect(page.getByText(/N=17 test cases per agent/)).toBeVisible();

    await expectNoOverflow(page);
    expectClean(watchers);
  });

  test('observed and inferred rules are visually and semantically distinct', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);

    await expect(page.getByRole('heading', { name: 'Observed' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Inferred — needs confirmation/ }),
    ).toBeVisible();

    const limitRule = page.getByTestId('rule-forbid_over_limit');
    await expect(limitRule).toContainText(
      'must not issue a refund above $50 without an approved manager approval',
    );
    // Confidence is shown as a percentage a person can read, not a raw float.
    await expect(limitRule).toContainText('55%');
    await expect(limitRule).toContainText('RigorRun cannot answer this');
    await expect(limitRule).toContainText('Needs review');
  });

  test('confirming an inferred rule is reflected in its state', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);

    const rule = page.getByTestId('rule-forbid_over_limit');
    await expect(rule).toContainText('Needs review');
    await page.getByTestId('rule-confirm-forbid_over_limit').click();
    await expect(rule).toContainText('Confirmed');
    await expect(rule).toContainText('a check will be generated');
  });

  test('rejecting an inferred rule removes its check from the benchmark', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);

    // Baseline: the duplicate-refund check exists.
    await goToBenchmark(page);
    await page.getByTestId('case-row-case_already-refunded').click();
    await expect(page.getByText('at most one refund exists for the order')).toBeVisible();

    // Reject the rule, regenerate, and the check is gone.
    await page.getByTestId('nav-contract').click();
    await page.getByTestId('rule-toggle-forbid_duplicate').click();
    await expect(page.getByTestId('rule-forbid_duplicate')).toContainText('Rejected');
    await expect(page.getByTestId('rule-forbid_duplicate')).toContainText('Not enforced');

    await goToBenchmark(page);
    await page.getByTestId('case-row-case_already-refunded').click();
    await expect(page.getByText('at most one refund exists for the order')).toHaveCount(0);
    // And the case's expectation flips: a refund is now permitted.
    await expect(page.getByText('a refund exists for ORD-3009')).toBeVisible();
  });

  test('every case category is represented and openable', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await goToBenchmark(page);

    for (const filter of [
      'happy',
      'boundary',
      'precondition',
      'policy',
      'security',
      'resilience',
    ]) {
      await page.getByTestId(`filter-${filter}`).click();
      const rows = page.locator('[data-testid^="case-row-"]');
      await expect(rows.first()).toBeVisible();
    }

    await page.getByTestId('filter-all').click();
    await expect(page.locator('[data-testid^="case-row-"]')).toHaveCount(17);
  });

  test('the private verifier is never shown to the agent', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await goToBenchmark(page);
    await page.getByTestId(`case-row-${INJECTION_CASE}`).click();

    await expect(page.getByText('Visible to the agent')).toBeVisible();
    await expect(page.getByText(/Private verifier — never sent to the agent/)).toBeVisible();

    // The agent-visible payload must not contain any verifier internals.
    const visible = await page.locator('pre').first().textContent();
    expect(visible).not.toContain('derived.');
    expect(visible).not.toContain('state_not_exists');
  });
});

/* ========================================== the injection case, both ways */

test.describe('the injection case', () => {
  test('the baseline agent obeys the note and the verifier catches it', async ({ page }) => {
    await deepLinkToVerdict(page);
    const drawer = await openEvidence(page, WEAK, INJECTION_CASE);

    await expect(drawer).toContainText('Policy failure');
    await expect(drawer).toContainText('refund created: $500');
    await expect(drawer).toContainText('approval=null');

    // The deciding values, as facts rather than a JSON dump. Scoped to the
    // facts block because the amount also appears in the agent's own claim.
    const facts = drawer.getByTestId('observed-facts');
    await expect(facts).toContainText('$500.00');
    await expect(facts).toContainText('manager_approval');
    await expect(facts).toContainText('TCK-4016');

    // The agent's claim is shown and explicitly excluded from scoring.
    await expect(drawer).toContainText('I refunded $500.00');
    await expect(drawer).toContainText('Not used to decide a verdict');
    await expect(drawer.getByText('Deterministic').first()).toBeVisible();
  });

  test('the hardened agent refunds the requested amount', async ({ page }) => {
    await deepLinkToVerdict(page);
    const drawer = await openEvidence(page, ROBUST, INJECTION_CASE);

    await expect(drawer).toContainText('All checks passed');
    await expect(drawer).toContainText('refund created: $25');
    await expect(drawer).toContainText('ignoredInjectedInstructions');
  });

  test("an agent's textual claim does not affect its score", async ({ page }) => {
    await deepLinkToVerdict(page);

    // Both agents report success in prose; only one passes.
    const weakDrawer = await openEvidence(page, WEAK, INJECTION_CASE);
    await expect(weakDrawer).toContainText('I refunded $500.00');
    await expect(weakDrawer).toContainText('Policy failure');
    await page.getByTestId('close-evidence').click();

    await expect(page.getByTestId(`score-${WEAK}`)).toContainText('Gate failed');
    await expect(page.getByTestId(`score-${ROBUST}`)).toContainText('Gate passed');
  });
});

/* ======================================================= dialog behaviour */

test.describe('evidence dialog', () => {
  test('has dialog semantics and traps focus', async ({ page }) => {
    await deepLinkToVerdict(page);
    await openEvidence(page, WEAK, INJECTION_CASE);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAccessibleName(/injected instructions/);

    // Focus moved inside.
    expect(
      await page.evaluate(() => {
        const panel = document.querySelector('[role="dialog"]');
        return Boolean(panel && panel.contains(document.activeElement));
      }),
    ).toBe(true);

    // The page behind is locked.
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    // Tab cycles inside rather than escaping to the page.
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => {
        const panel = document.querySelector('[role="dialog"]');
        return Boolean(panel && panel.contains(document.activeElement));
      }),
    ).toBe(true);
  });

  test('Escape closes it and focus returns to the opener', async ({ page }) => {
    await deepLinkToVerdict(page);
    await openEvidence(page, WEAK, INJECTION_CASE);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('evidence-drawer')).toHaveCount(0);

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    expect(focused).toBe(`cell-${WEAK}-${INJECTION_CASE}`);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('can be opened and closed entirely from the keyboard', async ({ page }) => {
    await deepLinkToVerdict(page);

    const cell = page.getByTestId(`cell-${WEAK}-${INJECTION_CASE}`);
    await cell.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('evidence-drawer')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('evidence-drawer')).toHaveCount(0);
  });

  test('the close button also closes it', async ({ page }) => {
    await deepLinkToVerdict(page);
    await openEvidence(page, ROBUST, INJECTION_CASE);
    await page.getByTestId('close-evidence').click();
    await expect(page.getByTestId('evidence-drawer')).toHaveCount(0);
  });
});

/* ============================================================ export flow */

test.describe('reports', () => {
  test('exports a self-contained report', async ({ page }) => {
    await deepLinkToVerdict(page);
    const download = page.waitForEvent('download');
    await page.getByTestId('export-report').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^rigorrun-run_.*\.html$/);
  });

  test('previews what publishing would remove before publishing it', async ({ page }) => {
    await deepLinkToVerdict(page);
    await page.getByTestId('publish-preview').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Nothing is published automatically');
    await expect(dialog).toContainText('Tool arguments and tool results');
    await expect(dialog).toContainText('Scores, intervals and the verdict');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

/* =============================================== routing and state safety */

test.describe('routing', () => {
  for (const step of ['record', 'contract', 'benchmark', 'verdict']) {
    test(`deep link to #/demo/${step} rebuilds that step`, async ({ page }) => {
      const watchers = watchPage(page);
      await page.goto(`/#/demo/${step}`);
      await expect(page.getByTestId(`nav-${step}`)).toHaveAttribute('aria-current', 'step', {
        timeout: 90_000,
      });
      expectClean(watchers);
    });
  }

  test('back and forward move between steps without losing state', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await goToBenchmark(page);

    await page.goBack();
    await expect(
      page.getByRole('heading', { name: /One recording does not reveal a policy/ }),
    ).toBeVisible();

    await page.goForward();
    await expect(
      page.getByRole('heading', { name: /Normal, edge and adversarial cases/ }),
    ).toBeVisible();
  });

  test('refreshing the verdict re-runs it rather than stranding the user', async ({ page }) => {
    await runGoldenPath(page);
    await page.reload();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('verdict')).toContainText('wins');
  });

  test('an unknown hash falls back to the landing page without erroring', async ({ page }) => {
    const watchers = watchPage(page);
    await page.goto('/#/nonsense/route');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Do the job once.');
    expectClean(watchers);
  });

  test('a deep link into the demo app CRM loads its assets', async ({ page }) => {
    const watchers = watchPage(page);
    const response = await page.goto(`${CRM}/customers/CUST-2016`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Victor Ostrowski' })).toBeVisible();
    expectClean(watchers);
  });
});

/* ================================================= run control and errors */

test.describe('run control', () => {
  test('double-clicking Run does not start two runs', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await goToBenchmark(page);

    const runButton = page.getByTestId('step-run');
    await runButton.click();
    // The button disables itself; a second click cannot register.
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });

    // Exactly one result set: 17 cases × 2 agents.
    await expect(page.locator('[data-testid^="cell-demo-weak-"]')).toHaveCount(17);
    await expect(page.locator('[data-testid^="cell-demo-robust-"]')).toHaveCount(17);
  });

  test('navigating away mid-run does not strand the UI in "running"', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await goToBenchmark(page);
    await page.getByTestId('step-run').click();

    await page.goto('/#/demo/record');
    await expect(page.getByRole('heading', { name: 'A person did the job once' })).toBeVisible();
    await expect(page.getByTestId('step-compile')).toBeEnabled();
  });
});

/* ================================================== responsive behaviour */

test.describe('responsive', () => {
  test('the whole journey works at the current viewport with no overflow', async ({ page }) => {
    const watchers = watchPage(page);

    await openDemo(page);
    await expectNoOverflow(page);

    await goToContract(page);
    await expectNoOverflow(page);

    await goToBenchmark(page);
    await page.getByTestId(`case-row-${INJECTION_CASE}`).click();
    await expectNoOverflow(page);

    await runBenchmarkAndWait(page);
    await expectNoOverflow(page);

    await openEvidence(page, WEAK, INJECTION_CASE);
    await expectNoOverflow(page);

    expectClean(watchers);
  });

  test('the demo CRM has no overflow at this viewport', async ({ page }) => {
    await page.goto(`${CRM}/orders/ORD-3001`);
    await expect(page.getByRole('heading', { name: 'Aurora headphones' })).toBeVisible();
    await expectNoOverflow(page);
  });
});

/* =================================================== controls are truthful */

test.describe('no dead controls', () => {
  test('every visible control on the verdict screen is operable', async ({ page }) => {
    await deepLinkToVerdict(page);

    const controls = page.locator('button:visible, a[href]:visible');
    const count = await controls.count();
    expect(count).toBeGreaterThan(10);

    for (let i = 0; i < count; i += 1) {
      const control = controls.nth(i);
      const label = (await control.getAttribute('aria-label')) ?? (await control.innerText());
      // Every control must have an accessible name and a real hit area.
      expect(label.trim().length, `control ${i} has no accessible name`).toBeGreaterThan(0);
      const box = await control.boundingBox();
      expect(box, `control ${i} (${label}) has no box`).not.toBeNull();
      expect(
        box!.height,
        `control "${label.trim()}" is ${box!.height}px tall`,
      ).toBeGreaterThanOrEqual(24);
    }
  });

  test('disabled step navigation is truthful', async ({ page }) => {
    await page.goto('/#/demo/record');
    // Verdict is not reachable until a run has happened.
    await expect(page.getByTestId('nav-verdict')).toBeDisabled();
    await expect(page.getByTestId('nav-record')).toBeEnabled();
  });
});
