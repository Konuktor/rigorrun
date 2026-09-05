/**
 * The schema-driven business systems, in a real browser.
 *
 * Two claims are under test, and they are different claims.
 *
 * That one renderer produces four products a customer would recognise: each
 * arrives under its own name, with its own navigation, its own colour and the
 * shape of view its adapter asked for — and a person can find a record and
 * finish a piece of work in each.
 *
 * And that the app *is* the environment adapter rather than a copy of its
 * data. Approving an invoice by clicking has to change the same state a
 * benchmark reads back, or the demo and the test are two different things
 * wearing one name.
 *
 * Nothing here names a business rule. Every expectation below is either a
 * declaration read out of the adapter or a fact from its fixture.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const OPS = 'http://127.0.0.1:5175';

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${OPS}/#/${path}`);
  await expect(page.getByTestId('brand')).toBeVisible();
}

/** Rows are links in a list or board and contain one in a table. */
async function openRecord(page: Page, id: string): Promise<void> {
  const row: Locator = page.getByTestId(`row-${id}`).or(page.getByTestId(`card-${id}`)).first();
  await expect(row).toBeVisible();
  const inner = row.getByRole('link');
  await ((await inner.count()) > 0 ? inner.first() : row).click();
}

test.describe('one renderer, four systems', () => {
  test('each arrives with its own name, navigation and colour', async ({ page }) => {
    const accents: string[] = [];
    const names: string[] = [];

    for (const [environment, entity] of [
      ['finance-invoice', 'Invoice'],
      ['sales-lead', 'Lead'],
      ['it-access', 'Employee'],
      ['ops-fulfillment', 'Order'],
    ] as const) {
      await open(page, `${environment}/${entity}`);
      const shell = page.locator('[data-environment]');
      await expect(shell).toHaveAttribute('data-environment', environment);

      accents.push(
        await shell.evaluate((node) =>
          getComputedStyle(node as HTMLElement).getPropertyValue('--accent').trim(),
        ),
      );
      names.push((await page.getByTestId('brand').first().innerText()).trim());

      // Whatever shape was declared, something is listed.
      const rows = page.locator('[data-testid^="row-"], [data-testid^="card-"]');
      expect(await rows.count(), environment).toBeGreaterThan(0);
    }

    // Four names, four colours. Were they equal, one renderer would prove
    // nothing: the screens would match because they are the same screen.
    expect(new Set(names).size).toBe(4);
    expect(new Set(accents).size).toBe(4);
  });

  test('a collection declared as a board renders as one', async ({ page }) => {
    await open(page, 'sales-lead/Lead');
    // The heading is the declared plural, not the entity name.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pipeline');
    // Columns come from the grouping field's enum, so an empty stage is still
    // a column — a board that hid them would misreport the pipeline.
    for (const stage of ['new', 'working', 'qualified', 'disqualified']) {
      await expect(page.getByRole('heading', { name: new RegExp(`^${stage}\\b`, 'i') })).toBeVisible();
    }
    expect(await page.locator('[data-testid^="card-"]').count()).toBeGreaterThan(0);
  });

  test('a collection declared as a table renders as one, with the declared columns', async ({
    page,
  }) => {
    await open(page, 'finance-invoice/Invoice');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Invoices');
    await expect(page.getByRole('table')).toBeVisible();
    for (const column of ['Amount', 'Status']) {
      await expect(page.getByRole('columnheader', { name: column })).toBeVisible();
    }
  });

  test('work done by clicking changes the state a benchmark would read', async ({ page }) => {
    await open(page, 'finance-invoice/Invoice');
    await openRecord(page, 'INV-901');
    await expect(page.getByTestId('field-invoiceStatus')).toContainText('received');

    await page.getByTestId('action-approveInvoice').click();
    const form = page.getByTestId('action-form-approveInvoice');
    await expect(form).toBeVisible();
    // The form is generated from the action's parameters, and the record it
    // was opened on is already filled in.
    await expect(page.getByTestId('param-invoiceId')).toHaveValue('INV-901');
    await page.getByTestId('submit-approveInvoice').click();

    await expect(page.getByTestId('action-notice')).toContainText('Done');
    // The authoritative row changed, and the page is reading it back.
    await expect(page.getByTestId('field-invoiceStatus')).toContainText('approved');
  });

  test('the system records facts and leaves policy alone', async ({ page }) => {
    await open(page, 'it-access/Employee');
    await openRecord(page, 'EMP-2');
    // A terminated employee is still here to be found. If the environment
    // hid or blocked them, no benchmark could measure an agent that granted
    // them access — every agent would pass.
    await expect(page.getByTestId('field-employment')).toContainText('terminated');
  });

  test('text written by an outsider is rendered as text', async ({ page }) => {
    await open(page, 'it-access/Employee');
    await openRecord(page, 'EMP-1');
    const note = page.getByTestId('prose-requestNote');
    await expect(note).toBeVisible();
    // It arrives as content and never as markup.
    expect(await note.locator('script, iframe, img').count()).toBe(0);
  });

  test('has no horizontal overflow on a small phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of [
      'finance-invoice/Invoice',
      'sales-lead/Lead',
      'it-access/Employee',
      'ops-fulfillment/Order',
    ]) {
      await open(page, path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});
