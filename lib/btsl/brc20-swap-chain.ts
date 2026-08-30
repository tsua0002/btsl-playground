/**
 * Demo BTSL for chained OP_RETURN + P2TR change (no real user coins).
 * BIP-341 example P2TR address is public test-vector material, not a live wallet.
 */

export const BRC20_SWAP_CHAIN_LENGTH = 5;

/** BIP-341 spec example P2TR (scriptPubKey 5120ce6d...). Replace in .params with your change address. */
export const BRC20_SWAP_DEMO_CHANGE_ADDRESS =
  'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';

export const BRC20_SWAP_DEMO_PARAMS = `# Replace USER_UTXO with your own txid:vout before Fetch / Confirm.
# CHANGE_ADDRESS is a BIP-341 example — use your own P2TR for a real spend.
USER_UTXO=
PAYLOAD={"p":"brc-20","op":"swap","tick":"DEMO","amt":"1"}
FEE_RATE=1.2
CHANGE_ADDRESS=${BRC20_SWAP_DEMO_CHANGE_ADDRESS}
`;

function swap1Block(): string {
  return `PSBT_SCHEMA SWAP_1:
    PARAMS:
        @USER_UTXO:UTXO
        @PAYLOAD:HEX_DATA
        @FEE_RATE:FEERATE

    INPUTS:
        0: NATIVE P2TR
            utxo: @USER_UTXO

    OUTPUTS:
        0: OP_RETURN @PAYLOAD
        1: CHANGE @USER_UTXO.address change_amount sats

    calc:
        fees = vSize(CURRENT_PSBT) * @FEE_RATE
        change_amount = REF(@USER_UTXO.amount) - fees

    ASSERT:
        0: change_amount >= DUST_LIMIT`;
}

function swapNBlock(n: number): string {
  const parent = `SWAP_${n - 1}`;
  return `PSBT_SCHEMA SWAP_${n}:
    OPTIONS:
        DEPENDS_ON ${parent}

    PARAMS:
        @PAYLOAD:HEX_DATA
        @FEE_RATE:FEERATE
        @CHANGE_ADDRESS:ADDRESS

    INPUTS:
        0: NATIVE P2TR
            utxo: ${parent}:1.txid:1

    OUTPUTS:
        0: OP_RETURN @PAYLOAD
        1: CHANGE @CHANGE_ADDRESS change_amount sats

    calc:
        fees = vSize(CURRENT_PSBT) * @FEE_RATE
        change_amount = REF(${parent}:1.amount) - fees

    ASSERT:
        0: change_amount >= DUST_LIMIT`;
}

/** Full BTSL document: SWAP_1 … SWAP_{length}. */
export function buildBrc20SwapChainBtsl(length = BRC20_SWAP_CHAIN_LENGTH): string {
  const n = Math.max(1, Math.floor(length));
  const blocks = [
    `; Chained OP_RETURN + P2TR change — ${n} PSBTs, DEPENDS_ON + workflow_ref
; Build unsigned PSBTs in order (parent need not be broadcast). Sign, then broadcast SWAP_1…SWAP_${n}.
VERSION: 1

CONST:
    DUST_LIMIT = 546

${swap1Block()}`,
  ];
  for (let i = 2; i <= n; i++) {
    blocks.push(swapNBlock(i));
  }
  return blocks.join('\n\n') + '\n';
}
