import { describe, it, expect } from 'vitest';
import { parseBTSL } from '@/lib/btsl/parser';
import { buildBrc20SwapChainBtsl } from '@/lib/btsl/brc20-swap-chain';
import { foldDecimalProductsToSats } from '@/lib/btsl/runtime-expr';
import { lookupParamsFileValue } from '@/lib/btsl/params-file';

describe('buildBrc20SwapChainBtsl', () => {
  it('parses 5 schemas with DEPENDS_ON and workflow refs', () => {
    const result = parseBTSL(buildBrc20SwapChainBtsl(5));
    expect(result.success).toBe(true);
    expect(result.document?.schemas).toHaveLength(5);
    expect(result.document?.schemas[0]?.name).toBe('SWAP_1');
    expect(result.document?.schemas[4]?.name).toBe('SWAP_5');
    expect(result.document?.schemas[1]?.options?.dependsOn).toBe('SWAP_1');
    expect(result.document?.schemas[4]?.options?.dependsOn).toBe('SWAP_4');
    expect(result.document?.schemas[1]?.inputs[0]?.workflowRef).toEqual({
      schemaName: 'SWAP_1',
      outputIndex: 1,
      vout: 1,
    });
    expect(result.document?.schemas[1]?.inputs[0]?.type).toBe('NATIVE_P2TR_KEY');
  });

  it('buildBrc20SwapChainBtsl(20) still parses', () => {
    const result = parseBTSL(buildBrc20SwapChainBtsl(20));
    expect(result.success).toBe(true);
    expect(result.document?.schemas).toHaveLength(20);
  });
});

describe('bare DEPENDS_ON (no OPTIONS:)', () => {
  it('sets options.dependsOn', () => {
    const src = `VERSION: 1

PSBT_SCHEMA SWAP_1:
    PARAMS:
        @U:UTXO
    INPUTS:
        0: NATIVE P2TR
            utxo: @U
    OUTPUTS:
        0: OP_RETURN "aa"

PSBT_SCHEMA SWAP_2:
    DEPENDS_ON SWAP_1
    PARAMS:
        @A:ADDRESS
    INPUTS:
        0: NATIVE P2TR
            utxo: SWAP_1:1.txid:1
    OUTPUTS:
        0: CHANGE @A amt sats
    calc:
        amt = 1000
`;
    const result = parseBTSL(src);
    expect(result.success).toBe(true);
    expect(result.document?.schemas.find((s) => s.name === 'SWAP_2')?.options?.dependsOn).toBe('SWAP_1');
  });
});

describe('foldDecimalProductsToSats', () => {
  it('floors vsize * 1.2 to integer sats', () => {
    expect(foldDecimalProductsToSats('141 * 1.2')).toBe('169');
  });
});

describe('lookupParamsFileValue aliases', () => {
  it('maps USER_UTXO onto @USER', () => {
    expect(lookupParamsFileValue({ USER_UTXO: 'ab' }, 'USER')).toBe('ab');
  });
  it('maps CHANGE_ADDRESS onto @CHANGE_ADDR', () => {
    expect(lookupParamsFileValue({ CHANGE_ADDRESS: 'bc1p' }, 'CHANGE_ADDR')).toBe('bc1p');
  });
});
