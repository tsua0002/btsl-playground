/**
 * Precise virtual size: build a template transaction with real output scriptPubKeys
 * (from addresses) and standard placeholder witnesses/scriptSigs, then bitcoinjs-lib
 * Transaction.virtualSize() (BIP-141 weight).
 */

import * as bitcoin from 'bitcoinjs-lib';
import type { BTSLInput, BTSLOutput, BTSLSchema } from './types';
import { toPayloadHex } from './types';
import type { BTSLDocument } from './types';
import { compileScriptAsmToHex } from './script-compiler';
import { buildScriptOutputPkScript } from './script-output-pk';
import { parseMultisigMFromAsm } from './multisig-m';
import type { BoundParams, ResolvedUTXO } from './types';
import { buildOpReturnScript } from './op-return-script';

/**
 * Resolve @PARAM to a payment/change address string. Matches Maker PSBT binding:
 * string `resolved`, UTXO-shaped `resolved.address`, or `rawValue`.
 */
export function resolveBoundParamAddress(boundParams: BoundParams, paramKey: string): string | undefined {
  const p = boundParams[paramKey];
  if (!p) return undefined;
  const r = p.resolved;
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object' && 'address' in r) {
    return (r as ResolvedUTXO).address;
  }
  if (typeof p.rawValue === 'string') return p.rawValue;
  return undefined;
}

/** Max standard DER ECDSA sig in witness (BIP 141 WCC). */
const P2WPKH_SIG_PLACEHOLDER = 73;
const P2WPKH_PK_LEN = 33;
const P2TR_SIG_LEN = 64;
/** Legacy P2PKH scriptSig: push sig + push pk (1+73+1+33). */
const P2PKH_SCRIPTSIG_LEN = 107;

export function witnessPlaceholderNative(inputType: BTSLInput['type'] | undefined): Buffer[] {
  switch (inputType) {
    case 'NATIVE_P2TR_KEY':
      return [Buffer.alloc(P2TR_SIG_LEN, 0)];
    case 'NATIVE_P2PKH':
      return [];
    case 'UNLOCK_P2WSH':
    case 'UNLOCK_P2TR_SCRIPT':
      return [Buffer.alloc(73, 0), Buffer.alloc(73, 0), Buffer.alloc(100, 0)];
    default:
      return [
        Buffer.alloc(P2WPKH_SIG_PLACEHOLDER, 0),
        Buffer.concat([Buffer.from([0x02]), Buffer.alloc(P2WPKH_PK_LEN - 1, 0)]),
      ];
  }
}

export function scriptSigPlaceholder(inputType: BTSLInput['type'] | undefined): Buffer {
  return inputType === 'NATIVE_P2PKH' ? Buffer.alloc(P2PKH_SCRIPTSIG_LEN, 0) : Buffer.alloc(0);
}

/**
 * P2WSH CHECKMULTISIG witness: OP_0 dummy + M × max DER sig (73B) + witnessScript.
 * M must match the script’s OP_M (e.g. OP_1 for 1-of-2).
 */
export function witnessPlaceholderP2wsh(witnessScript: Buffer, requiredSignatures: number): Buffer[] {
  const m = Math.min(16, Math.max(1, requiredSignatures));
  const w: Buffer[] = [Buffer.alloc(0)];
  for (let i = 0; i < m; i++) {
    w.push(Buffer.alloc(73, 0));
  }
  w.push(witnessScript);
  return w;
}

export function resolvePaymentAddress(
  output: BTSLOutput,
  constsMap: Record<string, number | string>,
  getBoundAddress: (paramKey: string) => string | undefined
): string | undefined {
  if (output.type !== 'ADDRESS') return undefined;
  const addr = output.address ?? '';
  if (addr.startsWith('@')) {
    const key = addr.replace(/^@/, '').split('.')[0];
    return getBoundAddress(key);
  }
  const c = constsMap[addr];
  if (typeof c === 'string') return c;
  if (addr.startsWith('"') && addr.endsWith('"')) {
    try {
      return JSON.parse(addr) as string;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function resolveChangeAddress(output: BTSLOutput, getBoundAddress: (key: string) => string | undefined): string | undefined {
  if (output.type !== 'CHANGE') return undefined;
  const ref = (output.address ?? '').replace(/^@/, '').replace(/\.[a-z]+$/, '');
  return getBoundAddress(ref);
}

function opReturnScriptFromOutput(
  output: BTSLOutput,
  boundParams: BoundParams
): Buffer {
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
  return buildOpReturnScript(payloadBytes);
}

/**
 * Build output scriptPubKey buffers in schema order (same as PSBT outputs).
 * Skips zero-amount outputs that are not added to PSBT (caller should align indices).
 */
export function buildOutputScriptsForPreciseVsize(
  schema: { outputs: BTSLOutput[] },
  constsMap: Record<string, number | string>,
  getBoundAddress: (key: string) => string | undefined,
  network: bitcoin.Network,
  boundParams: BoundParams,
  document: BTSLDocument
): Buffer[] {
  const scripts: Buffer[] = [];
  for (const output of schema.outputs) {
    if (output.type === 'OP_RETURN') {
      scripts.push(opReturnScriptFromOutput(output, boundParams));
      continue;
    }
    if (output.type === 'SCRIPT' && output.scriptDef) {
      const pk = buildScriptOutputPkScript(document, output, boundParams, network);
      if (pk && pk.length > 0) {
        scripts.push(pk);
        continue;
      }
      scripts.push(Buffer.alloc(34, 0));
      continue;
    }
    let addr: string | undefined;
    if (output.type === 'ADDRESS') {
      addr = resolvePaymentAddress(output, constsMap, getBoundAddress);
    } else if (output.type === 'CHANGE') {
      addr = resolveChangeAddress(output, getBoundAddress);
    }
    if (addr) {
      try {
        scripts.push(Buffer.from(bitcoin.address.toOutputScript(addr, network)));
      } catch {
        scripts.push(Buffer.alloc(22 + 9, 0));
      }
    } else {
      scripts.push(Buffer.alloc(22 + 9, 0));
    }
  }
  return scripts;
}

export function buildWitnessPerInput(
  inputs: BTSLInput[],
  document: BTSLDocument,
  boundParams: BoundParams
): Buffer[][] {
  return inputs.map((inp) => {
    if (inp.type === 'UNLOCK_P2WSH' && inp.scriptDef) {
      const def = document.scriptDefs.find((d) => d.name === inp.scriptDef);
      if (def) {
        try {
          const wsHex = compileScriptAsmToHex(def, boundParams, inp.scriptParams);
          const ws = Buffer.from(wsHex, 'hex');
          const m = parseMultisigMFromAsm(def.asm);
          return witnessPlaceholderP2wsh(ws, m);
        } catch {
          /* fall through */
        }
      }
    }
    if (inp.type === 'UNLOCK_P2TR_SCRIPT' && inp.scriptDef) {
      return [Buffer.alloc(64, 0), Buffer.alloc(100, 0), Buffer.alloc(33, 0)];
    }
    return witnessPlaceholderNative(inp.type);
  });
}

export function computePreciseVirtualSize(
  inputTypesOrInputs: BTSLInput[],
  outputScripts: Buffer[],
  document: BTSLDocument,
  boundParams: BoundParams
): number {
  return computePreciseTxMetrics(inputTypesOrInputs, outputScripts, document, boundParams).vsize;
}

export function computePreciseTxMetrics(
  inputTypesOrInputs: BTSLInput[],
  outputScripts: Buffer[],
  document: BTSLDocument,
  boundParams: BoundParams
): { vsize: number; weight: number } {
  const witnesses = buildWitnessPerInput(inputTypesOrInputs, document, boundParams);
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = 0;
  for (let i = 0; i < inputTypesOrInputs.length; i++) {
    const inp = inputTypesOrInputs[i];
    const h = Buffer.alloc(32);
    h.writeUInt32LE(i, 0);
    tx.addInput(h, 0, inp.sequence ?? 0xffffffff, scriptSigPlaceholder(inp.type));
    const w = witnesses[i];
    if (w.length > 0) {
      tx.setWitness(i, w);
    }
  }
  for (const script of outputScripts) {
    if (script && script.length > 0) {
      tx.addOutput(script, BigInt(1000));
    }
  }
  return { vsize: tx.virtualSize(), weight: tx.weight() };
}

/**
 * Virtual size for Checker calc replay: **output scripts and amounts** come from the audited PSBT;
 * witness stacks use the same schema placeholders as {@link computePreciseTxMetrics}.
 * This matches `vSize(CURRENT_PSBT)` to the artifact the user pasted (avoids address-resolution drift on CHANGE).
 */
export function computePreciseTxMetricsFromPsbt(
  psbt: bitcoin.Psbt,
  schema: BTSLSchema,
  document: BTSLDocument,
  boundParams: BoundParams
): { vsize: number; weight: number } {
  const tx = new bitcoin.Transaction();
  tx.version = psbt.version;
  tx.locktime = psbt.locktime;
  for (const inp of psbt.txInputs) {
    tx.addInput(Buffer.from(inp.hash), inp.index, inp.sequence ?? 0xffffffff);
  }
  for (const out of psbt.txOutputs) {
    tx.addOutput(Buffer.from(out.script), out.value);
  }
  const witnesses = buildWitnessPerInput(schema.inputs, document, boundParams);
  for (let i = 0; i < witnesses.length; i++) {
    if (witnesses[i].length > 0) {
      tx.setWitness(i, witnesses[i]);
    }
  }
  return { vsize: tx.virtualSize(), weight: tx.weight() };
}
