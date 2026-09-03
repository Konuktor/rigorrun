import { describe, expect, it } from 'vitest';
import { bestSelector, looksStableId, rankSelectors } from '@rigorrun/core';

describe('looksStableId', () => {
  it.each(['refund-form', 'customerEmail', 'main_content', 'nav'])('accepts %s', (id) => {
    expect(looksStableId(id)).toBe(true);
  });

  it.each([
    ':r1:',
    'radix-:r3:',
    'headlessui-menu-item-4',
    'a3f7c1e2-4b5d-4c6e-8a9b-0c1d2e3f4a5b',
    'input-12345',
    'el-42',
    '',
  ])('rejects generated id %s', (id) => {
    expect(looksStableId(id)).toBe(false);
  });
});

describe('rankSelectors', () => {
  it('prefers a test id above everything else', () => {
    const [best] = rankSelectors({
      tagName: 'button',
      testId: 'submit-refund',
      id: 'submitRefund',
      role: 'button',
      accessibleName: 'Issue refund',
    });
    expect(best?.strategy).toBe('test_id');
    expect(best?.value).toBe('[data-testid="submit-refund"]');
  });

  it('falls back to a stable id when there is no test id', () => {
    const [best] = rankSelectors({ tagName: 'input', id: 'refundAmount', role: 'spinbutton' });
    expect(best?.strategy).toBe('stable_id');
    expect(best?.value).toBe('#refundAmount');
  });

  it('skips a generated id and uses role plus accessible name', () => {
    const [best] = rankSelectors({
      tagName: 'button',
      id: ':r7:',
      role: 'button',
      accessibleName: 'Resolve ticket',
    });
    expect(best?.strategy).toBe('role_name');
    expect(best?.value).toBe('role=button[name="Resolve ticket"]');
  });

  it('uses the label when no role or name is available', () => {
    const [best] = rankSelectors({ tagName: 'input', label: 'Refund amount' });
    expect(best?.strategy).toBe('label');
  });

  it('orders the full fallback chain by durability', () => {
    const strategies = rankSelectors({
      tagName: 'input',
      testId: 't',
      id: 'stableThing',
      role: 'textbox',
      accessibleName: 'Amount',
      label: 'Amount',
      placeholder: '0.00',
      name: 'amount',
      domPath: 'form > div:nth-child(2) > input',
    }).map((c) => c.strategy);

    expect(strategies).toEqual([
      'test_id',
      'stable_id',
      'role_name',
      'label',
      'placeholder',
      'css',
      'css',
    ]);
  });

  it('always returns something, even for a bare element', () => {
    const [best] = rankSelectors({ tagName: 'DIV' });
    expect(best?.value).toBe('div');
  });

  it('escapes quotes so a generated selector stays valid', () => {
    const [best] = rankSelectors({ tagName: 'button', testId: 'say "hi"' });
    expect(best?.value).toBe('[data-testid="say \\"hi\\""]');
  });

  it('caps the number of candidates it stores', () => {
    expect(
      rankSelectors({
        tagName: 'input',
        testId: 't',
        id: 'stable',
        role: 'textbox',
        accessibleName: 'a',
        label: 'b',
        placeholder: 'c',
        text: 'd',
        name: 'e',
        domPath: 'f',
      }).length,
    ).toBeLessThanOrEqual(8);
  });

  it('ignores very long visible text, which is rarely stable', () => {
    const strategies = rankSelectors({ tagName: 'div', text: 'x'.repeat(200) }).map(
      (c) => c.strategy,
    );
    expect(strategies).not.toContain('text');
  });
});

describe('bestSelector', () => {
  it('returns the winner alongside the ranked fallbacks', () => {
    const result = bestSelector({
      tagName: 'button',
      testId: 'go',
      role: 'button',
      accessibleName: 'Go',
    });
    expect(result.selector).toBe('[data-testid="go"]');
    expect(result.strategy).toBe('test_id');
    expect(result.candidates.length).toBeGreaterThan(1);
  });
});
