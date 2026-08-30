import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
bitcoin.initEccLib(ecc);

import { parseBTSL } from '@/lib/btsl/parser';
import { buildRemainingWorkflowPsbt } from '@/lib/btsl/workflow-chain';
import { BRC20_SWAP_DEMO_CHANGE_ADDRESS } from '@/lib/btsl/brc20-swap-chain';
import * as api from '@/lib/btsl/api';
import type { BoundParams } from '@/lib/btsl/types';

vi.mock('@/lib/btsl/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/btsl/api')>();
  return { ...actual, fetchUTXO: vi.fn() };
});

const USER_TXID = 'aa'.repeat(32);
const CHANGE_ADDR = BRC20_SWAP_DEMO_CHANGE_ADDRESS;
const P2TR_SPK = Buffer.from(
  bitcoin.address.toOutputScript(CHANGE_ADDR, bitcoin.networks.bitcoin)
).toString('hex');

const BTSL = `VERSION: 1
CONST:
    DUST_LIMIT = 546
PSBT_SCHEMA SWAP_1:
    PARAMS:
        @USER_UTXO:UTXO
        @PAYLOAD:HEX_DATA
        @FEE_RATE:FEERATE
    INPUTS:
        0: NATIVE P2TR
            utxo: @USER_UTXO
    OUTPUTS:
        0: OP_RETURN @PAYLOAD
        1: CHANGE @USER_UTXO.address change_amount sats
    calc:
        fees = vSize(CURRENT_PSBT) * @FEE_RATE
        change_amount = REF(@USER_UTXO.amount) - fees
    ASSERT:
        0: change_amount >= DUST_LIMIT

PSBT_SCHEMA SWAP_2:
    OPTIONS:
        DEPENDS_ON SWAP_1
    PARAMS:
        @PAYLOAD:HEX_DATA
        @FEE_RATE:FEERATE
        @CHANGE_ADDRESS:ADDRESS
    INPUTS:
        0: NATIVE P2TR
            utxo: SWAP_1:1.txid:1
    OUTPUTS:
        0: OP_RETURN @PAYLOAD
        1: CHANGE @CHANGE_ADDRESS change_amount sats
    calc:
        fees = vSize(CURRENT_PSBT) * @FEE_RATE
        change_amount = REF(SWAP_1:1.amount) - fees
    ASSERT:
        0: change_amount >= DUST_LIMIT
`;

describe('buildRemainingWorkflowPsbt', () => {
  const fetchMock = vi.mocked(api.fetchUTXO);

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('not on chain'));
  });

  it('builds child hops from predicted parent txid without explorer', async () => {
    fetchMock.mockImplementation(async (txid: string) => {
      if (txid === USER_TXID) {
        return {
          txid: USER_TXID,
          vout: 1,
          value: 20_000,
          scriptPubKey: P2TR_SPK,
          scriptType: 'P2TR' as const,
          address: CHANGE_ADDR,
        };
      }
      throw new Error('not on chain');
    });

    const parsed = parseBTSL(BTSL);
    expect(parsed.success).toBe(true);
    const document = parsed.document!;
    const bound: BoundParams = {
      USER_UTXO: {
        type: 'UTXO',
        rawValue: `${USER_TXID}:1`,
        resolved: {
          txid: USER_TXID,
          vout: 1,
          value: 20_000,
          scriptPubKey: P2TR_SPK,
          scriptType: 'P2TR',
          address: CHANGE_ADDR,
        },
      },
      PAYLOAD: {
        type: 'HEX_DATA',
        rawValue: '{"p":"brc-20","op":"swap","tick":"DEMO","amt":"1"}',
        resolved: '{"p":"brc-20","op":"swap","tick":"DEMO","amt":"1"}',
        payloadAsText: true,
      },
      FEE_RATE: { type: 'FEERATE', rawValue: '1.2', resolved: 1.2 },
      CHANGE_ADDRESS: {
        type: 'ADDRESS',
        rawValue: BRC20_SWAP_DEMO_CHANGE_ADDRESS,
        resolved: BRC20_SWAP_DEMO_CHANGE_ADDRESS,
      },
    };

    const { results, workflow } = await buildRemainingWorkflowPsbt({
      document,
      fromIndex: 0,
      boundParams: bound,
      workflowContext: { steps: {} },
    });

    expect(results.SWAP_1?.success).toBe(true);
    expect(results.SWAP_2?.success).toBe(true);
    expect(results.SWAP_2?.psbtHex).toMatch(/^70736274/);
    expect(workflow.steps.SWAP_1?.txid).toHaveLength(64);
    expect(workflow.steps.SWAP_2?.txid).toHaveLength(64);
    expect(workflow.steps.SWAP_1?.txid).not.toBe(workflow.steps.SWAP_2?.txid);
  });
});
