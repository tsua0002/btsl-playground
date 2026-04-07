/**
 * Infer bitcoinjs network from bound params (mainnet vs testnet).
 * Must not scan arbitrary rawValue strings: SATOSHI values like "2300" or UTXO txids
 * starting with "2" are not addresses and must not flip the network.
 */

import { validateAddress } from './api';
import type { BoundParams } from './types';

/** True only if the string is a valid address on testnet (per validateAddress + prefix rules). */
function isValidatedTestnetAddress(addr: string): boolean {
  const a = addr.trim();
  if (!validateAddress(a).valid) return false;
  if (a.startsWith('tb1')) return true;
  if (a.startsWith('bc1')) return false;
  if (a.startsWith('1') || a.startsWith('3')) return false;
  return a.startsWith('m') || a.startsWith('n') || a.startsWith('2');
}

/**
 * Mainnet unless an ADDRESS param or a resolved UTXO payout address is a valid testnet address.
 */
export function detectTestnetFromBoundParams(boundParams: BoundParams): boolean {
  for (const param of Object.values(boundParams)) {
    if (param?.type === 'ADDRESS' && param.rawValue) {
      if (isValidatedTestnetAddress(String(param.rawValue))) return true;
    }
    if (param?.type === 'UTXO' && param.resolved && typeof param.resolved === 'object' && 'address' in param.resolved) {
      const a = String((param.resolved as { address?: string }).address || '');
      if (a && isValidatedTestnetAddress(a)) return true;
    }
  }
  return false;
}
