import { describe, expect, it } from 'vitest';
import { parseBTSL } from '@/lib/btsl/parser';

describe('BTSL parser indentation', () => {
  it('accepts 2 spaces per indent level (regression: /4-only broke nested PSBT_SCHEMA)', () => {
    const src = `VERSION: 1
PSBT_SCHEMA S:
  PARAMS:
    @U:UTXO
  INPUTS:
    0: NATIVE P2WPKH @U
  OUTPUTS:
    0: @U 100 sats
  calc:
    f = 1
  ASSERT:
    0: f > 0
`;
    const r = parseBTSL(src);
    expect(r.success).toBe(true);
    expect(r.document?.schemas[0]?.name).toBe('S');
  });

  it('still accepts 4 spaces per level', () => {
    const src = `VERSION: 1
PSBT_SCHEMA S:
    PARAMS:
        @U:UTXO
    INPUTS:
        0: NATIVE P2WPKH @U
    OUTPUTS:
        0: @U 100 sats
    calc:
        f = 1
    ASSERT:
        0: f > 0
`;
    const r = parseBTSL(src);
    expect(r.success).toBe(true);
  });
});
