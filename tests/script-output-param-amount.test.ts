import { describe, expect, it } from 'vitest';

import { parseBTSL } from '@/lib/btsl/parser';

describe('SCRIPT output amount @PARAM', () => {
  it('parses SCRIPT … @PARAM sats and keeps amountVar', () => {
    const src = `
VERSION: 1
SCRIPT_DEFS:
    VAULT P2TR:
        internal_key: NUMS_KEY
        paths:
            p SCRIPT:
                leaf_version: 192
                witness:
                asm: OP_TRUE
PSBT_SCHEMA T:
    PARAMS:
        @U:UTXO
        @VAULT_AMOUNT:SATOSHI
    INPUTS:
        0: NATIVE P2WPKH
            utxo: @U
    OUTPUTS:
        0: SCRIPT VAULT @VAULT_AMOUNT sats
        1: CHANGE @U.address change_amount sats
    calc:
        fees = 1
        change_amount = REF(@U.amount) - @VAULT_AMOUNT - fees
    ASSERT:
        0: change_amount >= DUST_LIMIT
`;
    const r = parseBTSL(src);
    expect(r.errors).toEqual([]);
    const schema = r.document?.schemas[0];
    expect(schema?.outputs).toHaveLength(2);
    expect(schema?.outputs[0]).toMatchObject({
      index: 0,
      type: 'SCRIPT',
      scriptDef: 'VAULT',
      amountVar: '@VAULT_AMOUNT',
    });
  });
});
