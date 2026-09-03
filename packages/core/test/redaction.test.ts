import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  isSensitiveField,
  isSensitiveKey,
  looksLikeCardNumber,
  looksLikeSecretValue,
  redactDeep,
  redactFieldValue,
  redactText,
  sanitizeHeaders,
  sanitizeUrl,
} from '@rigorrun/core';

describe('isSensitiveKey', () => {
  const sensitive = [
    'password',
    'passwd',
    'Password',
    'user_password',
    'secret',
    'clientSecret',
    'token',
    'access_token',
    'api_key',
    'apiKey',
    'apikey',
    'Authorization',
    'bearer',
    'sessionId',
    'session_id',
    'cvv',
    'cardNumber',
    'otp',
    'private_key',
    'ssn',
  ];
  it.each(sensitive)('flags %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  const benign = ['customerName', 'orderId', 'amount', 'ticketId', 'email', 'refundReason'];
  it.each(benign)('does not flag %s', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('looksLikeCardNumber', () => {
  it('accepts Luhn-valid card numbers with separators', () => {
    expect(looksLikeCardNumber('4242424242424242')).toBe(true);
    expect(looksLikeCardNumber('4242 4242 4242 4242')).toBe(true);
    expect(looksLikeCardNumber('4242-4242-4242-4242')).toBe(true);
  });

  it('rejects numbers that fail the checksum, so order ids survive', () => {
    expect(looksLikeCardNumber('1234567890123')).toBe(false);
    expect(looksLikeCardNumber('ORD-1001')).toBe(false);
    expect(looksLikeCardNumber('49')).toBe(false);
  });
});

describe('looksLikeSecretValue', () => {
  it.each([
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4'],
    ['OpenAI key', 'sk-abcdefghijklmnopqrstuvwx'],
    ['Groq key', 'gsk_abcdefghijklmnopqrstuvwx'],
    ['Google key', 'AIzaSyA1234567890abcdefghijklmnopqrs'],
    ['GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz01'],
    ['AWS key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['PEM', '-----BEGIN RSA PRIVATE KEY-----\nMIIE'],
    ['card', '4242424242424242'],
  ])('flags %s', (_label, value) => {
    expect(looksLikeSecretValue(value)).toBe(true);
  });

  it('leaves ordinary business text alone', () => {
    expect(looksLikeSecretValue('Refund for damaged headphones')).toBe(false);
    expect(looksLikeSecretValue('ORD-1004')).toBe(false);
  });
});

describe('isSensitiveField', () => {
  it('never records password inputs', () => {
    expect(isSensitiveField({ type: 'password' })).toBe(true);
  });

  it('never records hidden inputs (CSRF tokens live there)', () => {
    expect(isSensitiveField({ type: 'hidden', name: 'csrf' })).toBe(true);
  });

  it('honours autocomplete hints for OTP and payment fields', () => {
    expect(isSensitiveField({ type: 'text', autocomplete: 'one-time-code' })).toBe(true);
    expect(isSensitiveField({ type: 'text', autocomplete: 'cc-number' })).toBe(true);
    expect(isSensitiveField({ type: 'text', autocomplete: 'cc-csc' })).toBe(true);
  });

  it('uses the visible label when the field name is opaque', () => {
    expect(isSensitiveField({ type: 'text', name: 'f1', label: 'API Key' })).toBe(true);
    expect(isSensitiveField({ type: 'text', name: 'f2', placeholder: 'Enter your password' })).toBe(
      true,
    );
  });

  it('allows ordinary business fields', () => {
    expect(isSensitiveField({ type: 'number', name: 'refundAmount', label: 'Refund amount' })).toBe(
      false,
    );
  });
});

describe('redactFieldValue', () => {
  it('drops the value of a credential field entirely', () => {
    expect(redactFieldValue('hunter2', { type: 'password', name: 'password' })).toBe(REDACTED);
  });

  it('drops secret-shaped values even from an innocuous field', () => {
    expect(redactFieldValue('sk-abcdefghijklmnopqrstuvwx', { name: 'note' })).toBe(REDACTED);
  });

  it('keeps legitimate workflow values', () => {
    expect(redactFieldValue('49.00', { name: 'amount', type: 'number' })).toBe('49.00');
  });
});

describe('redactText', () => {
  it('scrubs a secret out of surrounding prose but keeps the prose', () => {
    const out = redactText('customer pasted sk-abcdefghijklmnopqrstuvwx into the chat');
    expect(out).toContain('customer pasted');
    expect(out).toContain(REDACTED);
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('scrubs card numbers but leaves ordinary numbers', () => {
    expect(redactText('card 4242 4242 4242 4242 on file')).toContain(REDACTED);
    expect(redactText('order 1001 amount 49')).toBe('order 1001 amount 49');
  });
});

describe('sanitizeUrl', () => {
  it('never stores a reset token', () => {
    const out = sanitizeUrl('https://app.com/reset?token=ABC');
    expect(out).not.toContain('ABC');
    expect(out).toContain(encodeURIComponent(REDACTED));
  });

  it('keeps benign query parameters intact', () => {
    expect(sanitizeUrl('https://app.com/orders?customerId=CUST-1&page=2')).toBe(
      'https://app.com/orders?customerId=CUST-1&page=2',
    );
  });

  it('strips userinfo credentials', () => {
    const out = sanitizeUrl('https://alice:hunter2@app.com/x');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('alice');
  });

  it('redacts secret-shaped values even under a benign parameter name', () => {
    const out = sanitizeUrl('https://app.com/x?ref=sk-abcdefghijklmnopqrstuvwx');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('redacts credential parameters carried in the fragment', () => {
    const out = sanitizeUrl('https://app.com/cb#access_token=XYZ123456&state=ok');
    expect(out).not.toContain('XYZ123456');
    expect(out).toContain('state=ok');
  });

  it('falls back to a textual scrub for non-absolute URLs', () => {
    expect(sanitizeUrl('about:blank')).toBe('about:blank');
  });
});

describe('sanitizeHeaders', () => {
  it('removes auth and cookie headers wholesale', () => {
    const out = sanitizeHeaders({
      Authorization: 'Bearer abcdefghijklmnop',
      Cookie: 'session=deadbeef',
      'X-Api-Key': 'k',
      'Content-Type': 'application/json',
    });
    expect(out['Authorization']).toBe(REDACTED);
    expect(out['Cookie']).toBe(REDACTED);
    expect(out['X-Api-Key']).toBe(REDACTED);
    expect(out['Content-Type']).toBe('application/json');
  });
});

describe('redactDeep', () => {
  it('redacts nested credential keys and sanitises urls by key name', () => {
    const out = redactDeep({
      customer: { name: 'Ada', password: 'hunter2' },
      request: { url: 'https://app.com/reset?token=ABC', method: 'GET' },
      items: [{ apiKey: 'x' }, { amount: 49 }],
    });
    expect(out.customer.password).toBe(REDACTED);
    expect(out.customer.name).toBe('Ada');
    expect(out.request.url).not.toContain('ABC');
    expect(out.items[0]!.apiKey).toBe(REDACTED);
    expect(out.items[1]!.amount).toBe(49);
  });

  it('bounds pathological nesting', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    expect(() => redactDeep(deep)).not.toThrow();
  });
});
