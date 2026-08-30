/**
 * Maker PSBT construction (same path as Card 3 Run).
 */

import {
  BTSLDocument,
  BoundParams,
  WorkflowContext,
  toPayloadHex,
} from './types';
import {
  buildConsts,
  collectInputValues,
  runCalcBlock,
  evaluateAsserts,
  checkImplicitBalance,
  checkDustOutputs,
  logWeightWarning,
  computeOutputAmounts,
} from './runtime-expr';
import { unsignedTxFromPsbt } from './workflow-utxo';
import { compileScriptAsmToHex } from './script-compiler';
import {
  buildOutputScriptsForPreciseVsize,
  computePreciseTxMetrics,
  resolveBoundParamAddress,
} from './precise-weight';
import { detectTestnetFromBoundParams } from './network-detect';
import { buildOpReturnScript } from './op-return-script';
import { buildScriptOutputPkScript } from './script-output-pk';

export interface BuildPsbtResult {
  success: boolean;
  psbtBase64?: string;
  psbtHex?: string;
  summary?: {
    inputs: Array<{ index: number; value: string }>;
    outputs: Array<{ index: number; value: string; scriptPubKey?: string }>;
    fees: string;
    vsize: number;
    predictedTxid?: string;
  };
  error?: {
    code: string;
    message: string;
  };
  logs: string[];
}

export async function buildSchemaPsbt(
  document: BTSLDocument,
  boundParams: BoundParams,
  workflowContext: WorkflowContext,
  schemaIndex: number,
  logs: string[]
): Promise<BuildPsbtResult> {
  const schema = document.schemas[schemaIndex];
  if (!schema) {
    throw new Error('BTSL_ERR_00: No schema found');
  }

  logs.push('[BTSL] ========================================');
  logs.push('[BTSL] Starting BTSL PSBT Construction');
  logs.push(`[BTSL] Schema: ${schema.name}`);
  logs.push('[BTSL] ========================================');

  const constsMapForWeight: Record<string, number | string> = {};
  for (const c of document.consts) {
    constsMapForWeight[c.name] = c.value;
  }
  for (const c of schema.consts ?? []) {
    constsMapForWeight[c.name] = c.value;
  }
  const getBoundAddress = (paramKey: string): string | undefined =>
    resolveBoundParamAddress(boundParams, paramKey);

  const bitcoin = await import('bitcoinjs-lib');
  const ecc = await import('tiny-secp256k1');
  bitcoin.initEccLib(ecc);
  const isTestnet = detectTestnetFromBoundParams(boundParams);
  const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  logs.push(`[BTSL] Network detected: ${isTestnet ? 'TESTNET' : 'MAINNET'}`);

  const outputScripts = buildOutputScriptsForPreciseVsize(
    schema,
    constsMapForWeight,
    getBoundAddress,
    network,
    boundParams,
    document
  );
  const { vsize, weight: txWeightWu } = computePreciseTxMetrics(
    schema.inputs,
    outputScripts,
    document,
    boundParams
  );
  logs.push(`[BTSL] Precise vsize (BIP-141 template tx): ${vsize} vB, weight ${txWeightWu} wu`);

  const inputValues = collectInputValues(schema, boundParams);
  const sumInputs = inputValues.reduce((a, b) => a + b, BigInt(0));
  for (const input of schema.inputs) {
    const paramName = input.utxoRef.replace(/^@/, '');
    const param = boundParams[paramName];
    if (param?.resolved && typeof param.resolved === 'object' && 'value' in param.resolved) {
      const r = param.resolved as { txid: string; vout: number; value: number };
      logs.push(`[BTSL] Input ${input.index}: ${r.txid}:${r.vout} - ${r.value} sats`);
    }
  }
  logs.push(`[BTSL] Sum of inputs: ${sumInputs} sats`);

  logs.push('[BTSL] ----------------------------------------');
  logs.push('[BTSL] Phase 3 — Executing calc block');

  const logSink = { push: (s: string) => logs.push(s) };
  const consts = buildConsts(document, schema);

  let calcVars: Record<string, bigint>;
  try {
    calcVars = runCalcBlock(schema, document, boundParams, workflowContext, vsize, inputValues, {
      logs: logSink,
    });
  } catch (e) {
    logs.push(`[BTSL] calc error: ${e}`);
    throw e;
  }

  logs.push('[BTSL] ----------------------------------------');
  logs.push('[BTSL] Phase 4 — Building outputs');
  const outputValues = computeOutputAmounts(schema, consts, boundParams, calcVars);
  for (let oi = 0; oi < schema.outputs.length; oi++) {
    const output = schema.outputs[oi];
    const amt = outputValues[oi] ?? BigInt(0);
    const addrDisplay = output.address || output.type;
    logs.push(`[BTSL] Output ${output.index}: ${addrDisplay} - ${amt} sats`);
  }

  logs.push('[BTSL] ----------------------------------------');
  logs.push('[BTSL] Phase 5 — Validation (pre-PSBT)');

  const totalInputs = inputValues.reduce((a, b) => a + b, BigInt(0));
  const totalOutputs = outputValues.reduce((a, b) => a + b, BigInt(0));
  logs.push(`[BTSL] Total inputs: ${totalInputs} sats`);
  logs.push(`[BTSL] Total outputs: ${totalOutputs} sats`);

  if (!('fees' in calcVars) && totalOutputs > totalInputs) {
    throw new Error('BTSL_ERR_06: Outputs exceed inputs (no `fees` in calc for implicit balance)');
  }

  try {
    evaluateAsserts(schema, document, boundParams, workflowContext, vsize, inputValues, calcVars, {
      logs: logSink,
    });
  } catch (e) {
    throw e;
  }

  try {
    checkImplicitBalance(totalInputs, totalOutputs, calcVars, logSink);
  } catch (e) {
    throw e;
  }

  const dustLimit =
    typeof consts.DUST_LIMIT === 'bigint' ? consts.DUST_LIMIT : BigInt(Number(consts.DUST_LIMIT));
  try {
    checkDustOutputs(schema, outputValues, dustLimit, logSink);
  } catch (e) {
    throw e;
  }

  logWeightWarning(txWeightWu, logSink);

  const implicitFees = totalInputs - totalOutputs;

  logs.push('[BTSL] ========================================');
  logs.push('[BTSL] All audits passed');
  logs.push('[BTSL] Status: UNSIGNED — Ready for signing');
  logs.push('[BTSL] ========================================');

  // Build actual PSBT using bitcoinjs-lib (same as generated code — Psbt + witnessScript)
  logs.push('[BTSL] Building PSBT (bitcoinjs-lib)...');

  const { Buffer } = await import('buffer');

  const psbt = new bitcoin.Psbt({ network });

  // Add inputs (hash = txid in internal byte order for bitcoinjs-lib)
  for (const input of schema.inputs) {
    const paramName = input.utxoRef.replace(/^@/, '').replace(/\.[a-z]+$/, '');
    const param = boundParams[paramName];
    if (!param?.resolved || typeof param.resolved !== 'object' || !('txid' in param.resolved)) continue;

    const utxo = param.resolved as { txid: string; vout: number; value: number; scriptPubKey?: string };
    let scriptPubKeyHex = utxo.scriptPubKey;
    if (!scriptPubKeyHex && param.rawValue) {
      try {
        const addr = String(param.rawValue);
        const scriptBuf = bitcoin.address.toOutputScript(addr, network);
        scriptPubKeyHex = Buffer.from(scriptBuf).toString('hex');
      } catch (e) {
        logs.push(`[BTSL] Warning: Could not get scriptPubKey for input ${utxo.txid}:${utxo.vout}: ${e}`);
      }
    }
    if (!scriptPubKeyHex) {
      throw new Error('BTSL_ERR_04b: Missing scriptPubKey for input ' + utxo.txid + ':' + utxo.vout);
    }

    const hash = Buffer.from(utxo.txid, 'hex').reverse();
    const scriptBuf = Buffer.from(scriptPubKeyHex, 'hex');
    const inputDesc: {
      hash: Buffer;
      index: number;
      witnessUtxo: { script: Uint8Array; value: bigint };
      witnessScript?: Uint8Array;
    } = {
      hash,
      index: utxo.vout,
      witnessUtxo: {
        script: new Uint8Array(scriptBuf),
        value: BigInt(utxo.value),
      },
    };

    if (input.type === 'UNLOCK_P2WSH' && input.scriptDef) {
      const scriptDef = document.scriptDefs.find((d) => d.name === input.scriptDef);
      if (scriptDef) {
        try {
          const witnessScriptHex = compileScriptAsmToHex(scriptDef, boundParams, input.scriptParams);
          inputDesc.witnessScript = new Uint8Array(Buffer.from(witnessScriptHex, 'hex'));
          logs.push(`[BTSL] Added witnessScript for input (${input.scriptDef})`);
        } catch (e) {
          logs.push(`[BTSL] Warning: Could not compile witness script ${input.scriptDef}: ${e}`);
        }
      }
    }

    psbt.addInput(inputDesc);
    logs.push(`[BTSL] Added input: ${utxo.txid}:${utxo.vout}`);
  }
  
  // Add outputs (value in sats, same as generated buildOutput)
  for (let i = 0; i < schema.outputs.length; i++) {
    const output = schema.outputs[i];
    const amount = outputValues[i];

    if (output.type === 'OP_RETURN') {
      const raw = (output.payload ?? '').trim();
      let payloadHex: string;
      if (raw.startsWith('@')) {
        const paramName = raw.replace(/^@/, '').trim();
        const param = boundParams[paramName];
        const value = String(param?.rawValue ?? (typeof param?.resolved === 'string' ? param.resolved : '') ?? '');
        payloadHex = toPayloadHex(value, Boolean(param?.payloadAsText));
      } else if (raw.startsWith('"') && raw.endsWith('"')) {
        payloadHex = toPayloadHex(raw.slice(1, -1).replace(/\\"/g, '"'), true);
      } else {
        payloadHex = toPayloadHex(raw, false);
      }
      const payloadBytes = Buffer.from(payloadHex, 'hex');
      if (payloadBytes.length > 80) {
        logs.push('[BTSL] BTSL_WARN_04: OP_RETURN payload exceeds 80 bytes');
      }
      const opReturnScript = buildOpReturnScript(payloadBytes);
      psbt.addOutput({ script: opReturnScript, value: BigInt(0) });
      logs.push('[BTSL] Added OP_RETURN output');
    } else if (output.type === 'SCRIPT' && output.scriptDef) {
      const scriptPk = buildScriptOutputPkScript(document, output, boundParams, network);
      if (scriptPk && amount > BigInt(0)) {
        psbt.addOutput({ script: scriptPk, value: amount });
        logs.push(`[BTSL] Added output ${i}: SCRIPT ${output.scriptDef} - ${amount} sats`);
      } else if (amount > BigInt(0)) {
        logs.push(`[BTSL] Warning: Output ${i} SCRIPT ${output.scriptDef} — could not build scriptPubKey`);
      }
    } else {
      let address: string | undefined;
      if (output.address?.startsWith('@')) {
        const paramName = output.address.replace(/^@/, '').replace(/\.[a-z]+$/, '');
        const param = boundParams[paramName];
        if (typeof param?.resolved === 'string') address = param.resolved;
        else if (param?.resolved && typeof param.resolved === 'object' && 'address' in param.resolved) {
          address = (param.resolved as { address: string }).address;
        } else if (typeof param?.rawValue === 'string') address = param.rawValue;
      } else if (output.address && consts[output.address] !== undefined && typeof consts[output.address] === 'string') {
        address = consts[output.address] as string;
      } else if (output.address?.includes('.')) {
        const ref = output.address.replace(/\.[a-z]+$/, '');
        const param = boundParams[ref];
        if (param?.resolved && typeof param.resolved === 'object' && 'address' in param.resolved) {
          address = (param.resolved as { address: string }).address;
        }
      } else if (output.address?.startsWith('"')) {
        address = output.address.replace(/^"|"$/g, '');
      }
      if (address && amount > BigInt(0)) {
        psbt.addOutput({ address, value: amount });
        logs.push(`[BTSL] Added output ${i}: ${address.slice(0, 20)}... - ${amount} sats`);
      } else if (amount > BigInt(0)) {
        logs.push(`[BTSL] Warning: Output ${i} has amount ${amount} but no address`);
      }
    }
  }

  const psbtBase64 = psbt.toBase64();
  const psbtHex = psbt.toHex();
  logs.push('[BTSL] PSBT created successfully (bitcoinjs-lib)');

  const unsigned = unsignedTxFromPsbt(psbt);
  if (unsigned) {
    logs.push(`[BTSL] Predicted txid (unsigned): ${unsigned.txid}`);
  }

  return {
    success: true,
    psbtBase64,
    psbtHex,
    summary: {
      inputs: inputValues.map((v, i) => ({ index: i, value: v.toString() })),
      outputs: outputValues.map((v, i) => ({
        index: i,
        value: v.toString(),
        scriptPubKey:
          unsigned?.outputs[i]?.scriptPubKey ??
          (outputScripts[i] ? Buffer.from(outputScripts[i]).toString('hex') : undefined),
      })),
      fees: implicitFees.toString(),
      vsize,
      predictedTxid: unsigned?.txid,
    },
    logs
  };
}

