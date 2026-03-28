/**
 * scriptPubKey for schema OUTPUTS of type SCRIPT (P2WSH / P2TR).
 */
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import type { BTSLDocument, BTSLOutput, BTSLScriptDef, BoundParams } from './types';
import { compileScriptAsmToHex } from './script-compiler';

let eccInitialized = false;
function ensureEcc(): void {
  if (!eccInitialized) {
    bitcoin.initEccLib(ecc);
    eccInitialized = true;
  }
}

/** BIP341 NUMS internal key (x-only, 32 bytes) — spec §3.7. */
export const BTSL_NUMS_KEY_XONLY_HEX =
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

function resolveP2trInternalPubkey(internalKey: string | undefined): Buffer {
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
 * Build the witness v1 (Taproot / P2WSH v0) scriptPubKey for a SCRIPT output.
 * Returns null if the definition is missing or compilation fails.
 */
export function buildScriptOutputPkScript(
  document: BTSLDocument,
  output: BTSLOutput,
  boundParams: BoundParams,
  network: bitcoin.Network
): Buffer | null {
  if (output.type !== 'SCRIPT' || !output.scriptDef) return null;
  const def = document.scriptDefs.find((d) => d.name === output.scriptDef);
  if (!def) return null;

  ensureEcc();

  try {
    if (def.type === 'P2WSH' || def.type === 'P2SH') {
      const hexStr = compileScriptAsmToHex(def, boundParams, output.scriptParams);
      const ws = Buffer.from(hexStr, 'hex');
      const { output: p2wsh } = bitcoin.payments.p2wsh({ redeem: { output: ws }, network });
      return p2wsh ? Buffer.from(p2wsh) : null;
    }

    if (def.type === 'P2TR') {
      const path = def.paths?.[0];
      if (!path) return null;
      const leafDef: BTSLScriptDef = {
        name: def.name,
        type: 'P2WSH',
        asm: path.asm,
      };
      const leafHex = compileScriptAsmToHex(leafDef, boundParams, output.scriptParams);
      const leafBuf = Buffer.from(leafHex, 'hex');
      const internalPubkey = resolveP2trInternalPubkey(def.internalKey);
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
