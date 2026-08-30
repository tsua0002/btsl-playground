// BTSL Type Definitions

export type ParamType = 'UTXO' | 'ADDRESS' | 'FEERATE' | 'HEX_DATA' | 'SATOSHI' | 'PUBKEY' | 'UNTYPED';

export interface BTSLParam {
  name: string;
  type: ParamType;
  value?: string | number;
}

export interface BTSLConst {
  name: string;
  value: number | string;
}

export interface BTSLInput {
  index: number;
  type?: 'NATIVE_P2PKH' | 'NATIVE_P2WPKH' | 'NATIVE_P2TR_KEY' | 'UNLOCK_P2WSH' | 'UNLOCK_P2TR_SCRIPT';
  utxoRef: string;
  /** When set, this input's UTXO comes from a prior schema output (workflow_ref). */
  workflowRef?: WorkflowOutputRef;
  /** When set, UTXO is resolved from this pubkey param (e.g. @PUBKEY) */
  fromRef?: string;
  /** Alias for the resolved UTXO used in calc/outputs (e.g. selected_utxo) */
  utxoAlias?: string;
  scriptDef?: string;
  scriptPath?: string;
  sequence?: number;
  scriptParams?: Record<string, string>;
  witnessData?: Record<string, string>;
}

export interface BTSLOutput {
  index: number;
  type: 'ADDRESS' | 'CHANGE' | 'SCRIPT' | 'OP_RETURN';
  address?: string;
  amount?: string | number;
  amountVar?: string; // calc variable or @PARAM reference for amount
  amountIsParam?: boolean; // true if amountVar is a @PARAM reference
  scriptDef?: string;
  scriptParams?: Record<string, string>;
  payload?: string;
}

export interface BTSLCalcAssignment {
  variable: string;
  expression: string;
}

export interface BTSLAssertion {
  index: number;
  condition: string;
  source: string;
}

export interface BTSLScriptPath {
  name: string;
  leafVersion: number;
  witness: string[];
  asm: string[];
}

export interface BTSLScriptDef {
  name: string;
  type: 'P2TR' | 'P2WSH' | 'P2SH';
  internalKey?: string;
  paths?: BTSLScriptPath[];
  asm?: string[];
}

export interface BTSLOptions {
  dependsOn?: string;
  [key: string]: string | undefined;
}

export interface BTSLSchema {
  name: string;
  params: BTSLParam[];
  /** Schema-level constants (e.g. PAYMENT_ADDRESS, AMOUNT) */
  consts?: BTSLConst[];
  options?: BTSLOptions;
  inputs: BTSLInput[];
  outputs: BTSLOutput[];
  calc: BTSLCalcAssignment[];
  asserts: BTSLAssertion[];
}

export interface BTSLDocument {
  version: number;
  consts: BTSLConst[];
  scriptDefs: BTSLScriptDef[];
  schemas: BTSLSchema[];
}

export interface ParseResult {
  success: boolean;
  document?: BTSLDocument;
  params?: BTSLParam[];
  errors: BTSLError[];
  warnings: BTSLWarning[];
}

export interface BTSLError {
  code: string;
  message: string;
  line?: number;
}

export interface BTSLWarning {
  code: string;
  message: string;
  line?: number;
}

export interface ResolvedUTXO {
  txid: string;
  vout: number;
  value: number;
  scriptPubKey: string;
  scriptType: 'P2PKH' | 'P2WPKH' | 'P2TR' | 'P2WSH' | 'P2SH' | 'UNKNOWN';
  address?: string;
}

export interface BoundParams {
  [key: string]: {
    type: ParamType;
    rawValue: string;
    resolved?: ResolvedUTXO | number | string;
    /** When true, OP_RETURN payload is treated as UTF-8 text and converted to hex */
    payloadAsText?: boolean;
  };
}

export interface WorkflowOutputRef {
  schemaName: string;
  outputIndex: number;
  vout: number;
}

export interface WorkflowSchemaResult {
  /** Optional txid provided after signing/broadcasting this step. */
  txid?: string;
  /** Outputs as computed by the schema execution (sats). */
  outputs?: Array<{
    index: number;
    valueSats: string;
    address?: string;
    /** Parent output scriptPubKey hex — used to chain the next PSBT before broadcast. */
    scriptPubKey?: string;
  }>;
}

/** In-memory workflow state for multi-schema BTSL documents. */
export interface WorkflowContext {
  /** schemaName -> results (outputs, txid) */
  steps: Record<string, WorkflowSchemaResult>;
}

/** Convert payload string to hex for OP_RETURN: asText = UTF-8 encode then hex, else strip 0x and use as hex */
export function toPayloadHex(raw: string, asText: boolean): string {
  if (asText) {
    const bytes = new TextEncoder().encode(raw);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  const s = raw.startsWith('0x') ? raw.slice(2) : raw;
  return s.replace(/\s/g, '');
}

// Error codes — aligned with BTSL v1.0.0 spec §5.3
export const ERROR_CODES: Record<string, string> = {
  'BTSL_ERR_00':
    'Syntax error — .bts unparsable, or PSBT decode failure; not used for PSBT-vs-schema shape (see ERR_13)',
  'BTSL_ERR_01':
    'Type mismatch — Checker I-1 (native type vs chain) or I-4 (nSequence vs schema / §9.5)',
  'BTSL_ERR_02':
    'Binding failure — I-1/I-2 script binding, or O-1 PSBT output scriptPubKey ≠ schema-derived script',
  'BTSL_ERR_03': 'Circular dependency — mutual DEPENDS_ON detected',
  'BTSL_ERR_04a': 'Invalid derived field — manual input of calculated field (e.g., control_block)',
  'BTSL_ERR_04b': 'Undeclared param — reference to undeclared @PARAM',
  'BTSL_ERR_04c': 'Invalid script type — unrecognized script type',
  'BTSL_ERR_04d': 'Forward reference in calc — variable used before declaration',
  'BTSL_ERR_04e':
    'Invalid Pubkey param — @PARAM is not a valid 33-byte compressed key or From() used on non-Pubkey',
  'BTSL_ERR_05':
    'Unresolved dependency — REF/SUM on missing data, or I-2 Case C parent workflow not broadcast',
  'BTSL_ERR_06':
    'Assert failure — ASSERT false, balance invariant (A-3), or O-2 output amount ≠ calc/schema',
  'BTSL_ERR_07': 'Dust output — standard/SCRIPT output below DUST_LIMIT',
  'BTSL_ERR_08': 'Arithmetic error — division by zero, overflow, or negative SAT in calc (A-1)',
  'BTSL_ERR_09': 'UTXO resolution failure — From() could not find a confirmed UTXO for the given Pubkey',
  'BTSL_ERR_10':
    'Witness binding mismatch — witness_data vs witness: placeholders (P2TR paths with witness: block)',
  'BTSL_ERR_11': 'Prevout value mismatch — I-3: PSBT input amount ≠ independently fetched chain value',
  'BTSL_ERR_12':
    'Outpoint mismatch — I-2 Case A (params) or Case C (confirmed parent vs PSBT prevout)',
  'BTSL_ERR_13': 'Schema mismatch — S-1/S-2: PSBT input/output count ≠ schema (fast-fail)',
};

export const WARNING_CODES: Record<string, string> = {
  'BTSL_WARN_01': 'Unknown section — ignored during compilation',
  'BTSL_WARN_02': 'Non-sequential assert — ASSERT indices not sequential',
  'BTSL_WARN_03': 'Untyped param — @PARAM without type, degraded to flexible mode',
  'BTSL_WARN_04': 'OP_RETURN relay risk — payload exceeds 80 bytes and may be rejected by some nodes',
  'BTSL_WARN_05': 'Key path enabled — internal_key for P2TR is a real key (NUMS_KEY not used)',
  'BTSL_WARN_06': 'Missing fees declaration — no calc variable named fees, balance invariant check skipped',
  'BTSL_WARN_07': 'Exceeds standard weight — computed tx_weight exceeds 400,000 wu',
  'BTSL_WARN_08': 'Inferred pubkey type — From() used without NATIVE hint, defaulting to P2TR',
};

/** Spec §3.5 reference; runtime fees use precise BIP-141 sizing (see lib/btsl/precise-weight.ts). */
export const WEIGHT_CONSTANTS = {
  BASE_TX_OVERHEAD: 40,
  SEGWIT_OVERHEAD: 2,
};

export const DUST_LIMIT = 546;

/**
 * Extra virtual bytes applied only in calc (not ASSERT) for vSize(CURRENT_PSBT) when
 * budgeting fees — ensures implicit fee rate ≥ declared sat/vB vs explorer / relay variance.
 */
export const FEE_BUDGET_VSIZE_SLACK_VB = 2;
