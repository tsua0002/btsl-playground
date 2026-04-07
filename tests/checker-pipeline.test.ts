import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
bitcoin.initEccLib(ecc);
import { runCheckerPipeline } from '@/lib/btsl/checker-pipeline';
import { checkOutputsO1 } from '@/lib/btsl/checker-predicates';
import { detectTestnetFromBoundParams } from '@/lib/btsl/network-detect';
import type { BTSLDocument, BTSLSchema, BoundParams } from '@/lib/btsl/types';
import * as api from '@/lib/btsl/api';

vi.mock('@/lib/btsl/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/btsl/api')>();
  return {
    ...actual,
    fetchUTXO: vi.fn(),
  };
});

const TXID = 'a'.repeat(64);
const SCRIPT_HEX = '0014' + '11'.repeat(20);
const WITNESS_VALUE = BigInt(50_000);
const OUT_VALUE = BigInt(49_000);

function minimalDoc(schema: BTSLSchema): BTSLDocument {
  return { version: 1, consts: [], scriptDefs: [], schemas: [schema] };
}

function buildPsbt(witnessValue: bigint, outputValue: bigint): string {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.addInput({
    hash: Buffer.from(TXID, 'hex').reverse(),
    index: 0,
    witnessUtxo: {
      script: Buffer.from(SCRIPT_HEX, 'hex'),
      value: witnessValue,
    },
  });
  psbt.addOutput({
    script: Buffer.from(SCRIPT_HEX, 'hex'),
    value: outputValue,
  });
  return psbt.toBase64();
}

function boundParams(): BoundParams {
  return {
    U: {
      type: 'UTXO',
      rawValue: `${TXID}:0`,
      resolved: {
        txid: TXID,
        vout: 0,
        value: Number(WITNESS_VALUE),
        scriptPubKey: SCRIPT_HEX,
        scriptType: 'P2WPKH',
      },
    },
  };
}

const schema: BTSLSchema = {
  name: 'CHK',
  params: [],
  inputs: [{ index: 0, utxoRef: '@U', type: 'NATIVE_P2WPKH' }],
  outputs: [
    {
      index: 0,
      type: 'ADDRESS',
      address: '"bc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3h8ffkz"',
      amount: undefined,
      amountVar: 'out_amt',
    },
  ],
  calc: [
    { variable: 'out_amt', expression: '50000 - 1000' },
    { variable: 'fees', expression: '1000' },
  ],
  asserts: [],
};

describe('runCheckerPipeline', () => {
  const fetchMock = vi.mocked(api.fetchUTXO);

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      txid: TXID,
      vout: 0,
      value: Number(WITNESS_VALUE),
      scriptPubKey: SCRIPT_HEX,
      scriptType: 'P2WPKH',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes when PSBT matches chain and schema', async () => {
    const psbtB64 = buildPsbt(WITNESS_VALUE, OUT_VALUE);
    const r = await runCheckerPipeline(
      psbtB64,
      minimalDoc(schema),
      schema,
      boundParams(),
      { steps: {} }
    );
    expect(r.success).toBe(true);
    expect(r.authorized).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(TXID, 0);
  });

  it('fails BTSL_ERR_01 when PSBT input value lies vs chain', async () => {
    fetchMock.mockResolvedValue({
      txid: TXID,
      vout: 0,
      value: 40_000,
      scriptPubKey: SCRIPT_HEX,
      scriptType: 'P2WPKH',
    });
    const psbtB64 = buildPsbt(WITNESS_VALUE, OUT_VALUE);
    const r = await runCheckerPipeline(
      psbtB64,
      minimalDoc(schema),
      schema,
      boundParams(),
      { steps: {} }
    );
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('BTSL_ERR_11');
  });

  it('fails BTSL_ERR_06 on output amount mismatch', async () => {
    const psbtB64 = buildPsbt(WITNESS_VALUE, BigInt(40_000));
    const r = await runCheckerPipeline(
      psbtB64,
      minimalDoc(schema),
      schema,
      boundParams(),
      { steps: {} }
    );
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('BTSL_ERR_06');
  });

  it('fails BTSL_ERR_13 on input count mismatch (S-1)', async () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    psbt.addInput({
      hash: Buffer.from(TXID, 'hex').reverse(),
      index: 0,
      witnessUtxo: { script: Buffer.from(SCRIPT_HEX, 'hex'), value: WITNESS_VALUE },
    });
    psbt.addInput({
      hash: Buffer.from(TXID, 'hex').reverse(),
      index: 1,
      witnessUtxo: { script: Buffer.from(SCRIPT_HEX, 'hex'), value: WITNESS_VALUE },
    });
    psbt.addOutput({ script: Buffer.from(SCRIPT_HEX, 'hex'), value: OUT_VALUE });
    const r = await runCheckerPipeline(
      psbt.toBase64(),
      minimalDoc(schema),
      schema,
      boundParams(),
      { steps: {} }
    );
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('BTSL_ERR_13');
  });

  it('fails BTSL_ERR_12 when PSBT prevout does not match bound UTXO (I-2 Case A)', async () => {
    const psbtB64 = buildPsbt(WITNESS_VALUE, OUT_VALUE);
    const wrongTxid = 'b'.repeat(64);
    const bp = boundParams();
    bp.U = {
      ...bp.U,
      resolved: {
        ...(bp.U.resolved as object),
        txid: wrongTxid,
        vout: 0,
      } as import('@/lib/btsl/types').ResolvedUTXO,
    };
    const r = await runCheckerPipeline(
      psbtB64,
      minimalDoc(schema),
      schema,
      bp,
      { steps: {} }
    );
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('BTSL_ERR_12');
  });

  it('fails BTSL_ERR_06 when implicit balance breaks (fees)', async () => {
    const badSchema: BTSLSchema = {
      ...schema,
      calc: [
        { variable: 'out_amt', expression: '50000 - 1000' },
        { variable: 'fees', expression: '500' },
      ],
    };
    const psbtB64 = buildPsbt(WITNESS_VALUE, OUT_VALUE);
    const r = await runCheckerPipeline(
      psbtB64,
      minimalDoc(badSchema),
      badSchema,
      boundParams(),
      { steps: {} }
    );
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('BTSL_ERR_06');
  });
});

describe('detectTestnetFromBoundParams', () => {
  it('does not treat SATOSHI values starting with 2 (e.g. @MEAN=2300) as testnet', () => {
    const bp: BoundParams = {
      MEAN: { type: 'SATOSHI', rawValue: '2300', resolved: 2300 },
      A3: { type: 'SATOSHI', rawValue: '2100', resolved: 2100 },
    };
    expect(detectTestnetFromBoundParams(bp)).toBe(false);
  });

  it('returns true for a valid testnet ADDRESS param', () => {
    const bp: BoundParams = {
      DEST: { type: 'ADDRESS', rawValue: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', resolved: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' },
    };
    expect(detectTestnetFromBoundParams(bp)).toBe(true);
  });
});

describe('checkOutputsO1 ADDRESS @param binding', () => {
  /** Valid mainnet bech32 (bitcoinjs-lib test vector style). */
  const MAINNET_ADDR = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

  it('passes when resolved is a plain string (matches UI / Maker PSBT path)', () => {
    const paySchema: BTSLSchema = {
      name: 'pay',
      params: [],
      inputs: [],
      outputs: [
        {
          index: 0,
          type: 'ADDRESS',
          address: '@ALICE',
          amount: 10_000,
        },
      ],
      calc: [],
      asserts: [],
    };
    const doc = minimalDoc(paySchema);
    const spk = Buffer.from(
      bitcoin.address.toOutputScript(MAINNET_ADDR, bitcoin.networks.bitcoin)
    );
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    psbt.addOutput({ script: spk, value: BigInt(10_000) });

    const bp: BoundParams = {
      ALICE: {
        type: 'ADDRESS',
        rawValue: MAINNET_ADDR,
        resolved: MAINNET_ADDR,
      },
    };

    expect(checkOutputsO1(psbt, paySchema, doc, bp, bitcoin.networks.bitcoin)).toBe(null);
  });
});
