export type ExampleCategoryId =
  | 'simple_payment'
  | 'tri_count'
  | 'multisig'
  | 'op_return'
  | 'taproot_vault';

export interface ExampleDefinition {
  id: string;
  categoryId: ExampleCategoryId;
  title: string;
  subtitle: string;
  description: string;
  useCase: string;
  icon: string;
  btsl: string;
  quickTutorial: {
    steps: string[];
    requiredParams: string[];
  };
  /** Pre-filled non-UTXO parameter values for quick demo */
  prefillParams?: Record<string, string>;
  /** Explorer link pattern for verifying broadcast transactions */
  explorerLinkTemplate?: string;
}

const EXAMPLE_SIMPLE_PAYMENT = `; BTSL v1.0 - Single Key Payment
VERSION: 1

CONST:
    DUST_LIMIT = 330

PSBT_SCHEMA PUBKEY_SPEND:
    CONST:
        PAYMENT_ADDRESS = "bc1q7hx499w4v9vkmhsfymmhlp6u9rlqrhprr95ju3"
        AMOUNT = 1000

    PARAMS:
        @PUBKEY:PUBKEY
        @FEE_RATE:FEERATE

    INPUTS:
        0: NATIVE P2WPKH
            utxo: From(@PUBKEY) AS selected_utxo

    OUTPUTS:
        0: PAYMENT_ADDRESS AMOUNT sats
        1: CHANGE selected_utxo.address change_amount sats

    calc:
        fees = vSize(CURRENT_PSBT) * @FEE_RATE
        change_amount = selected_utxo.amount - AMOUNT - fees

    ASSERT:
        0: change_amount >= DUST_LIMIT`;

const EXAMPLE_TRI_COUNT = `; BTSL v1.0 - TRICOUNT Example
VERSION: 1

CONST:
    DUST_LIMIT = 546

PSBT_SCHEMA TRICOUNT:
    PARAMS:
        @BOB_UTXO:UTXO
        @CARO_UTXO:UTXO
        @ALICE_ADDRESS:ADDRESS
        @MAKER_ADDRESS:ADDRESS
        @FEE_RATE:FEERATE
        @MAKER_FEE:SATOSHI
        @MEAN:SATOSHI
        @A2:SATOSHI
        @A3:SATOSHI

    INPUTS:
        0:
            utxo: @BOB_UTXO
        1:
            utxo: @CARO_UTXO

    OUTPUTS:
        0: @ALICE_ADDRESS payment sats
        1: CHANGE @BOB_UTXO.address c_bob sats
        2: CHANGE @CARO_UTXO.address c_caro sats
        3: @MAKER_ADDRESS maker_fee_val sats

    calc:
        payment = (2 * @MEAN) - @A2 - @A3
        fees_btc = vSize(CURRENT_PSBT) * @FEE_RATE
        fees = @MAKER_FEE + fees_btc
        maker_fee_val = @MAKER_FEE
        c_bob  = REF(@BOB_UTXO.amount) - (@MEAN - @A2) - (fees / 2)
        c_caro = REF(@CARO_UTXO.amount) - (@MEAN - @A3) - (fees / 2)

    ASSERT:
        0: c_bob >= DUST_LIMIT
        1: c_caro >= DUST_LIMIT
        2: payment > 0
        3: REF(@BOB_UTXO.amount) >= (@MEAN - @A2) + (fees / 2)
        4: REF(@CARO_UTXO.amount) >= (@MEAN - @A3) + (fees / 2)`;

const EXAMPLE_MULTISIG_2OF2 = `; Source: github.com/tsua0002/btsl-standard — examples/multisig-2-of-2/schema.bts
VERSION: 1

SCRIPT_DEFS:
    MULTISIG_2_2 P2WSH:
        asm: OP_2 <pubkey(PK1)> <pubkey(PK2)> OP_2 OP_CHECKMULTISIG

PSBT_SCHEMA MULTISIG_SPEND:
    PARAMS:
        @MULTISIG_UTXO:UTXO
        @DEST:ADDRESS
        @FEE_RATE:FEERATE
        @KEY1:HEX_DATA
        @KEY2:HEX_DATA

    INPUTS:
        0: UNLOCK MULTISIG_2_2:
            utxo: @MULTISIG_UTXO
            witness_data:
                DUMMY = <empty>
                SIG1  = <SIGN_WITH(@KEY1)>
                SIG2  = <SIGN_WITH(@KEY2)>

    OUTPUTS:
        0: @DEST 50000 sats
        1: CHANGE @MULTISIG_UTXO.address change_amount sats

    calc:
        fees = vSize(CURRENT_PSBT) * @FEE_RATE
        change_amount = REF(@MULTISIG_UTXO.amount) - 50000 - fees

    ASSERT:
        0: change_amount >= DUST_LIMIT`;

function deriveMultisig1Of2(btsl2of2: string): string {
  // Replace scriptDef name and first multisig opcode from OP_2 to OP_1.
  return btsl2of2
    .replaceAll('MULTISIG_2_2', 'MULTISIG_1_2')
    .replace(
      'asm: OP_2 <pubkey(PK1)> <pubkey(PK2)> OP_2 OP_CHECKMULTISIG',
      'asm: OP_1 <pubkey(PK1)> <pubkey(PK2)> OP_2 OP_CHECKMULTISIG'
    );
}

const EXAMPLE_MULTISIG_1OF2 = deriveMultisig1Of2(EXAMPLE_MULTISIG_2OF2);

const EXAMPLE_OP_RETURN_DEPLOY = `; Source: github.com/tsua0002/btsl-standard — examples/op-return-deploy/schema.bts
VERSION: 1

CONST:
    DUST_LIMIT = 546

PSBT_SCHEMA OP_RETURN_DEPLOY:
    PARAMS:
        @USER:UTXO
        @PAYLOAD:HEX_DATA
        @FEE_RATE:FEERATE

    INPUTS:
        0: NATIVE P2WPKH
            utxo: @USER

    OUTPUTS:
        0: OP_RETURN @PAYLOAD
        1: CHANGE @USER.address change_amount sats

    calc:
        fees = vSize(CURRENT_PSBT) * @FEE_RATE
        change_amount = REF(@USER.amount) - fees

    ASSERT:
        0: change_amount >= DUST_LIMIT`;

const EXAMPLE_TAPROOT_VAULT = `; Source: github.com/tsua0002/btsl-standard — examples/timelocked-vault/schema.bts
VERSION: 1

SCRIPT_DEFS:
    VAULT_P2TR P2TR:
        internal_key: NUMS_KEY
        paths:
            unlock_path SCRIPT:
                leaf_version: 192
                witness:
                asm: 100 OP_CSV OP_DROP OP_CHECKSIG

PSBT_SCHEMA VAULT_DEPOSIT:
    PARAMS:
        @FUNDING_UTXO:UTXO
        @FEE_RATE:FEERATE
        @KEY_PUB:HEX_DATA

    INPUTS:
        0: NATIVE P2WPKH
            utxo: @FUNDING_UTXO

    OUTPUTS:
        0: SCRIPT VAULT_P2TR 100000 sats
            script_params:
                USER_PK = @KEY_PUB
        1: CHANGE @FUNDING_UTXO.address change_amount sats

    calc:
        fees = vSize(CURRENT_PSBT) * @FEE_RATE
        change_amount = REF(@FUNDING_UTXO.amount) - 100000 - fees

    ASSERT:
        0: change_amount >= DUST_LIMIT

PSBT_SCHEMA VAULT_UNLOCK:
    OPTIONS:
        DEPENDS_ON VAULT_DEPOSIT

    PARAMS:
        @USER_ADDR:ADDRESS
        @FEE_RATE:FEERATE
        @USER_KEY:HEX_DATA
        @KEY_PUB:HEX_DATA

    INPUTS:
        0: UNLOCK VAULT_P2TR USING unlock_path:
            utxo: VAULT_DEPOSIT:0.txid:0
            sequence: 100
            script_params:
                USER_PK = @KEY_PUB
            witness_data:
                SIG1 = <SIGN_WITH(@USER_KEY)>

    OUTPUTS:
        0: @USER_ADDR final_payout sats

    calc:
        fees = vSize(CURRENT_PSBT) * @FEE_RATE
        final_payout = REF(VAULT_DEPOSIT:0.amount) - fees

    ASSERT:
        0: final_payout > DUST_LIMIT`;


// Well-known secp256k1 test public keys (generator point and derivatives — demo only, do not use for real funds)
const DEMO_PUBKEY_1 = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const DEMO_PUBKEY_2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const DEMO_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const DEMO_ADDRESS_2 = 'bc1q34aq5drpuwy3wgl9lhup9892qp6svr8ldzyy7c';
const DEMO_FEE_RATE = '5';
const DEMO_OP_RETURN_PAYLOAD = '48656c6c6f2c20576f726c6421';

export const EXAMPLES_CATALOG: ExampleDefinition[] = [
  {
    id: 'simple_payment',
    categoryId: 'simple_payment',
    title: 'Simple Payment',
    subtitle: 'One input, two outputs with CHANGE',
    description: 'Send Bitcoin to a fixed address while returning change to your own wallet. The most common transaction pattern — one input from your key, one payment output, one change output.',
    useCase: 'Sending BTC to a merchant, friend, or exchange deposit address.',
    icon: '💸',
    btsl: EXAMPLE_SIMPLE_PAYMENT,
    quickTutorial: {
      steps: [
        'A demo public key is pre-filled. Replace it with your own compressed pubkey (02/03 + 32 bytes hex) if desired.',
        'Set FEE_RATE (sat/vB) — 5 is pre-filled. Click "Fetch Current" for live network rates.',
        'Click "Fetch from @PUBKEY" to resolve your UTXO from the blockchain via Blockstream API.',
        'Confirm parameters, then generate and run the code to build the PSBT.',
        'Import the PSBT into Sparrow Wallet, Coldcard, or scan the QR code with SeedSigner.',
      ],
      requiredParams: ['@PUBKEY', '@FEE_RATE'],
    },
    prefillParams: {
      PUBKEY: DEMO_PUBKEY_1,
      FEE_RATE: DEMO_FEE_RATE,
    },
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'tri_count',
    categoryId: 'tri_count',
    title: 'TRI-COUNT (Split Bill)',
    subtitle: 'Two inputs, multiple outputs + fees',
    description: 'Coordinate a shared payment where Bob and Caro each contribute funds toward a common expense for Alice, with each receiving change. A declarative multi-party transaction.',
    useCase: 'Splitting a shared bill, group purchases, or on-chain cost-sharing.',
    icon: '🤝',
    btsl: EXAMPLE_TRI_COUNT,
    quickTutorial: {
      steps: [
        'Enter real UTXOs for @BOB_UTXO and @CARO_UTXO (format: txid:vout), then click Fetch for each.',
        'Destination addresses and fee parameters are pre-filled — adjust as needed.',
        "Set @MEAN (shared expense total) and @A2, @A3 (each party's contribution).",
        'Confirm and run to build the multi-party PSBT for coordinated signing.',
      ],
      requiredParams: ['@BOB_UTXO', '@CARO_UTXO', '@FEE_RATE'],
    },
    prefillParams: {
      ALICE_ADDRESS: DEMO_ADDRESS,
      MAKER_ADDRESS: DEMO_ADDRESS_2,
      FEE_RATE: DEMO_FEE_RATE,
      MAKER_FEE: '1000',
      MEAN: '50000',
      A2: '30000',
      A3: '20000',
    },
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'multisig_1_of_2',
    categoryId: 'multisig',
    title: 'Multisig 1-of-2',
    subtitle: 'P2WSH spend — either key can sign',
    description: 'Spend from a 1-of-2 multisig P2WSH output. Either key can sign independently — ideal for backup key scenarios where the primary or recovery key can act alone.',
    useCase: 'Backup key setup: primary or recovery key can spend independently.',
    icon: '🗝️',
    btsl: EXAMPLE_MULTISIG_1OF2,
    quickTutorial: {
      steps: [
        'Enter the multisig UTXO (txid:vout) and click Fetch.',
        'Set @DEST as the destination address — a demo address is pre-filled.',
        'Demo public keys are pre-filled for KEY1 and KEY2 — replace with real signing keys.',
        'Set FEE_RATE and generate the PSBT. Only one of KEY1 or KEY2 needs to sign.',
      ],
      requiredParams: ['@MULTISIG_UTXO', '@DEST', '@FEE_RATE', '@KEY1', '@KEY2'],
    },
    prefillParams: {
      DEST: DEMO_ADDRESS,
      FEE_RATE: DEMO_FEE_RATE,
      KEY1: DEMO_PUBKEY_1,
      KEY2: DEMO_PUBKEY_2,
    },
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'multisig_2_of_2',
    categoryId: 'multisig',
    title: 'Multisig 2-of-2',
    subtitle: 'P2WSH spend — both keys must sign',
    description: 'Spend from a 2-of-2 multisig P2WSH output. Both keys are required to sign — perfect for joint custody, escrow arrangements, or hardware wallet + software 2FA.',
    useCase: 'Joint account, escrow, or two-factor Bitcoin custody.',
    icon: '🔐',
    btsl: EXAMPLE_MULTISIG_2OF2,
    quickTutorial: {
      steps: [
        'Enter the multisig UTXO (txid:vout) and click Fetch.',
        'Set @DEST as the destination address — a demo address is pre-filled.',
        'Demo public keys are pre-filled for KEY1 and KEY2 — replace with your real keys.',
        'Set FEE_RATE and generate the PSBT. Both KEY1 and KEY2 must sign before broadcasting.',
      ],
      requiredParams: ['@MULTISIG_UTXO', '@DEST', '@FEE_RATE', '@KEY1', '@KEY2'],
    },
    prefillParams: {
      DEST: DEMO_ADDRESS,
      FEE_RATE: DEMO_FEE_RATE,
      KEY1: DEMO_PUBKEY_1,
      KEY2: DEMO_PUBKEY_2,
    },
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'op_return_deploy',
    categoryId: 'op_return',
    title: 'OP_RETURN Data Embed',
    subtitle: 'Embed arbitrary data on-chain + CHANGE',
    description: 'Publish arbitrary hex data in an OP_RETURN output permanently stored on the Bitcoin blockchain. Used for protocol messages, timestamps, content hashes, and metadata.',
    useCase: 'On-chain data anchoring, protocol deployments, or timestamping.',
    icon: '📝',
    btsl: EXAMPLE_OP_RETURN_DEPLOY,
    quickTutorial: {
      steps: [
        'Enter a funding UTXO (@USER in txid:vout format) and click Fetch.',
        'A demo payload (hex-encoded "Hello, World!") is pre-filled in @PAYLOAD.',
        'Set FEE_RATE and generate the PSBT.',
        'After signing and broadcasting, verify the embedded data on Blockstream Explorer.',
      ],
      requiredParams: ['@USER', '@PAYLOAD', '@FEE_RATE'],
    },
    prefillParams: {
      PAYLOAD: DEMO_OP_RETURN_PAYLOAD,
      FEE_RATE: DEMO_FEE_RATE,
    },
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'taproot_vault',
    categoryId: 'taproot_vault',
    title: 'Taproot Time-lock Vault',
    subtitle: 'VAULT_DEPOSIT → VAULT_UNLOCK (100-block CSV)',
    description: 'A two-step workflow: deposit into a Taproot vault with a 100-block CSV timelock, then unlock after the timelock expires. Demonstrates BTSL multi-schema DEPENDS_ON chaining.',
    useCase: 'Cold storage vault, savings protocol, or time-delayed Bitcoin custody.',
    icon: '🏦',
    btsl: EXAMPLE_TAPROOT_VAULT,
    quickTutorial: {
      steps: [
        'Step 1 — VAULT_DEPOSIT: Enter @FUNDING_UTXO and @KEY_PUB (your pubkey), then generate and sign the deposit PSBT.',
        'After broadcasting the deposit, paste the confirmed txid into Card 4 to unlock Step 2.',
        'Step 2 — VAULT_UNLOCK (after 100 blocks): Set @USER_ADDR, @USER_KEY, and @KEY_PUB.',
        'Generate, sign, and broadcast the unlock PSBT to withdraw your funds.',
      ],
      requiredParams: ['@FUNDING_UTXO', '@KEY_PUB', '@USER_ADDR', '@USER_KEY', '@FEE_RATE'],
    },
    prefillParams: {
      KEY_PUB: DEMO_PUBKEY_1,
      USER_ADDR: DEMO_ADDRESS,
      USER_KEY: DEMO_PUBKEY_1,
      FEE_RATE: DEMO_FEE_RATE,
    },
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
];

export const EXAMPLES_CATALOG_BY_CATEGORY: Record<ExampleCategoryId, ExampleDefinition[]> = {
  simple_payment: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'simple_payment'),
  tri_count: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'tri_count'),
  multisig: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'multisig'),
  op_return: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'op_return'),
  taproot_vault: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'taproot_vault'),
};
