import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
bitcoin.initEccLib(ecc);
import { runCheckerPipeline } from '@/lib/btsl/checker-pipeline';
import type { BTSLDocument, BTSLSchema, BoundParams } from '@/lib/btsl/types';
import * as api from '@/lib/btsl/api';

vi.mock('@/lib/btsl/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/btsl/api')>();
  return {
    ...actual,
    fetchUTXO: vi.fn(),
  };
});

const TXID = 'c'.repeat(64);
const SCRIPT_HEX = '0014' + '22'.repeat(20);
const WITNESS_VALUE = BigInt(50_000);
const OUT_VALUE = BigInt(49_000);
const MAINNET_ADDR = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function minimalDoc(schema: BTSLSchema): BTSLDocument {
  return { version: 1, consts: [], scriptDefs: [], schemas: [schema] };
}

describe('runCheckerPipeline workflow parent not on-chain', () => {
  const fetchMock = vi.mocked(api.fetchUTXO);

  beforeEach(() => {
    fetchMock.mockRejectedValue(new Error('BTSL_ERR_05: Transaction not found: ' + TXID));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('certifies I-3 from the parent PSBT output', async () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    psbt.addInput({
      hash: Buffer.from(TXID, 'hex').reverse(),
      index: 1,
      witnessUtxo: { script: Buffer.from(SCRIPT_HEX, 'hex'), value: WITNESS_VALUE },
    });
    psbt.addOutput({
      script: bitcoin.address.toOutputScript(MAINNET_ADDR, bitcoin.networks.bitcoin),
      value: OUT_VALUE,
    });

    const schema: BTSLSchema = {
      name: 'SWAP_2',
      params: [],
      inputs: [
        {
          index: 0,
          utxoRef: '@WF_SWAP_1_1_1',
          type: 'NATIVE_P2WPKH',
          workflowRef: { schemaName: 'SWAP_1', outputIndex: 1, vout: 1 },
        },
      ],
      outputs: [
        {
          index: 0,
          type: 'ADDRESS',
          address: `"${MAINNET_ADDR}"`,
          amountVar: 'out_amt',
        },
      ],
      calc: [
        { variable: 'out_amt', expression: '50000 - 1000' },
        { variable: 'fees', expression: '1000' },
      ],
      asserts: [],
    };

    const bp: BoundParams = {
      WF_SWAP_1_1_1: {
        type: 'UTXO',
        rawValue: `${TXID}:1`,
        resolved: {
          txid: TXID,
          vout: 1,
          value: Number(WITNESS_VALUE),
          scriptPubKey: SCRIPT_HEX,
          scriptType: 'P2WPKH',
        },
      },
    };

    const r = await runCheckerPipeline(psbt.toBase64(), minimalDoc(schema), schema, bp, {
      steps: {
        SWAP_1: {
          txid: TXID,
          outputs: [{ index: 1, valueSats: String(WITNESS_VALUE), scriptPubKey: SCRIPT_HEX }],
        },
      },
    });
    expect(r.success).toBe(true);
    expect(r.authorized).toBe(true);
  });
});
