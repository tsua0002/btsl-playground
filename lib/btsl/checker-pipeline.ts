/**
 * BTSL Checker (Verifier) pipeline — spec §9.3.1 (phases: parse → shape → field-level → algebraic).
 * Implementation guide Part 2 §2.2.x. Normative baseline: BTSL v1.0.0 (§9.3.1).
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
import {
  getPsbtInputSpkHex,
  checkInputI1,
  checkInputI2Workflow,
  checkInputI2CaseA,
  checkInputI4,
  checkOutputsO1,
} from './checker-predicates';
import { detectTestnetFromBoundParams } from './network-detect';

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
  throw new Error('BTSL_ERR_00: PSBT input has neither witnessUtxo nor nonWitnessUtxo');
}

function getPrevoutId(psbt: bitcoin.Psbt, index: number): { txid: string; vout: number } {
  const ti = psbt.txInputs[index];
  const txid = Buffer.from(ti.hash).reverse().toString('hex');
  return { txid, vout: ti.index };
}

/**
 * Run Checker validation: §9.3.1 phase order — shape (S-1/S-2) → field-level (I-*, O-1) → algebraic (calc, O-2, ASSERT, A-3…).
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

    const isTestnet = detectTestnetFromBoundParams(boundParams);
    const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

    logs.push('[checker] ========================================');
    logs.push(`[checker] Checker pipeline — schema: ${schema.name} (§9.3.1)`);
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

    /* Phase shape — S-1 / S-2 (fast-fail) → BTSL_ERR_13 */
    if (psbt.inputCount !== schema.inputs.length) {
      return fail(
        'BTSL_ERR_13',
        `SCHEMA_MISMATCH (S-1): PSBT has ${psbt.inputCount} inputs, schema expects ${schema.inputs.length}`
      );
    }
    const outLen = psbt.txOutputs.length;
    if (outLen !== schema.outputs.length) {
      return fail(
        'BTSL_ERR_13',
        `SCHEMA_MISMATCH (S-2): PSBT has ${outLen} outputs, schema expects ${schema.outputs.length}`
      );
    }

    logs.push('[checker] Phase shape — S-1/S-2 OK');

    const chainByParam = new Map<string, bigint>();
    const certifiedInputValues: bigint[] = [];

    for (let i = 0; i < psbt.inputCount; i++) {
      const inputDef = schema.inputs[i];
      const { txid, vout } = getPrevoutId(psbt, i);

      const wfErr = checkInputI2Workflow(inputDef, txid, vout, workflowContext);
      if (wfErr) {
        return fail(wfErr.code, wfErr.message);
      }

      const paramKey = inputDef.utxoRef.replace(/^@/, '');
      const i2a = checkInputI2CaseA(inputDef, txid, vout, paramKey, boundParams);
      if (i2a) {
        return fail(i2a.code, i2a.message);
      }

      let psbtSpkHex: string;
      try {
        psbtSpkHex = getPsbtInputSpkHex(psbt, i, bitcoin.Transaction);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return fail('BTSL_ERR_00', msg.replace(/^BTSL_ERR_00:\s*/, '') || msg);
      }

      let psbtVal: bigint;
      try {
        psbtVal = getPsbtInputDeclaredValue(psbt, i, bitcoin.Transaction);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return fail('BTSL_ERR_00', msg.replace(/^BTSL_ERR_00:\s*/, '') || msg);
      }

      logs.push(`[checker] Field-level — fetch chain UTXO ${txid}:${vout} (I-3)`);
      const chainUtxo = await fetchUTXO(txid, vout);
      const chainVal = BigInt(chainUtxo.value);

      const i1 = checkInputI1(inputDef, chainUtxo, psbtSpkHex, document, boundParams, network);
      if (i1) {
        return fail(i1.code, i1.message);
      }

      if (psbtVal !== chainVal) {
        return fail(
          'BTSL_ERR_11',
          `PREVOUT_VALUE_MISMATCH (I-3): PSBT input value ${psbtVal} ≠ chain value ${chainVal} for ${txid}:${vout}`
        );
      }

      const i4 = checkInputI4(inputDef, psbt.txInputs[i].sequence);
      if (i4) {
        return fail(i4.code, i4.message);
      }

      certifiedInputValues.push(chainVal);
      chainByParam.set(paramKey, chainVal);
      logs.push(`[checker] Input ${i}: I-1/I-3/I-4 OK — chain value ${chainVal} sats`);
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
      `[checker] vSize from PSBT + schema witness template: ${vsize} vB (${txWeightWu} wu)`
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

    logs.push('[checker] Algebraic — replay calc (A-1, chain-certified inputs)');
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

    const o1 = checkOutputsO1(psbt, schema, document, boundParams, network);
    if (o1) {
      return fail(o1.code, o1.message);
    }
    logs.push('[checker] Field-level — O-1 output scriptPubKey OK');

    logs.push('[checker] Field-level — O-2 output amounts vs calc');
    for (let i = 0; i < outLen; i++) {
      const actual = psbt.txOutputs[i].value;
      const expected = expectedOutputAmounts[i];
      if (actual !== expected) {
        return fail(
          'BTSL_ERR_06',
          `Output ${i} amount mismatch (O-2) — PSBT has ${actual}, expected ${expected} from schema/calc`
        );
      }
      logs.push(`[checker] Output ${i}: ${actual} sats OK (O-2)`);
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
    logs.push('[checker] All Checker predicates passed — signing authorized (logical)');
    logs.push('[checker] ========================================');

    return { success: true, authorized: true, logs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.match(/BTSL_ERR_[0-9]+[a-z]?/)?.[0] ?? 'BTSL_ERR_00';
    logs.push(`[checker] [ERROR] ${msg}`);
    return { success: false, authorized: false, error: { code, message: msg }, logs };
  }
}
