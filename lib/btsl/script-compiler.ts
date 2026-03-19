// Minimal Bitcoin Script compiler for BTSL SCRIPT_DEFS (P2WSH focus)
// Scope: enough to support multisig 1-of-2 / 2-of-2 and simple scripts.

import type { BTSLScriptDef, BoundParams } from './types';

// Opcodes we currently support (extend as needed)
const OPCODES: Record<string, number> = {
  OP_0: 0x00,
  OP_FALSE: 0x00,
  OP_1: 0x51,
  OP_2: 0x52,
  OP_3: 0x53,
  OP_CHECKSIG: 0xac,
  OP_CHECKMULTISIG: 0xae,
  OP_DROP: 0x75,
  OP_CSV: 0xb2, // OP_CHECKSEQUENCEVERIFY
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('BTSL_ERR_00: Invalid hex length for script element');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Encode a pushdata for small values (we only need lengths <= 75 for now).
function encodePush(data: Uint8Array, out: number[]) {
  const len = data.length;
  if (len <= 75) {
    out.push(len);
    for (let i = 0; i < len; i++) out.push(data[i]);
  } else {
    // For now, keep it simple; extend if we hit larger scripts.
    throw new Error('BTSL_ERR_00: Pushdata too long for minimal encoder');
  }
}

// Resolve <pubkey(NAME)> to a 33-byte compressed pubkey.
function resolvePubkeyHex(
  placeholder: string,
  boundParams: BoundParams,
  scriptParams?: Record<string, string>
): string {
  // 1) from scriptParams if provided (PK1 = @KEY1, etc.)
  if (scriptParams && scriptParams[placeholder]) {
    const v = scriptParams[placeholder];
    // allow direct hex or @PARAM reference
    if (v.startsWith('@')) {
      const pName = v.replace(/^@/, '');
      const param = boundParams[pName];
      if (!param || typeof param.resolved !== 'string') {
        throw new Error(
          `BTSL_ERR_04e: Pubkey param @${pName} for ${placeholder} is not a hex string`
        );
      }
      return param.resolved as string;
    }
    return v;
  }

  // 2) from boundParams[placeholder] directly
  const direct = boundParams[placeholder];
  if (direct && typeof direct.resolved === 'string') {
    return direct.resolved as string;
  }

  // 3) Heuristic: PK1 -> KEY1, PK2 -> KEY2
  const m = placeholder.match(/^PK(\d+)$/);
  if (m) {
    const keyName = `KEY${m[1]}`;
    const param = boundParams[keyName];
    if (param && typeof param.resolved === 'string') {
      return param.resolved as string;
    }
  }

  throw new Error(
    `BTSL_ERR_04e: Unable to resolve pubkey placeholder ${placeholder} to a Pubkey`
  );
}

// Compile a BTSL SCRIPT_DEFS asm array into Bitcoin Script bytes.
export function compileScriptAsmToHex(
  scriptDef: BTSLScriptDef,
  boundParams: BoundParams,
  scriptParams?: Record<string, string>
): string {
  if (!scriptDef.asm || scriptDef.asm.length === 0) {
    throw new Error(
      'BTSL_ERR_00: SCRIPT_DEFS asm is empty; cannot compile script'
    );
  }

  const out: number[] = [];

  for (const token of scriptDef.asm) {
    // Placeholders <pubkey(NAME)>
    const pkMatch = token.match(/^<pubkey\(([A-Za-z0-9_]+)\)>$/);
    if (pkMatch) {
      const placeholder = pkMatch[1];
      const pubkeyHex = resolvePubkeyHex(placeholder, boundParams, scriptParams);
      const pkBytes = hexToBytes(pubkeyHex);
      if (pkBytes.length !== 33) {
        throw new Error(
          `BTSL_ERR_04e: Pubkey ${placeholder} is not 33 bytes compressed`
        );
      }
      encodePush(pkBytes, out);
      continue;
    }

    // <empty> pushes empty byte array (OP_0)
    if (token === '<empty>') {
      out.push(OPCODES.OP_0);
      continue;
    }

    // Numeric literals 0..16 -> OP_N
    if (/^\d+$/.test(token)) {
      const n = parseInt(token, 10);
      if (n === 0) {
        out.push(OPCODES.OP_0);
        continue;
      }
      if (n >= 1 && n <= 16) {
        out.push(OPCODES[`OP_${n}`]);
        continue;
      }
    }

    // Raw hex literal (0x...)
    if (/^(0x)?[0-9a-fA-F]+$/.test(token)) {
      const data = hexToBytes(token);
      encodePush(data, out);
      continue;
    }

    // Opcode
    if (token in OPCODES) {
      out.push(OPCODES[token]);
      continue;
    }

    // Fallback: unknown token
    throw new Error(
      `BTSL_ERR_00: Unknown ASM token in SCRIPT_DEFS: "${token}"`
    );
  }

  return bytesToHex(new Uint8Array(out));
}

