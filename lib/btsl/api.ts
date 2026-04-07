// BTSL API Utilities - External API calls for UTXO resolution and fee rate

import { ResolvedUTXO } from './types';

const PUBKEY_HEX_REGEX = /^[0-9a-fA-F]{66}$/;

// Lazy singleton init for bitcoinjs-lib + ECC, safe in the browser and reused across calls.
let bitcoinLibPromise: Promise<typeof import('bitcoinjs-lib')> | null = null;

async function getBitcoinLib(): Promise<typeof import('bitcoinjs-lib')> {
  if (!bitcoinLibPromise) {
    bitcoinLibPromise = (async () => {
      const bitcoin = await import('bitcoinjs-lib');
      // In v7, ECC must be provided explicitly
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      const ecc = (await import('tiny-secp256k1')) as typeof import('tiny-secp256k1');
      // Guard in case of different build shapes
      if (typeof (bitcoin as any).initEccLib === 'function') {
        (bitcoin as any).initEccLib(ecc);
      }
      return bitcoin;
    })();
  }
  return bitcoinLibPromise;
}

function parsePubkeyHex(pubkeyHex: string): Buffer {
  const hex = pubkeyHex.replace(/^0x/i, '');
  if (!PUBKEY_HEX_REGEX.test(hex)) {
    throw new Error('BTSL_ERR_04e: Invalid pubkey — must be 33-byte compressed (66 hex chars)');
  }
  return Buffer.from(hex, 'hex');
}

// For Taproot we need the x-only (32-byte) pubkey, derived from a 33-byte compressed key.
function parseXOnlyPubkey(pubkeyHex: string): Buffer {
  const full = parsePubkeyHex(pubkeyHex);
  if (full.length !== 33) {
    throw new Error(`BTSL_ERR_04e: Invalid Taproot pubkey length — expected 33 bytes, got ${full.length}`);
  }
  const prefix = full[0];
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new Error('BTSL_ERR_04e: Invalid Taproot pubkey — must be compressed (starts with 02 or 03)');
  }
  // Drop the parity byte to get the x-only internal key (32 bytes)
  return full.subarray(1);
}

/** Derive P2WPKH address from 33-byte compressed pubkey (hex). Uses bitcoinjs-lib. */
export async function pubkeyToP2wpkhAddress(pubkeyHex: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<string> {
  const bitcoin = await getBitcoinLib();
  const net = network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const pubkeyBuf = parsePubkeyHex(pubkeyHex);
  const { address } = bitcoin.payments.p2wpkh({ pubkey: pubkeyBuf, network: net });
  if (!address) throw new Error('BTSL_ERR_04e: Failed to derive P2WPKH address from pubkey');
  return address;
}

/** Derive P2TR address (Taproot, key-path) from 33-byte compressed pubkey as internal key. */
export async function pubkeyToP2trAddress(pubkeyHex: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<string> {
  const bitcoin = await getBitcoinLib();
  const net = network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const internalKey = parseXOnlyPubkey(pubkeyHex);
  const { address } = bitcoin.payments.p2tr({ internalPubkey: internalKey, network: net });
  if (!address) throw new Error('BTSL_ERR_04e: Failed to derive P2TR address from pubkey');
  return address;
}

/** Derive P2PKH (legacy) address from 33-byte compressed pubkey. */
export async function pubkeyToP2pkhAddress(pubkeyHex: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<string> {
  const bitcoin = await getBitcoinLib();
  const net = network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const pubkeyBuf = parsePubkeyHex(pubkeyHex);
  const { address } = bitcoin.payments.p2pkh({ pubkey: pubkeyBuf, network: net });
  if (!address) throw new Error('BTSL_ERR_04e: Failed to derive P2PKH address from pubkey');
  return address;
}

/** Address type when resolving From(@PUBKEY) — derived from INPUT line (NATIVE P2WPKH / P2TR / P2PKH). */
export type PubkeyAddressType = 'P2WPKH' | 'P2TR' | 'P2PKH';

/** Max UTXO candidates considered per address (largest-first). Keeps playground safe with large wallets. */
export const MAX_UTXO_CANDIDATES = 121;

/** Fetch UTXOs for an address (Blockstream). Sorted by value descending, capped at MAX_UTXO_CANDIDATES. */
export async function fetchUTXOsByAddress(address: string): Promise<Array<{ txid: string; vout: number; value: number }>> {
  const response = await fetch(`https://blockstream.info/api/address/${address}/utxo`);
  if (!response.ok) {
    throw new Error(`BTSL_ERR_09: Failed to fetch UTXOs for address: ${response.status}`);
  }
  const raw = (await response.json()) as Array<{ txid: string; vout: number; value: number }>;
  const valid = raw.filter(
    (u) => u.txid && typeof u.vout === 'number' && typeof u.value === 'number'
  );
  valid.sort((a, b) => b.value - a.value);
  return valid.slice(0, MAX_UTXO_CANDIDATES);
}

/** Resolve a UTXO from a pubkey. Address type comes from INPUT (NATIVE P2WPKH / P2TR / P2PKH); default P2WPKH. */
export async function fetchUTXOByPubkey(
  pubkeyHex: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
  addressType: PubkeyAddressType = 'P2WPKH'
): Promise<ResolvedUTXO> {
  let address: string;
  switch (addressType) {
    case 'P2TR':
      address = await pubkeyToP2trAddress(pubkeyHex, network);
      break;
    case 'P2PKH':
      address = await pubkeyToP2pkhAddress(pubkeyHex, network);
      break;
    default:
      address = await pubkeyToP2wpkhAddress(pubkeyHex, network);
  }
  const utxos = await fetchUTXOsByAddress(address);
  if (utxos.length === 0) {
    throw new Error(`BTSL_ERR_09: No UTXO found for this pubkey (${addressType})`);
  }
  const first = utxos[0];
  return fetchUTXO(first.txid, first.vout);
}

/** Resolve a UTXO from a Bitcoin address (largest-first). */
export async function fetchUTXOByAddress(address: string): Promise<ResolvedUTXO> {
  const { valid } = validateAddress(address);
  if (!valid) {
    throw new Error('BTSL_ERR_04e: Invalid address — expected a valid Bitcoin address');
  }
  const utxos = await fetchUTXOsByAddress(address);
  if (utxos.length === 0) {
    throw new Error('BTSL_ERR_09: No UTXO found for this address');
  }
  const first = utxos[0];
  return fetchUTXO(first.txid, first.vout);
}

// Fetch UTXO data from Blockstream API
export async function fetchUTXO(txid: string, vout: number): Promise<ResolvedUTXO> {
  try {
    const response = await fetch(`https://blockstream.info/api/tx/${txid}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`BTSL_ERR_05: Transaction not found: ${txid}`);
      }
      throw new Error(`BTSL_ERR_05: API error: ${response.status} ${response.statusText}`);
    }
    
    const txData = await response.json();
    
    if (!txData.vout || vout >= txData.vout.length) {
      throw new Error(`BTSL_ERR_05: Invalid vout index ${vout} for transaction ${txid}`);
    }
    
    const output = txData.vout[vout];
    const scriptPubKey = output.scriptpubkey;
    const scriptType = detectScriptTypeFromSpk(scriptPubKey);
    
    return {
      txid,
      vout,
      value: output.value,
      scriptPubKey,
      scriptType,
      address: output.scriptpubkey_address
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BTSL_ERR')) {
      throw error;
    }
    throw new Error(`BTSL_ERR_05: Failed to fetch UTXO: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/** Detect script type from scriptPubKey hex (Checker I-1 / API). */
export function detectScriptTypeFromSpk(scriptPubKey: string): ResolvedUTXO['scriptType'] {
  // P2WPKH: 0014{20 bytes} = 22 bytes = 44 hex chars
  if (scriptPubKey.length === 44 && scriptPubKey.startsWith('0014')) {
    return 'P2WPKH';
  }
  
  // P2TR: 5120{32 bytes} = 34 bytes = 68 hex chars
  if (scriptPubKey.length === 68 && scriptPubKey.startsWith('5120')) {
    return 'P2TR';
  }
  
  // P2WSH: 0020{32 bytes} = 34 bytes = 68 hex chars
  if (scriptPubKey.length === 68 && scriptPubKey.startsWith('0020')) {
    return 'P2WSH';
  }
  
  // P2PKH: 76a914{20 bytes}88ac = 25 bytes = 50 hex chars
  if (scriptPubKey.length === 50 && scriptPubKey.startsWith('76a914') && scriptPubKey.endsWith('88ac')) {
    return 'P2PKH';
  }
  
  // P2SH: a914{20 bytes}87 = 23 bytes = 46 hex chars
  if (scriptPubKey.length === 46 && scriptPubKey.startsWith('a914') && scriptPubKey.endsWith('87')) {
    return 'P2SH';
  }
  
  return 'UNKNOWN';
}

// Fetch current fee rates from Mempool.space API
export async function fetchFeeRate(): Promise<{
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}> {
  try {
    const response = await fetch('https://mempool.space/api/v1/fees/recommended');
    
    if (!response.ok) {
      throw new Error(`BTSL_ERR_05: Fee API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      fastestFee: data.fastestFee,
      halfHourFee: data.halfHourFee,
      hourFee: data.hourFee,
      economyFee: data.economyFee,
      minimumFee: data.minimumFee
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BTSL_ERR')) {
      throw error;
    }
    throw new Error(`BTSL_ERR_05: Failed to fetch fee rates: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Validate Bitcoin address format
export function validateAddress(address: string): { valid: boolean; type: string } {
  // Mainnet P2WPKH/P2WSH (bc1q...)
  if (/^bc1q[a-z0-9]{38,58}$/.test(address)) {
    return { valid: true, type: address.length > 43 ? 'P2WSH' : 'P2WPKH' };
  }
  
  // Mainnet P2TR (bc1p...)
  if (/^bc1p[a-z0-9]{58}$/.test(address)) {
    return { valid: true, type: 'P2TR' };
  }
  
  // Testnet P2WPKH/P2WSH (tb1q...)
  if (/^tb1q[a-z0-9]{38,58}$/.test(address)) {
    return { valid: true, type: address.length > 43 ? 'P2WSH' : 'P2WPKH' };
  }
  
  // Testnet P2TR (tb1p...)
  if (/^tb1p[a-z0-9]{58}$/.test(address)) {
    return { valid: true, type: 'P2TR' };
  }
  
  // Legacy P2PKH mainnet (1...)
  if (/^1[a-km-zA-HJ-NP-Z0-9]{25,34}$/.test(address)) {
    return { valid: true, type: 'P2PKH' };
  }
  
  // Legacy P2SH mainnet (3...)
  if (/^3[a-km-zA-HJ-NP-Z0-9]{25,34}$/.test(address)) {
    return { valid: true, type: 'P2SH' };
  }
  
  // Testnet P2PKH (m/n...)
  if (/^[mn][a-km-zA-HJ-NP-Z0-9]{25,34}$/.test(address)) {
    return { valid: true, type: 'P2PKH' };
  }
  
  // Testnet P2SH (2...)
  if (/^2[a-km-zA-HJ-NP-Z0-9]{25,34}$/.test(address)) {
    return { valid: true, type: 'P2SH' };
  }
  
  return { valid: false, type: 'INVALID' };
}

// Validate hex data format
export function validateHexData(hex: string): boolean {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return /^[0-9a-fA-F]+$/.test(cleanHex) && cleanHex.length % 2 === 0;
}

// Parse UTXO string (txid:vout format)
export function parseUTXOString(utxo: string): { txid: string; vout: number } | null {
  const match = utxo.match(/^([0-9a-fA-F]{64}):(\d+)$/);
  if (!match) return null;
  return {
    txid: match[1].toLowerCase(),
    vout: parseInt(match[2], 10)
  };
}
