import { describe, it, expect } from 'vitest';
import {
  parseFeerateParamFromVsizeProduct,
  boundParamsWithPsbtImpliedFeerate,
} from '@/lib/btsl/schema-feerate';
import type { BTSLSchema, BoundParams } from '@/lib/btsl/types';

const baseSchema = (expr: string): BTSLSchema => ({
  name: 'T',
  params: [],
  inputs: [],
  outputs: [],
  calc: [{ variable: 'fees', expression: expr }],
  asserts: [],
});

describe('parseFeerateParamFromVsizeProduct', () => {
  it('reads @FEE_RATE from fees = vSize(CURRENT_PSBT) * @FEE_RATE', () => {
    expect(
      parseFeerateParamFromVsizeProduct(
        baseSchema('vSize(CURRENT_PSBT) * @FEE_RATE')
      )
    ).toBe('FEE_RATE');
  });

  it('reads param when order is @PARAM * vSize(...)', () => {
    expect(
      parseFeerateParamFromVsizeProduct(baseSchema('@FEE_RATE * vSize(CURRENT_PSBT)'))
    ).toBe('FEE_RATE');
  });

  it('returns null for fixed fees', () => {
    expect(parseFeerateParamFromVsizeProduct(baseSchema('1000'))).toBeNull();
  });
});

describe('boundParamsWithPsbtImpliedFeerate', () => {
  it('overrides @FEE_RATE when PSBT implicit fee matches integer sat/vB (PUBKEY_SPEND-style)', () => {
    const schema = baseSchema('vSize(CURRENT_PSBT) * @FEE_RATE');
    const bound: BoundParams = {
      FEE_RATE: { type: 'FEERATE', rawValue: '2', resolved: 2 },
    };
    const logs: string[] = [];
    const out = boundParamsWithPsbtImpliedFeerate(schema, bound, 141, BigInt(858), (s) => logs.push(s));
    expect(out.FEE_RATE?.resolved).toBe(6);
    expect(out.FEE_RATE?.rawValue).toBe('6');
    expect(logs.some((l) => l.includes('6 sat/vB'))).toBe(true);
  });

  it('keeps bound params when implicit fee is not divisible', () => {
    const schema = baseSchema('vSize(CURRENT_PSBT) * @FEE_RATE');
    const bound: BoundParams = {
      FEE_RATE: { type: 'FEERATE', rawValue: '6', resolved: 6 },
    };
    const out = boundParamsWithPsbtImpliedFeerate(schema, bound, 141, BigInt(857), () => {});
    expect(out.FEE_RATE?.resolved).toBe(6);
  });
});
