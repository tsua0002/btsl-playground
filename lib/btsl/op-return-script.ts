/**
 * Standard OP_RETURN script: OP_RETURN + one push of the payload.
 * Length must use OP_PUSHDATA1/2/4 when n > 75 — raw `[0x6a, n, ...data]` wrongly uses
 * n as an opcode (e.g. 107 → 0x6b OP_TOALTSTACK).
 */
import * as bitcoin from 'bitcoinjs-lib';

export function buildOpReturnScript(payload: Buffer | Uint8Array): Buffer {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return Buffer.from(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, buf]));
}
