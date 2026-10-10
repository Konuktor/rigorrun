import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  expectClean,
  expectNoOverflow,
  goToBenchmark,
  goToContract,
  openDemo,
  runBenchmarkAndWait,
  watchPage,
} from './support/journeys.ts';

const OPS = process.env['OPS_URL'] ?? 'http://127.0.0.1:5175';
const CRM = process.env['CRM_URL'] ?? 'http://127.0.0.1:5174';
const LABEL = 'Synthetic data · scripted agents · executed locally · not a qualified release suite';

for (const domain of [
  {
    key: 'refund',
    title: 'Refund processing',
    environment: 'support-refund',
    action: 'createRefund',
    link: CRM,
  },
  {
    key: 'invoice',
    title: 'Invoice approval',
    environment: 'finance-invoice',
    action: 'approveInvoice',
    link: `${OPS}/#/finance-invoice`,
  },
  {
    key: 'access',
    title: 'Access provisioning',
    environment: 'it-access',
    action: 'grantAccess',
    link: `${OPS}/#/it-access`,
  },
]) {
  test(`${domain.key}: selected example executes and exports its own synthetic report`, async ({
    page,
  }) => {
    const watchers = watchPage(page);
    await openDemo(page);
    await page.getByLabel('Example workflow').selectOption(domain.key);
    await expect(page.getByRole('heading', { name: 'A person did the job once' })).toBeVisible();
    await expect(page.getByLabel('Example workflow')).toHaveValue(domain.key);
    await expect(page.getByText(domain.action, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the demo app' })).toHaveAttribute(
      'href',
      domain.link,
    );
    await expect(page.getByText(LABEL, { exact: true })).toBeVisible();
    await goToContract(page);
    await goToBenchmark(page);
    await runBenchmarkAndWait(page);
    const download = page.waitForEvent('download');
    await page.getByTestId('export-report').click();
    const report = await download;
    const html = await readFile((await report.path())!, 'utf8');
    expect(html).toContain(domain.environment);
    expect(html).toContain('synthetic demo environment');
    expect(html.includes('scripted agents'), 'download labels scripted agents').toBe(true);
    expect(
      html.includes('not a qualified release suite'),
      'download preserves the qualification limit',
    ).toBe(true);
    await expect(page.getByTestId('oracle-caveat')).toContainText('control, not a contender');
    expectClean(watchers);
  });
}

test('switching after a verdict discards the previous benchmark, results and decisions', async ({
  page,
}) => {
  await openDemo(page);
  await goToContract(page);
  await goToBenchmark(page);
  await runBenchmarkAndWait(page);
  await page.getByLabel('Example workflow').selectOption('invoice');
  await expect(page).toHaveURL(/#\/demo\/record\?workflow=invoice$/);
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await expect(page.getByTestId('nav-benchmark')).toBeDisabled();
  await expect(page.getByTestId('nav-verdict')).toBeDisabled();
  await goToContract(page);
  await expect(page.getByTestId('step-generate')).toBeDisabled();
  await expect(page.getByText('Needs an answer').first()).toBeVisible();
  await expect(page.getByText('createRefund', { exact: true })).toHaveCount(0);
});

test('workflow key survives navigation, review redirect, reload and start over', async ({
  page,
}) => {
  await page.goto('/#/demo/verdict?workflow=access');
  await expect(page).toHaveURL(/#\/demo\/confirm\?workflow=access$/);
  await expect(page.getByLabel('Example workflow')).toHaveValue('access');
  await expect(page.getByTestId('step-generate')).toBeDisabled();
  await goToBenchmark(page);
  await expect(page).toHaveURL(/#\/demo\/benchmark\?workflow=access$/);
  await page.reload();
  await expect(page).toHaveURL(/#\/demo\/confirm\?workflow=access$/);
  await expect(page.getByTestId('step-generate')).toBeDisabled();
  await page.getByTestId('reset-demo').click();
  await expect(page).toHaveURL(/#\/demo\/record\?workflow=access$/);
  await expect(page.getByText('grantAccess', { exact: true }).first()).toBeVisible();
});

test('changing only the URL workflow key remounts the demo instead of keeping old artifacts', async ({
  page,
}) => {
  await openDemo(page);
  await goToContract(page);
  await goToBenchmark(page);
  await runBenchmarkAndWait(page);
  await page.evaluate(() => {
    window.location.hash = '#/demo/verdict?workflow=invoice';
  });
  await expect(page).toHaveURL(/#\/demo\/confirm\?workflow=invoice$/);
  await expect(page.getByLabel('Example workflow')).toHaveValue('invoice');
  await expect(page.getByTestId('step-generate')).toBeDisabled();
  await expect(page.getByTestId('verdict')).toHaveCount(0);
});

test('an in-flight example cannot publish its old verdict after a URL workflow switch', async ({
  page,
}) => {
  await openDemo(page);
  await goToContract(page);
  await goToBenchmark(page);
  await page.getByTestId('step-run').click();
  await expect(page.getByLabel('Example workflow')).toBeDisabled();
  await page.evaluate(() => {
    window.location.hash = '#/demo/record?workflow=invoice';
  });
  await expect(page.getByLabel('Example workflow')).toHaveValue('invoice');
  await expect(page.getByRole('heading', { name: 'A person did the job once' })).toBeVisible();
  await goToContract(page);
  await goToBenchmark(page);
  await runBenchmarkAndWait(page);
  await expect(page).toHaveURL(/#\/demo\/verdict\?workflow=invoice$/);
  const download = page.waitForEvent('download');
  await page.getByTestId('export-report').click();
  const report = await download;
  const html = await readFile((await report.path())!, 'utf8');
  expect(html).toContain('finance-invoice');
  expect(html).not.toContain('support-refund');
});

test('an unknown workflow falls back to the refund record without executing a verdict', async ({
  page,
}) => {
  const watchers = watchPage(page);
  await page.goto('/#/demo/verdict?workflow=unknown');
  await expect(page).toHaveURL(/#\/demo\/record$/);
  await expect(page.getByLabel('Example workflow')).toHaveValue('refund');
  await expect(page.getByText('createRefund', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  expectClean(watchers);
});

test('a later-step URL inside an open example rebuilds review without consent', async ({
  page,
}) => {
  await page.goto('/#/demo/record?workflow=invoice');
  await expect(page.getByRole('heading', { name: 'A person did the job once' })).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = '#/demo/benchmark?workflow=invoice';
  });
  await expect(page).toHaveURL(/#\/demo\/confirm\?workflow=invoice$/);
  await expect(page.getByTestId('step-generate')).toBeDisabled();
  await expect(page.getByText('Needs an answer').first()).toBeVisible();
});

test('the selector and synthetic explanation fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  await page.getByLabel('Example workflow').selectOption('invoice');
  await expect(page.getByText(LABEL, { exact: true })).toBeVisible();
  await expectNoOverflow(page);
});

test('leaving a demo for Projects preserves its URL and reload destination', async ({ page }) => {
  await page.goto('/#/demo/record?workflow=invoice');
  await expect(page.getByRole('heading', { name: 'A person did the job once' })).toBeVisible();
  await page.getByTestId('brand').click();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.getByTestId('workflow-selector')).toHaveCount(0);
});
