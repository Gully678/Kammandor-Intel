import { describe, it, expect } from 'vitest';
import { getBrand, resolveBrandKey, BRANDS } from '../brands';

describe('getBrand', () => {
  it('returns INVRT Intel for key "invrt"', () => {
    expect(getBrand('invrt').name).toBe('INVRT Intel');
  });

  it('defaults to kammandor when no key provided', () => {
    expect(getBrand().short).toBe('Kammandor');
  });

  it('defaults to kammandor for unknown key', () => {
    expect(getBrand('unknown-brand').name).toBe('Kammandor Intel');
  });

  it('kammandor gold token is unchanged (#E8A020)', () => {
    expect(getBrand('kammandor').colors.gold).toBe('#E8A020');
  });

  it('kammandor ink token is unchanged (#16141C)', () => {
    expect(getBrand('kammandor').colors.ink).toBe('#16141C');
  });

  it('kammandor page token is unchanged (#ECE5D7)', () => {
    expect(getBrand('kammandor').colors.page).toBe('#ECE5D7');
  });
});

describe('resolveBrandKey', () => {
  it('resolves "invrt" to "invrt"', () => {
    expect(resolveBrandKey('invrt')).toBe('invrt');
  });

  it('resolves undefined to "kammandor"', () => {
    expect(resolveBrandKey(undefined)).toBe('kammandor');
  });

  it('resolves empty string to "kammandor"', () => {
    expect(resolveBrandKey('')).toBe('kammandor');
  });

  it('resolves unknown value to "kammandor"', () => {
    expect(resolveBrandKey('acme')).toBe('kammandor');
  });

  it('resolves "kammandor" to "kammandor"', () => {
    expect(resolveBrandKey('kammandor')).toBe('kammandor');
  });
});

describe('BRANDS registry completeness', () => {
  it('has exactly kammandor and invrt keys', () => {
    expect(Object.keys(BRANDS).sort()).toEqual(['invrt', 'kammandor']);
  });

  it('invrt has a distinct accent from kammandor', () => {
    expect(BRANDS.invrt.colors.gold).not.toBe(BRANDS.kammandor.colors.gold);
  });
});
