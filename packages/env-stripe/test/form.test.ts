/**
 * Stripe's bracket notation, both ways.
 *
 * The client and the twin share these two functions, so what is tested here is
 * the one place they could disagree — and the shapes Stripe's official
 * libraries actually send, since that is what an agent under test will use.
 */
import { describe, expect, it } from 'vitest';
import { FormDecodeError, asList, decodeForm, encodeForm } from '../src/index.ts';

describe('encodeForm', () => {
  it('writes scalars, metadata and expansions the way Stripe reads them', () => {
    expect(
      encodeForm({
        amount: 2500,
        currency: 'usd',
        confirm: true,
        metadata: { rigorrun_run: 'run_1', rigorrun_attempt: '0' },
        expand: ['latest_charge', 'customer'],
      }),
    ).toBe(
      'amount=2500&currency=usd&confirm=true' +
        '&metadata[rigorrun_run]=run_1&metadata[rigorrun_attempt]=0' +
        '&expand[]=latest_charge&expand[]=customer',
    );
  });

  it('writes lists of objects with indices, so nested fields stay with their element', () => {
    expect(encodeForm({ items: [{ price: 'p_1', quantity: 2 }, { price: 'p_2' }] })).toBe(
      'items[0][price]=p_1&items[0][quantity]=2&items[1][price]=p_2',
    );
  });

  it('percent-encodes values, leaves out undefined, and sends null empty', () => {
    expect(
      encodeForm({
        email: 'a+b@example.test',
        name: 'Ada & Bo',
        reason: undefined,
        description: null,
      }),
    ).toBe('email=a%2Bb%40example.test&name=Ada%20%26%20Bo&description=');
  });

  it('sends nothing for an empty list or object', () => {
    expect(encodeForm({ expand: [], metadata: {}, amount: 1 })).toBe('amount=1');
  });

  it('refuses what it cannot send faithfully', () => {
    expect(() => encodeForm({ amount: Number.NaN })).toThrow(/cannot be sent/);
    expect(() => encodeForm({ metadata: { 'a[b]': 'x' } })).toThrow(/bracket/);
  });
});

describe('decodeForm', () => {
  it('reads metadata, [] lists and nested keys', () => {
    expect(
      decodeForm(
        'amount=2500&metadata[order_ref]=A1&metadata[note]=&expand[]=latest_charge&expand[]=customer',
      ),
    ).toEqual({
      amount: '2500',
      metadata: { order_ref: 'A1', note: '' },
      expand: ['latest_charge', 'customer'],
    });
  });

  it('reads what an official library sends: indices, and brackets percent-encoded', () => {
    const decoded = decodeForm(
      'expand%5B0%5D=latest_charge&expand%5B1%5D=customer&created%5Bgte%5D=1700000000',
    );
    expect(decoded).toEqual({
      expand: { '0': 'latest_charge', '1': 'customer' },
      created: { gte: '1700000000' },
    });
    expect(asList(decoded['expand'], 'expand')).toEqual(['latest_charge', 'customer']);
  });

  it('decodes + as a space and %2B as a plus', () => {
    expect(decodeForm('name=Ada+Lovelace&email=a%2Bb%40example.test')).toEqual({
      name: 'Ada Lovelace',
      email: 'a+b@example.test',
    });
  });

  it('round-trips what encodeForm writes', () => {
    const params = {
      customer: 'cus_1',
      amount: '25',
      metadata: { rigorrun_case: 'stripe.full', 'with space': 'a&b=c' },
      expand: ['latest_charge'],
    };
    expect(decodeForm(encodeForm(params))).toEqual(params);
  });

  it('keeps the last of a repeated value, and an empty or valueless one as empty', () => {
    expect(decodeForm('limit=3&limit=10&&starting_after')).toEqual({
      limit: '10',
      starting_after: '',
    });
  });

  it('keeps a key of __proto__ an ordinary parameter', () => {
    const decoded = decodeForm('__proto__[polluted]=yes&metadata[__proto__]=x');
    expect(Object.keys(decoded)).toEqual(['__proto__', 'metadata']);
    expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value).toEqual({
      polluted: 'yes',
    });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('refuses a body that is not bracket notation, naming the parameter', () => {
    const cases: [string, RegExp][] = [
      ['a=1&a[b]=2', /^a\[b\] is given both/],
      ['a[b]=2&a=1', /^a is given both/],
      ['a[]=1&a[b]=2', /given both/],
      ['a[][b]=1', /a list of objects is written with indices/],
      ['a]b=1', /not a parameter name/],
      ['[a]=1', /not a parameter name/],
      ['a[b]c=1', /not a parameter name/],
      ['a=%E0%A4%A', /percent-encoding/],
    ];
    for (const [body, message] of cases) {
      expect(() => decodeForm(body), body).toThrow(FormDecodeError);
      expect(() => decodeForm(body), body).toThrow(message);
    }
  });

  it('says which parameter was at fault', () => {
    try {
      decodeForm('metadata[k]=1&metadata=2');
      expect.unreachable();
    } catch (error) {
      expect((error as FormDecodeError).param).toBe('metadata');
    }
  });
});

describe('asList', () => {
  it('is absent when the parameter was not sent', () => {
    expect(asList(undefined, 'expand')).toBeUndefined();
  });

  it('orders indices numerically, not as text', () => {
    const decoded = decodeForm('x[10]=k&x[2]=c&x[0]=a');
    expect(asList(decoded['x'], 'x')).toEqual(['a', 'c', 'k']);
  });

  it('refuses a single value or named keys where a list belongs', () => {
    expect(() => asList('latest_charge', 'expand')).toThrow(/must be a list/);
    expect(() => asList({ a: 'x' }, 'expand')).toThrow(/must be a list/);
    expect(() => asList({ '01': 'x' }, 'expand')).toThrow(/must be a list/);
  });
});
