/**
 * Normalize secp256k1 public keys for script pushes (P2WSH multisig, etc.).
 *
 * - Compressed SEC: 33 bytes (66 hex), prefix 02 or 03.
 * - Uncompressed SEC: 65 bytes (130 hex), prefix 04 — converted to compressed for Bitcoin script use.
 */

import * as ecc from 'tiny-secp256k1';

function hexToU8(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function u8ToHex(u8: Uint8Array): string {
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Returns 66-character lowercase hex (33-byte compressed SEC on-curve).
 */
export function normalizeSecPubkeyHexToCompressed(hex: string): string {
  const clean = hex.replace(/^0x/i, '').replace(/\s/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean)) {
    throw new Error('BTSL_ERR_04e: Pubkey must be valid hexadecimal');
  }

  if (clean.length === 66) {
    if (!clean.startsWith('02') && !clean.startsWith('03')) {
      throw new Error(
        'BTSL_ERR_04e: 33-byte keys must use prefix 02 or 03 (compressed). Keys starting with 04 are uncompressed (65 bytes = 130 hex chars)'
      );
    }
    const u8 = hexToU8(clean);
    if (!ecc.isPointCompressed(u8) || !ecc.isPoint(u8)) {
      throw new Error('BTSL_ERR_04e: Invalid compressed pubkey (not a valid curve point)');
    }
    return clean;
  }

  if (clean.length === 130) {
    if (!clean.startsWith('04')) {
      throw new Error('BTSL_ERR_04e: 65-byte uncompressed pubkey must start with 04');
    }
    const u8 = hexToU8(clean);
    if (!ecc.isPoint(u8)) {
      throw new Error('BTSL_ERR_04e: Invalid uncompressed pubkey (not a valid curve point)');
    }
    const compressed = ecc.pointCompress(u8, true);
    if (!compressed || compressed.length !== 33) {
      throw new Error('BTSL_ERR_04e: Failed to compress pubkey');
    }
    return u8ToHex(compressed);
  }

  throw new Error(
    'BTSL_ERR_04e: Pubkey hex must be 66 chars (compressed 02/03) or 130 chars (uncompressed 04)'
  );
}
