import { buildBrc20SwapChainBtsl, BRC20_SWAP_DEMO_PARAMS } from './brc20-swap-chain';

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
  /**
   * Full `.params`-style fixture for one-click demo loading (comments with `#` OK).
   * Use chain-checked values that are not spendable without the real keys.
   */
  demoParamsTemplate?: string;
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
        fees_bob = fees / 2
        fees_caro = fees - fees_bob
        maker_fee_val = @MAKER_FEE
        c_bob  = REF(@BOB_UTXO.amount) - (@MEAN - @A2) - fees_bob
        c_caro = REF(@CARO_UTXO.amount) - (@MEAN - @A3) - fees_caro

    ASSERT:
        0: c_bob >= DUST_LIMIT
        1: c_caro >= DUST_LIMIT
        2: payment >= DUST_LIMIT
        3: REF(@BOB_UTXO.amount) >= (@MEAN - @A2) + fees_bob
        4: REF(@CARO_UTXO.amount) >= (@MEAN - @A3) + fees_caro`;

const EXAMPLE_MULTISIG_2OF2 = `; Source: github.com/tsua0002/btsl-standard — examples/multisig-2-of-2/schema.bts
VERSION: 1

CONST:
    DUST_LIMIT = 546

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
/** OP_RETURN_DEPLOY demo — BTSL tagline as raw hex (HEX_DATA; length > 75 B exercises OP_PUSHDATA1). */
const DEMO_OP_RETURN_PAYLOAD_HEX =
  '426974636f696e205472616e73616374696f6e20536368656d61204c616e6775616765200a4b6e6f77207768617420796f75207369676e2e0a41206465636c617261746976652076616c69646174696f6e206c6179657220666f72205053425420776f726b666c6f77732e';

/** Fixture: real UTXO / pubkeys for UI demo — not signable without those private keys. */
const DEMO_PARAMS_MULTISIG_SPEND = `# TEMPLATE - NOT SIGNABLE

MULTISIG_UTXO=871baebc9d501bc0fbdd148901e2a3b14e2f4144c9e396e8d018d2c97c6da5fe:0
DEST=1BitcoinEaterAddressDontSendf59kuE

FEE_RATE=3

# Uncompressed secp256k1 pubkeys (04 + x + y), hex — demo fixture only
KEY1=046cdf0f7b00338184ce9d3d2ca0795555a112455901206c5ed9a65118f79dff7276bdbff536ce723df811640939746279cafc76cf5ac71ca99768fa7b4d135ec4
KEY2=0455cf4a3ab68a011b18cb0a86aae2b8e9cad6c6355476de05247c57a9632d127084ac7630ad89893b43c486c5a9f7ec6158fb0feb708fa9255d5c4d44bc0858f8
`;

/** Compressed pubkey shared by Simple Payment prefill + demo `.params` (Blockstream UTXO lookup). */
const DEMO_SIMPLE_PAYMENT_PUBKEY = '0283409659355b6d1cc3c32decd5d561abaac86c37a353b52895a5e6c196d6f448';

/** PUBKEY_SPEND — demo fixture; not signable without this key's private key. */
const DEMO_PARAMS_SIMPLE_PAYMENT = `# TEMPLATE - NOT SIGNABLE

FEE_RATE=2
# Signing key for USER_SIG path (HEX_DATA)
PUBKEY=${DEMO_SIMPLE_PAYMENT_PUBKEY}
`;

/** TRICOUNT — demo fixture (mainnet UTXO refs + addresses; signable only with the real keys). */
const DEMO_PARAMS_TRI_COUNT = `# TEMPLATE

BOB_UTXO=d85a3b216f8d8fb27c83d340649966e0b1ae3124bcd8373ffb6284dd775c49e8:0
CARO_UTXO=0f0fbcc18fd0d090ad3402574df8404cec1176bc000f9aa0dc19f8d832ff94db:0

ALICE_ADDRESS=1BitcoinEaterAddressDontSendf59kuE
MAKER_ADDRESS=1SatoshihTC26vJYKQYfdADhTwuCnUkto

FEE_RATE=5
MAKER_FEE=1000
MEAN=2300
A2=1800
A3=2100
`;

/** OP_RETURN_DEPLOY — demo fixture (mainnet UTXO ref + payload hex; needs wallet value for change ≥ dust after fee). */
const DEMO_PARAMS_OP_RETURN_DEPLOY = `# TEMPLATE

USER=3387418aaddb4927209c5032f515aa442a6587d6e54677f08a03b8fa7789e688:1

# Small OP_RETURN payload as HEX_DATA
PAYLOAD=${DEMO_OP_RETURN_PAYLOAD_HEX}

FEE_RATE=2
`;

/** Taproot timelock vault — demo `.params` (mainnet funding UTXO + shared P2TR demo keys). */
const DEMO_PARAMS_TAPROOT_VAULT = `# TEMPLATE

# For VAULT_DEPOSIT
FUNDING_UTXO=89336a85c8fbb0062c7cbc4be15266862551e7d6f803497d5fc26ad46ed98524:0
FEE_RATE=2

# Shared public key used in SCRIPT_DEFS (HEX_DATA, 33-byte compressed)
KEY_PUB=0241571c22eb9e02bbeed15d5b1d65c8cb36f26f1926cf7cf65ac4f5461ae6f55a

# For VAULT_UNLOCK
USER_ADDR=bc1phfn9d9egs8qrmxlxth6fc84wpwuu4n2ztqy4m0ac8kxmqcyauegqp8uc6y

# Signing key for USER_SIG path (HEX_DATA)
USER_KEY=0241571c22eb9e02bbeed15d5b1d65c8cb36f26f1926cf7cf65ac4f5461ae6f55a
`;

/** Align prefill with DEMO_PARAMS_TAPROOT_VAULT (FEE_RATE used for both steps). */
const DEMO_VAULT_PREFILL_KEY =
  '0241571c22eb9e02bbeed15d5b1d65c8cb36f26f1926cf7cf65ac4f5461ae6f55a';
const DEMO_VAULT_USER_ADDR = 'bc1phfn9d9egs8qrmxlxth6fc84wpwuu4n2ztqy4m0ac8kxmqcyauegqp8uc6y';

export const EXAMPLES_CATALOG: ExampleDefinition[] = [
  {
    id: 'simple_payment',
    categoryId: 'simple_payment',
    title: 'Simple Payment',
    subtitle: 'One input, two outputs with CHANGE',
    description: 'Send Bitcoin to a fixed address while returning change to your own wallet. The most common transaction pattern — one input from your key, one payment output, one change output.',
    useCase: 'Sending BTC to a merchant, friend, or exchange deposit address.',
    icon: '',
    btsl: EXAMPLE_SIMPLE_PAYMENT,
    quickTutorial: {
      steps: [
        'A demo compressed pubkey is pre-filled (same as "Load demo fixture"). The playground auto-fetches a mainnet UTXO for it; replace with your own 02/03… key if you like.',
        'Set FEE_RATE (sat/vB) — 2 is pre-filled (demo). Click "Fetch Current" for live network rates.',
        'Optional: click "Fetch from @PUBKEY" again after changing the key (auto-fetch also runs after edits).',
        'Confirm parameters, then generate and run the code to build the PSBT.',
        'Import the PSBT into Sparrow Wallet, Coldcard, or scan the QR code with SeedSigner.',
      ],
      requiredParams: ['@PUBKEY', '@FEE_RATE'],
    },
    prefillParams: {
      PUBKEY: DEMO_SIMPLE_PAYMENT_PUBKEY,
      /** Same pubkey as `demoParamsTemplate` so Quick Start matches "Load demo fixture". */
      FEE_RATE: '2',
    },
    demoParamsTemplate: DEMO_PARAMS_SIMPLE_PAYMENT,
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'tri_count',
    categoryId: 'tri_count',
    title: 'TRI-COUNT (Split Bill)',
    subtitle: 'Two inputs, multiple outputs + fees',
    description: 'Coordinate a shared payment where Bob and Caro each contribute funds toward a common expense for Alice, with each receiving change. A declarative multi-party transaction.',
    useCase: 'Splitting a shared bill, group purchases, or on-chain cost-sharing.',
    icon: '',
    btsl: EXAMPLE_TRI_COUNT,
    quickTutorial: {
      steps: [
        'Use “Load demo fixture” to paste the bundled `.params` (UTXOs, addresses, MEAN/A2/A3) and auto-fetch chain amounts, or enter your own `txid:vout` and Fetch.',
        'Adjust @FEE_RATE / @MAKER_FEE / bill split if needed — demo uses MEAN=2300, A2=1800, A3=2100 so `payment` clears dust.',
        'Confirm parameters, then run to build the multi-party PSBT for coordinated signing.',
      ],
      requiredParams: ['@BOB_UTXO', '@CARO_UTXO', '@FEE_RATE'],
    },
    prefillParams: {
      /** Match demoParamsTemplate so Quick Start matches “Load demo fixture”. */
      ALICE_ADDRESS: '1BitcoinEaterAddressDontSendf59kuE',
      MAKER_ADDRESS: '1SatoshihTC26vJYKQYfdADhTwuCnUkto',
      FEE_RATE: '5',
      MAKER_FEE: '1000',
      MEAN: '2300',
      A2: '1800',
      A3: '2100',
    },
    demoParamsTemplate: DEMO_PARAMS_TRI_COUNT,
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'multisig_1_of_2',
    categoryId: 'multisig',
    title: 'Multisig 1-of-2',
    subtitle: 'P2WSH spend — either key can sign',
    description: 'Spend from a 1-of-2 multisig P2WSH output. Either key can sign independently — ideal for backup key scenarios where the primary or recovery key can act alone.',
    useCase: 'Backup key setup: primary or recovery key can spend independently.',
    icon: '',
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
    demoParamsTemplate: DEMO_PARAMS_MULTISIG_SPEND,
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'multisig_2_of_2',
    categoryId: 'multisig',
    title: 'Multisig 2-of-2',
    subtitle: 'P2WSH spend — both keys must sign',
    description: 'Spend from a 2-of-2 multisig P2WSH output. Both keys are required to sign — perfect for joint custody, escrow arrangements, or hardware wallet + software 2FA.',
    useCase: 'Joint account, escrow, or two-factor Bitcoin custody.',
    icon: '',
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
    demoParamsTemplate: DEMO_PARAMS_MULTISIG_SPEND,
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'op_return_deploy',
    categoryId: 'op_return',
    title: 'OP_RETURN Data Embed',
    subtitle: 'Embed arbitrary data on-chain + CHANGE',
    description: 'Publish arbitrary hex data in an OP_RETURN output permanently stored on the Bitcoin blockchain. Used for protocol messages, timestamps, content hashes, and metadata.',
    useCase: 'On-chain data anchoring, protocol deployments, or timestamping.',
    icon: '',
    btsl: EXAMPLE_OP_RETURN_DEPLOY,
    quickTutorial: {
      steps: [
        'Use “Load demo fixture” for bundled USER + PAYLOAD hex + FEE_RATE, then Fetch @USER.',
        '@PAYLOAD is hex-encoded text (>75 B); leave “Treat as text” off so it stays raw HEX_DATA.',
        'Confirm and run — OP_RETURN uses standard push encoding (OP_PUSHDATA1 when needed).',
        'After broadcast, verify the decoded message in the explorer.',
      ],
      requiredParams: ['@USER', '@PAYLOAD', '@FEE_RATE'],
    },
    prefillParams: {
      PAYLOAD: DEMO_OP_RETURN_PAYLOAD_HEX,
      FEE_RATE: '2',
    },
    demoParamsTemplate: DEMO_PARAMS_OP_RETURN_DEPLOY,
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'brc20_swap_chain',
    categoryId: 'op_return',
    title: 'Chained OP_RETURN (5 PSBTs)',
    subtitle: 'SWAP_1 → SWAP_5 — JSON payload + P2TR change',
    description:
      'Five chained PSBTs: each step embeds a JSON OP_RETURN and spends the previous change. Build unsigned PSBTs in order (parent need not be broadcast), sign, then broadcast SWAP_1…SWAP_5.',
    useCase: 'Multi-tx protocols that must be signed as a package before any parent is confirmed.',
    icon: '',
    btsl: buildBrc20SwapChainBtsl(5),
    quickTutorial: {
      steps: [
        'Paste your USER_UTXO into the demo fixture (empty by default). Check “Treat as text” on @PAYLOAD. Load demo fixture.',
        'Fetch @USER_UTXO, Confirm, generate SWAP_1. The playground stores a predicted txid from the unsigned PSBT.',
        'Use “Generate remaining unsigned PSBTs”, or switch schemas, keep/paste the parent txid, Confirm, generate the next hop.',
        'Sign each PSBT, then broadcast SWAP_1 through SWAP_5 in order.',
      ],
      requiredParams: ['@USER_UTXO', '@PAYLOAD', '@FEE_RATE', '@CHANGE_ADDRESS'],
    },
    prefillParams: {
      PAYLOAD: '{"p":"brc-20","op":"swap","tick":"DEMO","amt":"1"}',
      FEE_RATE: '1.2',
    },
    demoParamsTemplate: BRC20_SWAP_DEMO_PARAMS,
    explorerLinkTemplate: 'https://blockstream.info/tx/{txid}',
  },
  {
    id: 'taproot_vault',
    categoryId: 'taproot_vault',
    title: 'Taproot Time-lock Vault',
    subtitle: 'VAULT_DEPOSIT → VAULT_UNLOCK (100-block CSV)',
    description: 'A two-step workflow: deposit into a Taproot vault with a 100-block CSV timelock, then unlock after the timelock expires. Demonstrates BTSL multi-schema DEPENDS_ON chaining.',
    useCase: 'Cold storage vault, savings protocol, or time-delayed Bitcoin custody.',
    icon: '',
    btsl: EXAMPLE_TAPROOT_VAULT,
    quickTutorial: {
      steps: [
        'Use “Load demo fixture” for FUNDING_UTXO, KEY_PUB, USER_ADDR, USER_KEY, and FEE_RATE=2; Fetch @FUNDING_UTXO.',
        'Step 1 — VAULT_DEPOSIT: Confirm, run, sign/broadcast; save the parent txid in Card 4.',
        'Step 2 — Switch to VAULT_UNLOCK (after 100 confirmations for CSV 100), Resolve/Fetch workflow UTXO, Confirm, run unlock PSBT.',
      ],
      requiredParams: ['@FUNDING_UTXO', '@KEY_PUB', '@USER_ADDR', '@USER_KEY', '@FEE_RATE'],
    },
    prefillParams: {
      KEY_PUB: DEMO_VAULT_PREFILL_KEY,
      USER_ADDR: DEMO_VAULT_USER_ADDR,
      USER_KEY: DEMO_VAULT_PREFILL_KEY,
      FEE_RATE: '2',
    },
    demoParamsTemplate: DEMO_PARAMS_TAPROOT_VAULT,
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
