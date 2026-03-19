/**
 * Canonical transaction weight (BTSL spec §3.5). All values in weight units (wu).
 * vsize = ceil(tx_weight / 4).
 */

import type { BTSLInput, BTSLOutput } from './types';

export const BTSL_BASE_TX_OVERHEAD_WU = 40;
export const BTSL_SEGWIT_OVERHEAD_WU = 2;

/** Input weight in wu (signed, worst-case canonical). */
export function inputWeightWu(inputType: BTSLInput['type'] | undefined): number {
  switch (inputType) {
    case 'NATIVE_P2PKH':
      return 592;
    case 'NATIVE_P2WPKH':
      return 273;
    case 'NATIVE_P2TR_KEY':
      return 230;
    case 'UNLOCK_P2WSH':
      return 164 + 220;
    case 'UNLOCK_P2TR_SCRIPT':
      return 164 + 180 + 65;
    default:
      return 273;
  }
}

/** Output weight in wu from a Bitcoin address string (spec §3.5.4). */
export function outputWeightWuFromAddress(addr: string | undefined | null): number {
  if (addr == null || addr === '') return 124;
  const a = String(addr).trim();
  if (a.startsWith('bc1p') || a.startsWith('tb1p')) return 172;
  if (a.startsWith('bc1q') || a.startsWith('tb1q')) return 124;
  if (a.startsWith('bc1') && a.length >= 14) return 124;
  if (a.startsWith('tb1') && !a.startsWith('tb1p')) return 124;
  if (/^[13mn][a-km-zA-HJ-NP-Z0-9]{25,34}$/.test(a) || /^[2][a-km-zA-HJ-NP-Z0-9]{25,34}$/.test(a)) {
    return 136;
  }
  return 124;
}

/** OP_RETURN output weight: (11 + payloadLen) × 4 for len ≤ 75 (spec). */
export function opReturnOutputWeightWu(payloadByteLength: number): number {
  const len = Math.max(0, Math.min(payloadByteLength, 75));
  return (11 + len) * 4;
}

export function schemaHasSegwitInput(inputs: BTSLInput[]): boolean {
  return inputs.some((i) => i.type !== 'NATIVE_P2PKH');
}

export function overheadWu(inputs: BTSLInput[]): number {
  return BTSL_BASE_TX_OVERHEAD_WU + (schemaHasSegwitInput(inputs) ? BTSL_SEGWIT_OVERHEAD_WU : 0);
}

/** Resolve ADDRESS / CHANGE output weight for simulation (consts + bound params). */
export function outputWeightWuForOutput(
  output: BTSLOutput,
  constsMap: Record<string, number | string>,
  getBoundAddress: (paramKey: string) => string | undefined
): number {
  switch (output.type) {
    case 'SCRIPT':
      return 172;
    case 'OP_RETURN': {
      const raw = (output.payload ?? '').trim();
      let byteLen = 40;
      if (raw.startsWith('@')) return opReturnOutputWeightWu(byteLen);
      const hex = raw.replace(/^0x/i, '').replace(/\s/g, '');
      if (/^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0) {
        byteLen = hex.length / 2;
      }
      return opReturnOutputWeightWu(Math.min(byteLen, 75));
    }
    case 'CHANGE': {
      const ref = (output.address ?? '').replace(/^@/, '').replace(/\.[a-z]+$/, '');
      return outputWeightWuFromAddress(getBoundAddress(ref));
    }
    case 'ADDRESS': {
      const addr = output.address ?? '';
      if (addr.startsWith('@')) {
        const key = addr.replace(/^@/, '').split('.')[0];
        return outputWeightWuFromAddress(getBoundAddress(key));
      }
      const c = constsMap[addr];
      if (typeof c === 'string') return outputWeightWuFromAddress(c);
      if (addr.startsWith('"') && addr.endsWith('"')) {
        return outputWeightWuFromAddress(JSON.parse(addr) as string);
      }
      return 124;
    }
    default:
      return 124;
  }
}

export function totalTxWeightWu(
  inputs: BTSLInput[],
  outputs: BTSLOutput[],
  constsMap: Record<string, number | string>,
  getBoundAddress: (paramKey: string) => string | undefined
): number {
  let w = overheadWu(inputs);
  for (const inp of inputs) {
    w += inputWeightWu(inp.type);
  }
  for (const out of outputs) {
    w += outputWeightWuForOutput(out, constsMap, getBoundAddress);
  }
  return w;
}

export function vsizeFromWeightWu(txWeightWu: number): number {
  return Math.ceil(txWeightWu / 4);
}
