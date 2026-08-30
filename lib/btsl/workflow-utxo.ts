/**
 * Resolve workflow-chained UTXOs without requiring the parent tx to be on-chain.
 * Parent txid may be typed by the user (or predicted from the unsigned parent PSBT).
 */

import type { ResolvedUTXO, WorkflowOutputRef, WorkflowSchemaResult } from './types';
import { detectScriptTypeFromSpk, fetchUTXO, parseUTXOString } from './api';
import { Buffer } from 'buffer';

const TXID_RE = /^[0-9a-fA-F]{64}$/;

export function parseWorkflowOutpoint(
  raw: string,
  defaultVout: number,
  fallbackTxid?: string
): { txid: string; vout: number } | null {
  const trimmed = raw.trim();
  const parsed = parseUTXOString(trimmed);
  if (parsed) return parsed;
  if (TXID_RE.test(trimmed)) {
    return { txid: trimmed.toLowerCase(), vout: defaultVout };
  }
  const fb = fallbackTxid?.trim();
  if (fb && TXID_RE.test(fb)) {
    return { txid: fb.toLowerCase(), vout: defaultVout };
  }
  return null;
}

export function resolvedUtxoFromWorkflowStep(
  txid: string,
  vout: number,
  step?: WorkflowSchemaResult
): ResolvedUTXO | null {
  const out =
    step?.outputs?.find((o) => o.index === vout) ??
    (step?.outputs && vout >= 0 && vout < step.outputs.length ? step.outputs[vout] : undefined);
  if (!out) return null;
  const value = Number(out.valueSats);
  if (!Number.isFinite(value) || value < 0) return null;
  const scriptPubKey = out.scriptPubKey?.trim();
  if (!scriptPubKey) return null;
  return {
    txid: txid.toLowerCase(),
    vout,
    value,
    scriptPubKey,
    scriptType: detectScriptTypeFromSpk(scriptPubKey),
    address: out.address,
  };
}

export async function resolveWorkflowUtxo(opts: {
  paramName: string;
  rawValue: string;
  ref: WorkflowOutputRef;
  step?: WorkflowSchemaResult;
}): Promise<{ ok: true; utxo: ResolvedUTXO } | { ok: false; error: string }> {
  const outpoint = parseWorkflowOutpoint(opts.rawValue, opts.ref.vout, opts.step?.txid);
  if (!outpoint) {
    return {
      ok: false,
      error: `UTXO @${opts.paramName}: enter the parent txid (txid or txid:vout) for ${opts.ref.schemaName} — it does not need to be broadcast yet`,
    };
  }

  try {
    const utxo = await fetchUTXO(outpoint.txid, outpoint.vout);
    return { ok: true, utxo };
  } catch (e) {
    const local = resolvedUtxoFromWorkflowStep(outpoint.txid, outpoint.vout, opts.step);
    if (local) return { ok: true, utxo: local };
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `Workflow UTXO @${opts.paramName}: ${msg}. If the parent tx is not on-chain yet, run the parent schema first (so output amounts/scripts are known) and enter its txid.`,
    };
  }
}

/** Unsigned global tx inside a bitcoinjs-lib Psbt (used for predicted txid / output scripts). */
export function unsignedTxFromPsbt(psbt: unknown): {
  txid: string;
  outputs: Array<{ index: number; valueSats: string; scriptPubKey: string }>;
} | null {
  const cacheTx = (psbt as { __CACHE?: { __TX?: { getId(): string; outs: Array<{ script: Uint8Array; value: bigint | number }> } } })
    .__CACHE?.__TX;
  if (!cacheTx || typeof cacheTx.getId !== 'function' || !Array.isArray(cacheTx.outs)) return null;
  return {
    txid: cacheTx.getId(),
    outputs: cacheTx.outs.map((o, i) => ({
      index: i,
      valueSats: String(o.value),
      scriptPubKey: Buffer.from(o.script).toString('hex'),
    })),
  };
}
