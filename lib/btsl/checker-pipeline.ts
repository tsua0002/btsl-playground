/**
 * BTSL Checker (Verifier) pipeline — spec §9.3, implementation guide Part 2 §2.1–2.4.
 */

import type * as bitcoin from 'bitcoinjs-lib';
import type { BTSLDocument, BTSLSchema, BoundParams, WorkflowContext } from './types';
import { fetchUTXO } from './api';
import {
  buildConsts,
  runCalcBlock,
  evaluateAsserts,
  checkImplicitBalance,
  checkDustOutputs,
  logWeightWarning,
  computeOutputAmounts,
} from './runtime-expr';
import { computePreciseTxMetricsFromPsbt } from './precise-weight';
import { boundParamsWithPsbtImpliedFeerate } from './schema-feerate';

export interface CheckerResult {
  success: boolean;
  authorized: boolean;
  error?: { code: string; message: string };
  logs: string[];
}

function createLogCollector(): { logs: string[]; sink: { push: (s: string) => void } } {
  const logs: string[] = [];
  return { logs, sink: { push: (s: string) => logs.push(s) } };
}

function detectTestnet(boundParams: BoundParams): boolean {
  for (const param of Object.values(boundParams)) {
    if (param?.rawValue) {
      const addr = String(param.rawValue);
      if (addr.startsWith('tb1') || addr.startsWith('m') || addr.startsWith('n') || addr.startsWith('2')) {
        return true;
      }
    }
    if (param?.resolved && typeof param.resolved === 'object' && 'address' in param.resolved) {
      const addr = String((param.resolved as { address?: string }).address || '');
      if (addr.startsWith('tb1') || addr.startsWith('m') || addr.startsWith('n') || addr.startsWith('2')) {
        return true;
      }
    }
  }
  return false;
}

function getPsbtInputDeclaredValue(
  psbt: bitcoin.Psbt,
  index: number,
  Transaction: { fromBuffer: (buf: Buffer) => { outs: Array<{ value: bigint }> } }
): bigint {
  const inp = psbt.data.inputs[index];
  if (inp.witnessUtxo) {
    return inp.witnessUtxo.value;
  }
  if (inp.nonWitnessUtxo) {
    const raw = Buffer.from(inp.nonWitnessUtxo as unknown as Uint8Array);
    const prevTx = Transaction.fromBuffer(raw);
    const vout = psbt.txInputs[index].index;
    return prevTx.outs[vout].value;
  }
  throw new Error('BTSL_ERR_01: PSBT input has neither witnessUtxo nor nonWitnessUtxo');
}

function getPrevoutId(psbt: bitcoin.Psbt, index: number): { txid: string; vout: number } {
  const ti = psbt.txInputs[index];
  const txid = Buffer.from(ti.hash).reverse().toString('hex');
  return { txid, vout: ti.index };
}

/**
 * Run Checker validation: decode PSBT, zero-trust UTXO restore, calc replay, output cross-check, ASSERT, balance, dust, weight.
 */
export async function runCheckerPipeline(
  psbtBase64OrHex: string,
  document: BTSLDocument,
  schema: BTSLSchema,
  boundParams: BoundParams,
  workflowContext: WorkflowContext
): Promise<CheckerResult> {
  const { logs, sink } = createLogCollector();

  const fail = (code: string, message: string): CheckerResult => ({
    success: false,
    authorized: false,
    error: { code, message },
    logs,
  });

  try {
    const bitcoin = await import('bitcoinjs-lib');
    const ecc = await import('tiny-secp256k1');
    bitcoin.initEccLib(ecc);

    const isTestnet = detectTestnet(boundParams);
    const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

    logs.push('[checker] ========================================');
    logs.push(`[checker] Checker pipeline — schema: ${schema.name}`);
    logs.push('[checker] ========================================');

    const trimmed = psbtBase64OrHex.trim();
    let psbt: bitcoin.Psbt;
    try {
      psbt = bitcoin.Psbt.fromBase64(trimmed, { network });
    } catch {
      try {
        psbt = bitcoin.Psbt.fromHex(trimmed, { network });
      } catch (e) {
        return fail(
          'BTSL_ERR_00',
          `Failed to decode PSBT as base64 or hex: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    if (psbt.inputCount !== schema.inputs.length) {
      return fail(
        'BTSL_ERR_00',
        `Input count mismatch — PSBT has ${psbt.inputCount}, schema expects ${schema.inputs.length}`
      );
    }
    const outLen = psbt.txOutputs.length;
    if (outLen !== schema.outputs.length) {
      return fail(
        'BTSL_ERR_00',
        `Output count mismatch — PSBT has ${outLen}, schema expects ${schema.outputs.length}`
      );
    }

    logs.push('[checker] Step 2.1 — PSBT decoded, structure OK');

    const chainByParam = new Map<string, bigint>();
    const certifiedInputValues: bigint[] = [];

    for (let i = 0; i < psbt.inputCount; i++) {
      const { txid, vout } = getPrevoutId(psbt, i);
      const psbtVal = getPsbtInputDeclaredValue(psbt, i, bitcoin.Transaction);

      logs.push(`[checker] Step 2.2 — Fetch chain UTXO ${txid}:${vout}`);
      const chainUtxo = await fetchUTXO(txid, vout);
      const chainVal = BigInt(chainUtxo.value);

      if (psbtVal !== chainVal) {
        return fail(
          'BTSL_ERR_01',
          `PSBT input value ${psbtVal} does not match blockchain value ${chainVal} for ${txid}:${vout}`
        );
      }

      certifiedInputValues.push(chainVal);

      const paramName = schema.inputs[i].utxoRef.replace(/^@/, '');
      chainByParam.set(paramName, chainVal);
      logs.push(`[checker] Input ${i}: chain value ${chainVal} sats — PSBT value matches`);
    }

    const getUtxoAmount = (paramName: string): bigint => {
      const c = chainByParam.get(paramName);
      if (c !== undefined) return c;
      const param = boundParams[paramName];
      if (param?.resolved && typeof param.resolved === 'object' && 'value' in param.resolved) {
        return BigInt((param.resolved as { value: number }).value);
      }
      return BigInt(0);
    };

    const { vsize, weight: txWeightWu } = computePreciseTxMetricsFromPsbt(
      psbt,
      schema,
      document,
      boundParams
    );
    logs.push(
      `[checker] Step 2.2b — Replay vsize from PSBT outputs + schema witness template: ${vsize} vB (${txWeightWu} wu)`
    );

    const sumInputsForFee = certifiedInputValues.reduce((a, b) => a + b, BigInt(0));
    const sumPsbtOutForFee = [...Array(outLen)]
      .map((_, i) => psbt.txOutputs[i].value)
      .reduce((a, b) => a + b, BigInt(0));
    const implicitFeeFromPsbt = sumInputsForFee - sumPsbtOutForFee;

    const boundForCalc = boundParamsWithPsbtImpliedFeerate(
      schema,
      boundParams,
      vsize,
      implicitFeeFromPsbt,
      (s) => logs.push(s)
    );

    logs.push(`[checker] Step 2.3 — Replay calc (chain-certified inputs)`);
    const calcVars = runCalcBlock(schema, document, boundForCalc, workflowContext, vsize, certifiedInputValues, {
      getUtxoAmount,
      logs: sink,
    });

    const expectedOutputAmounts = computeOutputAmounts(
      schema,
      buildConsts(document, schema),
      boundForCalc,
      calcVars
    );

    logs.push('[checker] Step 2.4 — Cross-check PSBT output amounts vs schema/calc');
    for (let i = 0; i < outLen; i++) {
      const actual = psbt.txOutputs[i].value;
      const expected = expectedOutputAmounts[i];
      if (actual !== expected) {
        return fail(
          'BTSL_ERR_06',
          `Output ${i} amount mismatch — PSBT has ${actual}, expected ${expected} from schema/calc`
        );
      }
      logs.push(`[checker] Output ${i}: ${actual} sats OK`);
    }

    evaluateAsserts(schema, document, boundForCalc, workflowContext, vsize, certifiedInputValues, calcVars, {
      getUtxoAmount,
      logs: sink,
    });

    const sumInputs = certifiedInputValues.reduce((a, b) => a + b, BigInt(0));
    const sumPsbtOutputs = [...Array(outLen)]
      .map((_, i) => psbt.txOutputs[i].value)
      .reduce((a, b) => a + b, BigInt(0));

    try {
      checkImplicitBalance(sumInputs, sumPsbtOutputs, calcVars, sink);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('BTSL_ERR')) {
        return fail('BTSL_ERR_06', e.message.replace(/^BTSL_ERR_\d+:?\s*/, '') || e.message);
      }
      throw e;
    }

    const consts = buildConsts(document, schema);
    const dustLimit =
      typeof consts.DUST_LIMIT === 'bigint'
        ? consts.DUST_LIMIT
        : BigInt(Number(consts.DUST_LIMIT));
    try {
      const psbtOutAmounts = [...Array(outLen)].map((_, i) => psbt.txOutputs[i].value);
      checkDustOutputs(schema, psbtOutAmounts, dustLimit, sink);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('BTSL_ERR_07')) {
        return fail('BTSL_ERR_07', e.message);
      }
      throw e;
    }

    logWeightWarning(txWeightWu, sink);

    logs.push('[checker] ========================================');
    logs.push('[checker] All Checker steps passed — signing authorized (logical)');
    logs.push('[checker] ========================================');

    return { success: true, authorized: true, logs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.match(/BTSL_ERR_[0-9]+[a-z]?/)?.[0] ?? 'BTSL_ERR_00';
    logs.push(`[checker] [ERROR] ${msg}`);
    return { success: false, authorized: false, error: { code, message: msg }, logs };
  }
}
