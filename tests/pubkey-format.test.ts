import { describe, it, expect } from 'vitest';
import * as ecc from 'tiny-secp256k1';
import { normalizeSecPubkeyHexToCompressed } from '@/lib/btsl/pubkey-format';

describe('normalizeSecPubkeyHexToCompressed', () => {
  it('passes through valid compressed pubkey', () => {
    const sk = new Uint8Array(32);
    sk[31] = 42;
    const compressed = ecc.pointFromScalar(sk, true);
    expect(compressed).toBeTruthy();
    const hex = Buffer.from(compressed!).toString('hex');
    expect(hex.length).toBe(66);
    expect(normalizeSecPubkeyHexToCompressed(hex)).toBe(hex.toLowerCase());
  });

  it('compresses uncompressed SEC (04) to 33-byte form', () => {
    const sk = new Uint8Array(32);
    sk[31] = 7;
    const uncompressed = ecc.pointFromScalar(sk, false);
    expect(uncompressed).toBeTruthy();
    const hex04 = Buffer.from(uncompressed!).toString('hex');
    expect(hex04.startsWith('04')).toBe(true);
    expect(hex04.length).toBe(130);

    const out = normalizeSecPubkeyHexToCompressed(hex04);
    expect(out.length).toBe(66);
    expect(out.startsWith('02') || out.startsWith('03')).toBe(true);

    const expected = Buffer.from(ecc.pointCompress(uncompressed!, true)!).toString('hex');
    expect(out).toBe(expected.toLowerCase());
  });

  it('rejects 66-char hex starting with 04', () => {
    expect(() => normalizeSecPubkeyHexToCompressed('04' + '11'.repeat(32))).toThrow(/02 or 03/);
  });
});
