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
  btsl: string;
  quickTutorial: {
    steps: string[];
    requiredParams: string[];
  };
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

export const EXAMPLES_CATALOG: ExampleDefinition[] = [
  {
    id: 'simple_payment',
    categoryId: 'simple_payment',
    title: 'Simple Payment',
    subtitle: 'One input, two outputs with CHANGE',
    btsl: EXAMPLE_SIMPLE_PAYMENT,
    quickTutorial: {
      steps: [
        'Paste a PUBKEY (33-byte hex starting with 02/03).',
        'Set FEE_RATE (sat/vB).',
        'Click “Fetch from @PUBKEY”.',
        'Confirm parameters, then run the code to export the PSBT.',
      ],
      requiredParams: ['@PUBKEY', '@FEE_RATE'],
    },
  },
  {
    id: 'tri_count',
    categoryId: 'tri_count',
    title: 'TRI-COUNT (Multi-inputs)',
    subtitle: 'Two inputs, multiple outputs + fees',
    btsl: EXAMPLE_TRI_COUNT,
    quickTutorial: {
      steps: [
        'Set both UTXOs (@BOB_UTXO and @CARO_UTXO).',
        'Fill destination addresses and fee parameters.',
        'Click “Fetch” for each UTXO if you use the manual input box.',
        'Run to export the PSBT.',
      ],
      requiredParams: ['@BOB_UTXO', '@CARO_UTXO', '@FEE_RATE'],
    },
  },
  {
    id: 'multisig_1_of_2',
    categoryId: 'multisig',
    title: 'Multisig 1-of-2',
    subtitle: 'P2WSH spend using a 1-of-2 multisig template',
    btsl: EXAMPLE_MULTISIG_1OF2,
    quickTutorial: {
      steps: [
        'Set the multisig UTXO and destination address.',
        'Provide KEY1/KEY2 (HEX_DATA).',
        'Set FEE_RATE and run to export the PSBT.',
      ],
      requiredParams: ['@MULTISIG_UTXO', '@DEST', '@FEE_RATE', '@KEY1', '@KEY2'],
    },
  },
  {
    id: 'multisig_2_of_2',
    categoryId: 'multisig',
    title: 'Multisig 2-of-2',
    subtitle: 'P2WSH spend using a 2-of-2 multisig template',
    btsl: EXAMPLE_MULTISIG_2OF2,
    quickTutorial: {
      steps: [
        'Set the multisig UTXO and destination address.',
        'Provide KEY1/KEY2 (HEX_DATA).',
        'Set FEE_RATE and run to export the PSBT.',
      ],
      requiredParams: ['@MULTISIG_UTXO', '@DEST', '@FEE_RATE', '@KEY1', '@KEY2'],
    },
  },
  {
    id: 'op_return_deploy',
    categoryId: 'op_return',
    title: 'OP_RETURN Deploy',
    subtitle: 'OP_RETURN output + CHANGE',
    btsl: EXAMPLE_OP_RETURN_DEPLOY,
    quickTutorial: {
      steps: [
        'Provide a funding UTXO (@USER).',
        'Set @PAYLOAD as HEX_DATA.',
        'Set FEE_RATE.',
        'Click Fetch (UTXO) and run to export the PSBT.',
      ],
      requiredParams: ['@USER', '@PAYLOAD', '@FEE_RATE'],
    },
  },
  {
    id: 'taproot_vault',
    categoryId: 'taproot_vault',
    title: 'Taproot Vault (Workflow)',
    subtitle: 'VAULT_DEPOSIT then VAULT_UNLOCK (DEPENDS_ON)',
    btsl: EXAMPLE_TAPROOT_VAULT,
    quickTutorial: {
      steps: [
        'Run VAULT_DEPOSIT first and set the parent txid in Card 4.',
        'Unlock step becomes available after that.',
        'Run VAULT_UNLOCK and export the PSBT.',
      ],
      requiredParams: ['@FUNDING_UTXO', '@KEY_PUB', '@USER_ADDR', '@USER_KEY'],
    },
  },
];

export const EXAMPLES_CATALOG_BY_CATEGORY: Record<ExampleCategoryId, ExampleDefinition[]> = {
  simple_payment: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'simple_payment'),
  tri_count: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'tri_count'),
  multisig: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'multisig'),
  op_return: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'op_return'),
  taproot_vault: EXAMPLES_CATALOG.filter((e) => e.categoryId === 'taproot_vault'),
};

