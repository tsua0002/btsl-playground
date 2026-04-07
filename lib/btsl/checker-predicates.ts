/**
 * Checker field-level predicates (spec §9.3.1 — I-1, I-2, I-4, O-1 helpers).
 * Orchestration and phase order live in checker-pipeline.ts.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import type * as bitcoinType from 'bitcoinjs-lib';
import type { BTSLDocument, BTSLInput, BTSLSchema, BoundParams, ResolvedUTXO, WorkflowContext } from './types';
import { detectScriptTypeFromSpk } from './api';
import { compileScriptAsmToHex } from './script-compiler';
import { BTSL_NUMS_KEY_XONLY_HEX } from './script-output-pk';
import { buildOutputScriptsForPreciseVsize, resolveBoundParamAddress } from './precise-weight';

let eccInited = false;
function ensureEcc(): void {
  if (!eccInited) {
    bitcoin.initEccLib(ecc);
    eccInited = true;
  }
}

export function normSpkHex(hex: string): string {
  return hex.replace(/^0x/i, '').replace(/\s/g, '').toLowerCase();
}

/** Case-insensitive txid equality. */
export function txidEq(a: string, b: string): boolean {
  return a.replace(/^0x/i, '').toLowerCase() === b.replace(/^0x/i, '').toLowerCase();
}

function bufferToNormHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex').toLowerCase();
}

/** PSBT input prevout script as in witness_utxo or non_witness prevout. */
export function getPsbtInputSpkHex(
  psbt: bitcoinType.Psbt,
  index: number,
  Transaction: typeof bitcoin.Transaction
): string {
  const inp = psbt.data.inputs[index];
  if (inp.witnessUtxo) {
    return bufferToNormHex(inp.witnessUtxo.script);
  }
  if (inp.nonWitnessUtxo) {
    const raw = Buffer.from(inp.nonWitnessUtxo as unknown as Uint8Array);
    const prevTx = Transaction.fromBuffer(raw);
    const vout = psbt.txInputs[index].index;
    return bufferToNormHex(prevTx.outs[vout].script);
  }
  throw new Error('BTSL_ERR_00: PSBT input has neither witnessUtxo nor nonWitnessUtxo');
}

function resolveP2trInternalXOnly(internalKey: string | undefined): Buffer {
  if (!internalKey || internalKey === 'NUMS_KEY') {
    return Buffer.from(BTSL_NUMS_KEY_XONLY_HEX, 'hex');
  }
  const hex = internalKey.replace(/^0x/i, '').trim();
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error('BTSL_ERR_04c: P2TR internal_key must be NUMS_KEY or 32-byte x-only hex');
  }
  return buf;
}

/**
 * Expected scriptPubKey for UNLOCK inputs from SCRIPT_DEFS (I-1).
 */
export function buildExpectedUnlockScriptPubKey(
  document: BTSLDocument,
  input: BTSLInput,
  boundParams: BoundParams,
  network: bitcoin.Network
): Buffer | null {
  if (!input.scriptDef) return null;
  const def = document.scriptDefs.find((d) => d.name === input.scriptDef);
  if (!def) return null;
  ensureEcc();
  try {
    if (input.type === 'UNLOCK_P2WSH' && (def.type === 'P2WSH' || def.type === 'P2SH')) {
      const hexStr = compileScriptAsmToHex(def, boundParams, input.scriptParams);
      const ws = Buffer.from(hexStr, 'hex');
      const { output: p2wsh } = bitcoin.payments.p2wsh({ redeem: { output: ws }, network });
      return p2wsh ? Buffer.from(p2wsh) : null;
    }
    if (input.type === 'UNLOCK_P2TR_SCRIPT' && def.type === 'P2TR') {
      const pathName = input.scriptPath;
      const path = pathName ? def.paths?.find((p) => p.name === pathName) : def.paths?.[0];
      if (!path) return null;
      const leafDef = { name: def.name, type: 'P2WSH' as const, asm: path.asm };
      const leafHex = compileScriptAsmToHex(leafDef, boundParams, input.scriptParams);
      const leafBuf = Buffer.from(leafHex, 'hex');
      const internalPubkey = resolveP2trInternalXOnly(def.internalKey);
      const { output: p2trOut } = bitcoin.payments.p2tr({
        internalPubkey,
        scriptTree: { output: leafBuf, version: path.leafVersion },
        network,
      });
      return p2trOut ? Buffer.from(p2trOut) : null;
    }
  } catch {
    return null;
  }
  return null;
}

const NATIVE_EXPECTED: Record<string, ResolvedUTXO['scriptType'][]> = {
  NATIVE_P2WPKH: ['P2WPKH'],
  NATIVE_P2PKH: ['P2PKH'],
  NATIVE_P2TR_KEY: ['P2TR'],
};

/**
 * I-1: chain script type + script bytes vs schema; UNLOCK vs witnessScript commitment.
 * Returns { code, message } or null if OK.
 */
export function checkInputI1(
  input: BTSLInput,
  chainUtxo: ResolvedUTXO,
  psbtSpkHex: string,
  document: BTSLDocument,
  boundParams: BoundParams,
  network: bitcoin.Network
): { code: 'BTSL_ERR_01' | 'BTSL_ERR_02'; message: string } | null {
  const chainSpk = normSpkHex(chainUtxo.scriptPubKey);
  if (normSpkHex(psbtSpkHex) !== chainSpk) {
    return {
      code: 'BTSL_ERR_02',
      message: `Input ${input.index}: PSBT prevout scriptPubKey does not match chain for ${chainUtxo.txid}:${chainUtxo.vout}`,
    };
  }

  const st = detectScriptTypeFromSpk(chainUtxo.scriptPubKey);

  if (input.type === 'UNLOCK_P2WSH' || input.type === 'UNLOCK_P2TR_SCRIPT') {
    const expected = buildExpectedUnlockScriptPubKey(document, input, boundParams, network);
    if (!expected || expected.length === 0) {
      return {
        code: 'BTSL_ERR_02',
        message: `Input ${input.index}: could not derive expected scriptPubKey for UNLOCK (${input.scriptDef})`,
      };
    }
    if (normSpkHex(expected.toString('hex')) !== chainSpk) {
      return {
        code: 'BTSL_ERR_02',
        message: `Input ${input.index}: chain scriptPubKey does not match compiled UNLOCK script (I-1)`,
      };
    }
    return null;
  }

  const nativeType = input.type;
  if (nativeType && NATIVE_EXPECTED[nativeType]) {
    const allowed = NATIVE_EXPECTED[nativeType];
    if (!allowed.includes(st)) {
      return {
        code: 'BTSL_ERR_01',
        message: `Input ${input.index}: declared ${nativeType} but chain UTXO is ${st}`,
      };
    }
    return null;
  }

  if (st === 'UNKNOWN') {
    return {
      code: 'BTSL_ERR_01',
      message: `Input ${input.index}: unrecognized chain script type for prevout`,
    };
  }

  /* Parser may omit NATIVE on simple @UTXO lines — PSBT vs chain agreement suffices above. */
  if (!input.type) {
    return null;
  }

  return null;
}

/**
 * I-2 Case C: workflow parent txid must be known; PSBT must spend declared vout.
 */
export function checkInputI2Workflow(
  input: BTSLInput,
  psbtTxid: string,
  psbtVout: number,
  workflowContext: WorkflowContext
): { code: 'BTSL_ERR_05' | 'BTSL_ERR_12'; message: string } | null {
  const wf = input.workflowRef;
  if (!wf) return null;
  const step = workflowContext.steps[wf.schemaName];
  const parentTxid = step?.txid?.trim();
  if (!parentTxid) {
    return {
      code: 'BTSL_ERR_05',
      message: `Input ${input.index}: workflow parent schema ${wf.schemaName} has no broadcast txid (I-2 Case C)`,
    };
  }
  if (!txidEq(psbtTxid, parentTxid) || psbtVout !== wf.vout) {
    return {
      code: 'BTSL_ERR_12',
      message: `Input ${input.index}: PSBT prevout ${psbtTxid}:${psbtVout} does not match workflow parent ${parentTxid}:${wf.vout}`,
    };
  }
  return null;
}

/**
 * I-2 Case A: bound UTXO outpoint must match PSBT when params carry resolved txid/vout (§9.1.1).
 */
export function checkInputI2CaseA(
  input: BTSLInput,
  psbtTxid: string,
  psbtVout: number,
  paramKey: string,
  boundParams: BoundParams
): { code: 'BTSL_ERR_12'; message: string } | null {
  if (input.workflowRef) return null;
  const p = boundParams[paramKey];
  const r = p?.resolved;
  if (!r || typeof r !== 'object' || !('txid' in r)) return null;
  const u = r as ResolvedUTXO;
  if (!u.txid || typeof u.vout !== 'number') return null;
  if (!txidEq(u.txid, psbtTxid)) {
    return {
      code: 'BTSL_ERR_12',
      message: `Input ${input.index}: PSBT txid does not match bound UTXO for @${paramKey}`,
    };
  }
  if (u.vout !== psbtVout) {
    return {
      code: 'BTSL_ERR_12',
      message: `Input ${input.index}: PSBT vout does not match bound UTXO for @${paramKey}`,
    };
  }
  return null;
}

/**
 * I-4: schema sequence vs PSBT nSequence (BIP370 / §9.5).
 */
export function checkInputI4(
  input: BTSLInput,
  psbtSequence: number | undefined
): { code: 'BTSL_ERR_01'; message: string } | null {
  if (input.sequence === undefined) return null;
  const expected = input.sequence >>> 0;
  const actual = (psbtSequence ?? 0xffffffff) >>> 0;
  if (actual !== expected) {
    return {
      code: 'BTSL_ERR_01',
      message: `Input ${input.index}: nSequence ${actual} does not match schema sequence ${expected} (I-4)`,
    };
  }
  return null;
}

/**
 * O-1: each PSBT output script equals schema-derived script (same path as precise vsize).
 */
export function checkOutputsO1(
  psbt: bitcoinType.Psbt,
  schema: BTSLSchema,
  document: BTSLDocument,
  boundParams: BoundParams,
  network: bitcoin.Network
): { code: 'BTSL_ERR_02'; message: string } | null {
  const constsMap: Record<string, number | string> = {};
  for (const c of document.consts) constsMap[c.name] = c.value;
  for (const c of schema.consts ?? []) constsMap[c.name] = c.value;

  const getBoundAddress = (paramKey: string): string | undefined =>
    resolveBoundParamAddress(boundParams, paramKey);

  const expectedScripts = buildOutputScriptsForPreciseVsize(
    schema,
    constsMap,
    getBoundAddress,
    network,
    boundParams,
    document
  );

  for (let j = 0; j < schema.outputs.length; j++) {
    const actual = Buffer.from(psbt.txOutputs[j].script);
    const exp = expectedScripts[j];
    if (!exp || exp.length === 0) {
      return {
        code: 'BTSL_ERR_02',
        message: `Output ${j}: could not derive expected scriptPubKey from schema (O-1)`,
      };
    }
    if (!actual.equals(exp)) {
      return {
        code: 'BTSL_ERR_02',
        message: `Output ${j}: PSBT scriptPubKey does not match schema-derived script (O-1)`,
      };
    }
  }
  return null;
}
