/**
 * Parse required signature count M from the first token of a multisig script asm
 * (OP_M <pubkeys...> OP_N OP_CHECKMULTISIG).
 */

export function parseMultisigMFromAsm(asm: string[] | undefined): number {
  if (!asm?.length) return 1;
  const t = asm[0].trim();
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n >= 1 && n <= 16) return n;
    return 2;
  }
  const u = t.toUpperCase();
  const m = u.match(/^OP_(1[0-6]|[1-9])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 16) return n;
  }
  return 2;
}
