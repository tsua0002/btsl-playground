import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { buildOpReturnScript } from '@/lib/btsl/op-return-script';

describe('buildOpReturnScript', () => {
  it('uses direct push for payload length ≤ 75', () => {
    const data = Buffer.alloc(75, 0xab);
    const script = buildOpReturnScript(data);
    expect(script[0]).toBe(bitcoin.opcodes.OP_RETURN);
    expect(script[1]).toBe(75);
    expect(script.length).toBe(1 + 1 + 75);
    const chunks = bitcoin.script.decompile(script);
    expect(chunks?.[0]).toBe(bitcoin.opcodes.OP_RETURN);
    expect(Buffer.compare(Buffer.from(chunks?.[1] as Buffer), data)).toBe(0);
  });

  it('uses OP_PUSHDATA1 when payload length > 75 (no bogus opcode at second byte)', () => {
    const text =
      'Bitcoin Transaction Schema Language\nKnow what you sign.\nA declaration layer for PSBT workflows.';
    const data = Buffer.from(text, 'utf8');
    expect(data.length).toBeGreaterThan(75);

    const script = buildOpReturnScript(data);
    expect(script[0]).toBe(bitcoin.opcodes.OP_RETURN);
    expect(script[1]).toBe(bitcoin.opcodes.OP_PUSHDATA1);
    expect(script[2]).toBe(data.length);

    const chunks = bitcoin.script.decompile(script);
    expect(chunks?.[0]).toBe(bitcoin.opcodes.OP_RETURN);
    expect(Buffer.from(chunks?.[1] as Buffer).toString('utf8')).toBe(text);
  });
});
