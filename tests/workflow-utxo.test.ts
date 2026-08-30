import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
bitcoin.initEccLib(ecc);

import {
  parseWorkflowOutpoint,
  resolvedUtxoFromWorkflowStep,
  resolveWorkflowUtxo,
  unsignedTxFromPsbt,
} from '@/lib/btsl/workflow-utxo';
import { hydrateBoundParamsFromValues } from '@/lib/btsl/hydrate-bound-params';
import * as api from '@/lib/btsl/api';
import type { BTSLParam } from '@/lib/btsl/types';

vi.mock('@/lib/btsl/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/btsl/api')>();
  return {
    ...actual,
    fetchUTXO: vi.fn(),
  };
});

const TXID = 'ab'.repeat(32);
const SCRIPT_HEX = '0014' + '11'.repeat(20);

describe('parseWorkflowOutpoint', () => {
  it('accepts txid:vout', () => {
    expect(parseWorkflowOutpoint(`${TXID}:1`, 0)).toEqual({ txid: TXID, vout: 1 });
  });

  it('accepts bare txid with default vout', () => {
    expect(parseWorkflowOutpoint(TXID.toUpperCase(), 2)).toEqual({ txid: TXID, vout: 2 });
  });

  it('falls back to saved parent txid', () => {
    expect(parseWorkflowOutpoint('', 1, TXID)).toEqual({ txid: TXID, vout: 1 });
  });
});

describe('resolvedUtxoFromWorkflowStep', () => {
  it('builds a resolved UTXO from parent PSBT outputs', () => {
    const utxo = resolvedUtxoFromWorkflowStep(TXID, 1, {
      outputs: [
        { index: 0, valueSats: '1000', scriptPubKey: SCRIPT_HEX },
        { index: 1, valueSats: '50000', scriptPubKey: SCRIPT_HEX },
      ],
    });
    expect(utxo).toMatchObject({ txid: TXID, vout: 1, value: 50000, scriptPubKey: SCRIPT_HEX });
  });
});

describe('resolveWorkflowUtxo', () => {
  const fetchMock = vi.mocked(api.fetchUTXO);

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('uses parent PSBT outputs when the explorer has no tx yet', async () => {
    fetchMock.mockRejectedValue(new Error('BTSL_ERR_05: Transaction not found: ' + TXID));
    const r = await resolveWorkflowUtxo({
      paramName: 'WF_SWAP_1_1_1',
      rawValue: TXID,
      ref: { schemaName: 'SWAP_1', outputIndex: 1, vout: 1 },
      step: {
        outputs: [{ index: 1, valueSats: '12345', scriptPubKey: SCRIPT_HEX }],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.utxo.value).toBe(12345);
      expect(r.utxo.txid).toBe(TXID);
      expect(r.utxo.vout).toBe(1);
    }
  });
});

describe('hydrateBoundParamsFromValues workflow UTXO', () => {
  const fetchMock = vi.mocked(api.fetchUTXO);
  const params: BTSLParam[] = [{ name: 'WF_SWAP_1_1_1', type: 'UTXO' }];

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('BTSL_ERR_05: Transaction not found'));
  });

  it('binds a typed parent txid without an on-chain fetch', async () => {
    const result = await hydrateBoundParamsFromValues(
      params,
      { WF_SWAP_1_1_1: TXID },
      {
        payloadParamNames: [],
        payloadAsText: {},
        derivedParamSources: {},
        derivedParamSourceTypes: {},
        derivedParamAddressTypes: {},
        workflowDerivedUtxos: {
          WF_SWAP_1_1_1: { schemaName: 'SWAP_1', outputIndex: 1, vout: 1 },
        },
        workflowContext: {
          steps: {
            SWAP_1: {
              outputs: [{ index: 1, valueSats: '999', scriptPubKey: SCRIPT_HEX }],
            },
          },
        },
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bound.WF_SWAP_1_1_1.rawValue).toBe(`${TXID}:1`);
      expect(result.bound.WF_SWAP_1_1_1.resolved).toMatchObject({ value: 999, vout: 1 });
    }
  });
});

describe('unsignedTxFromPsbt', () => {
  it('extracts predicted txid and output scripts', () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    psbt.addInput({
      hash: Buffer.from(TXID, 'hex').reverse(),
      index: 0,
      witnessUtxo: { script: Buffer.from(SCRIPT_HEX, 'hex'), value: BigInt(50_000) },
    });
    psbt.addOutput({ script: Buffer.from(SCRIPT_HEX, 'hex'), value: BigInt(49_000) });
    const unsigned = unsignedTxFromPsbt(psbt);
    expect(unsigned?.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(unsigned?.outputs[0]?.scriptPubKey).toBe(SCRIPT_HEX);
    expect(unsigned?.outputs[0]?.valueSats).toBe('49000');
  });
});
