// BTSL Code Generator - Generates JavaScript for PSBT construction
import type {
  BTSLDocument,
  BTSLSchema,
  BTSLInput,
  BTSLOutput,
  BTSLParam,
  BTSLScriptDef,
  BoundParams,
  WorkflowContext,
} from './types';
import { DUST_LIMIT, toPayloadHex, FEE_BUDGET_VSIZE_SLACK_VB } from './types';
import { compileScriptAsmToHex } from './script-compiler';
import { parseMultisigMFromAsm } from './multisig-m';

/** Precise vsize via bitcoin.Transaction.virtualSize() (real scriptPubKeys + placeholder witnesses). */
function generatePreciseVsizeBlock(
  schema: BTSLSchema,
  constsMap: Record<string, number | string>,
  document: BTSLDocument,
  boundParams: BoundParams
): string {
  const findScriptDef = (name: string) => document.scriptDefs.find((d) => d.name === name);

  const outLines: string[] = [];
  for (const output of schema.outputs) {
    if (output.type === 'OP_RETURN') {
      const raw = (output.payload ?? '').trim();
      if (raw.startsWith('@')) {
        const paramName = raw.replace(/^@/, '').trim();
        outLines.push(
          `(function () {
    const p = boundParams[${JSON.stringify(paramName)}];
    const v = String(p?.rawValue ?? (typeof p?.resolved === 'string' ? p.resolved : '') ?? '');
    const asText = Boolean(p?.payloadAsText);
    let pb;
    if (asText) pb = new Uint8Array(new TextEncoder().encode(v));
    else {
      const h = (v.startsWith('0x') ? v.slice(2) : v).replace(/\\s/g, '');
      if (!h || h.length % 2) pb = new Uint8Array(0);
      else pb = Uint8Array.from(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
    }
    __outs.push(Buffer.concat([Buffer.from([0x6a, pb.length]), Buffer.from(pb)]));
  })();`
        );
      } else {
        let payloadHex = '';
        if (raw.startsWith('"') && raw.endsWith('"')) {
          payloadHex = toPayloadHex(raw.slice(1, -1).replace(/\\"/g, '"'), true);
        } else {
          payloadHex = toPayloadHex(raw, false);
        }
        const len = payloadHex.length / 2;
        outLines.push(
          `__outs.push(Buffer.concat([Buffer.from([0x6a, ${len}]), Buffer.from("${payloadHex}", "hex")]));`
        );
      }
    } else if (output.type === 'SCRIPT' && output.scriptDef) {
      const def = findScriptDef(output.scriptDef);
      if (def) {
        try {
          const sh = compileScriptAsmToHex(def, boundParams, output.scriptParams);
          outLines.push(
            `__outs.push(bitcoin.payments.p2wsh({ redeem: { output: Buffer.from("${sh}", "hex") }, network: __net }).output);`
          );
        } catch {
          outLines.push(`__outs.push(Buffer.alloc(34, 0));`);
        }
      } else {
        outLines.push(`__outs.push(Buffer.alloc(34, 0));`);
      }
    } else if (output.type === 'ADDRESS') {
      const addr = output.address ?? '';
      if (addr.startsWith('@')) {
        const key = addr.replace(/^@/, '').split('.')[0];
        outLines.push(
          `__outs.push(bitcoin.address.toOutputScript(String(boundParams[${JSON.stringify(key)}]?.resolved?.address || boundParams[${JSON.stringify(key)}]?.rawValue || ''), __net));`
        );
      } else if (typeof constsMap[addr] === 'string') {
        outLines.push(
          `__outs.push(bitcoin.address.toOutputScript(${JSON.stringify(constsMap[addr])}, __net));`
        );
      } else if (addr.startsWith('"')) {
        outLines.push(`__outs.push(bitcoin.address.toOutputScript(${addr}, __net));`);
      } else {
        outLines.push(`__outs.push(Buffer.alloc(34, 0));`);
      }
    } else if (output.type === 'CHANGE') {
      const ref = (output.address ?? '').replace(/^@/, '').replace(/\.[a-z]+$/, '');
      outLines.push(
        `__outs.push(bitcoin.address.toOutputScript(String(boundParams[${JSON.stringify(ref)}]?.resolved?.address || ''), __net));`
      );
    }
  }

  const inLines: string[] = [];
  schema.inputs.forEach((input, idx) => {
    const seq = input.sequence ?? 0xffffffff;
    let witnessScriptHex: string | null = null;
    if (input.type === 'UNLOCK_P2WSH' && input.scriptDef) {
      const sd = findScriptDef(input.scriptDef);
      if (sd) {
        try {
          witnessScriptHex = compileScriptAsmToHex(sd, boundParams, input.scriptParams);
        } catch {
          witnessScriptHex = null;
        }
      }
    }
    if (input.type === 'NATIVE_P2PKH') {
      inLines.push(
        `{ const h = Buffer.alloc(32); h.writeUInt32LE(${idx}, 0); tx.addInput(h, 0, ${seq}, Buffer.alloc(107, 0)); }`
      );
    } else {
      inLines.push(
        `{ const h = Buffer.alloc(32); h.writeUInt32LE(${idx}, 0); tx.addInput(h, 0, ${seq}, Buffer.alloc(0));`
      );
      if (input.type === 'UNLOCK_P2WSH' && witnessScriptHex) {
        const m = parseMultisigMFromAsm(findScriptDef(input.scriptDef!)?.asm);
        const sigs = Array.from({ length: m }, () => 'Buffer.alloc(73, 0)').join(', ');
        inLines.push(
          `  tx.setWitness(${idx}, [Buffer.alloc(0), ${sigs}, Buffer.from("${witnessScriptHex}", "hex")]);`
        );
      } else if (input.type === 'NATIVE_P2TR_KEY') {
        inLines.push(`  tx.setWitness(${idx}, [Buffer.alloc(64, 0)]);`);
      } else if (input.type === 'UNLOCK_P2TR_SCRIPT') {
        inLines.push(
          `  tx.setWitness(${idx}, [Buffer.alloc(64, 0), Buffer.alloc(100, 0), Buffer.alloc(33, 0)]);`
        );
      } else {
        inLines.push(
          `  tx.setWitness(${idx}, [Buffer.alloc(73, 0), Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 0)])]);`
        );
      }
      inLines.push(`}`);
    }
  });

  return `
  // Phase 3 — Precise vsize: real output scripts + standard placeholder witnesses (BIP-141)
  const __net = bitcoin.networks.bitcoin;
  const __outs = [];
  ${outLines.join('\n  ')}
  function __preciseMetrics() {
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.locktime = 0;
    ${inLines.join('\n    ')}
    for (const sc of __outs) {
      if (sc && sc.length > 0) tx.addOutput(sc, BigInt(1000));
    }
    return { vsize: tx.virtualSize(), weight: tx.weight() };
  }
  const __pm = __preciseMetrics();
  const vsize = __pm.vsize;
  const tx_weight = __pm.weight;
  console.log('[v0] Precise vsize:', vsize, 'vB, weight:', tx_weight, 'wu');
`;
}

// Generate expression evaluation code
// context: 'calc' for calc block (use calcVars prefix), 'assert' for assert block
function generateExpressionEval(
  expr: string,
  consts: Record<string, number | string>,
  calcVarNames: string[] = [],
  context: 'calc' | 'assert' = 'calc',
  utxoAliases: string[] = [],
  /** When assigning to `fees`, vSize uses slack for relay-safe min fee rate */
  calcAssignVariable?: string
): string {
  let result = expr;

  // UTXO alias refs (From(@X) AS alias): alias.amount -> boundParams["alias"].resolved.value
  for (const alias of utxoAliases) {
    result = result.replace(new RegExp(`\\b${alias}\\.amount\\b`, 'g'), `boundParams["${alias}"].resolved.value`);
    result = result.replace(new RegExp(`\\b${alias}\\.address\\b`, 'g'), `boundParams["${alias}"].resolved.address`);
  }

  // Replace REF() function calls FIRST (before other replacements)
  result = result.replace(/REF\(@([A-Z][A-Za-z0-9_]*)\.amount\)/g, 'boundParams["$1"].resolved.value');
  result = result.replace(/REF\(@([A-Z][A-Za-z0-9_]*)\.([a-z]+)\)/g, 'boundParams["$1"].resolved.$2');
  result = result.replace(/REF\(@([A-Z][A-Za-z0-9_]*)\)/g, 'boundParams["$1"].resolved.value');

  // Workflow refs: REF(SCHEMA:idx.amount) and bare SCHEMA:idx.amount
  result = result.replace(
    /REF\(([A-Z][A-Za-z0-9_]*):(\d+)\.amount\)/g,
    'Number(workflowContext?.steps?.["$1"]?.outputs?.[$2]?.valueSats ?? 0)'
  );
  result = result.replace(
    /([A-Z][A-Za-z0-9_]*):(\d+)\.amount\b/g,
    'Number(workflowContext?.steps?.["$1"]?.outputs?.[$2]?.valueSats ?? 0)'
  );
  
  // Replace @PARAM.property references (amount -> value for UTXO resolved data)
  result = result.replace(/@([A-Z][A-Za-z0-9_]*)\.amount/g, 'boundParams["$1"].resolved.value');
  result = result.replace(/@([A-Z][A-Za-z0-9_]*)\.([a-z]+)/g, 'boundParams["$1"].resolved.$2');
  result = result.replace(/@([A-Z][A-Za-z0-9_]*)/g, 'boundParams["$1"].resolved');
  
  const feeSlack =
    context === 'calc' && calcAssignVariable === 'fees';
  result = result.replace(
    /vSize\(CURRENT_PSBT\)/g,
    feeSlack ? `(vsize + ${FEE_BUDGET_VSIZE_SLACK_VB})` : 'vsize'
  );
  
  // Replace SUM(INPUTS)
  result = result.replace(/SUM\(INPUTS\)/g, 'Number(sumInputs)');
  
  // Replace CONST references (only if not already part of another identifier)
  for (const [name, value] of Object.entries(consts)) {
    // Use word boundaries to avoid partial matches
    result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), String(value));
  }
  
  // Replace calc variable references with calcVars prefix
  // Must be done AFTER consts to avoid conflicts
  for (const varName of calcVarNames) {
    // Match the variable name as a standalone identifier (not after a dot or as part of another word)
    // Negative lookbehind for dot, positive word boundary
    result = result.replace(new RegExp(`(?<![.])\\b${varName}\\b`, 'g'), `calcVars.${varName}`);
  }
  
  return result;
}

// Generate the complete JavaScript code
export function generatePSBTCode(
  document: BTSLDocument,
  boundParams: BoundParams,
  schemaIndex: number = 0,
  workflowContext: WorkflowContext = { steps: {} }
): string {
  const schema = document.schemas[schemaIndex];
  if (!schema) {
    throw new Error('BTSL_ERR_00: Schema not found');
  }
  
  // Build consts map (document + schema-level)
  const constsMap: Record<string, number | string> = {};
  for (const c of document.consts) {
    constsMap[c.name] = c.value;
  }
  for (const c of schema.consts ?? []) {
    constsMap[c.name] = c.value;
  }
  if (!('DUST_LIMIT' in constsMap)) {
    constsMap['DUST_LIMIT'] = DUST_LIMIT;
  }
  const utxoAliases = schema.inputs.map((i) => i.utxoAlias).filter(Boolean) as string[];
  
  // Serialize bound params for injection
  const boundParamsJson = JSON.stringify(boundParams, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }, 2);

  const workflowContextJson = JSON.stringify(workflowContext);
  
  // Helper: find SCRIPT_DEFS by name
  const findScriptDef = (name: string): BTSLScriptDef | undefined => {
    return document.scriptDefs.find((def) => def.name === name);
  };

  // Generate input building code
  const inputsCode = schema.inputs.map((input, idx) => {
    const utxoRef = input.utxoRef.replace(/^@/, '');
    let witnessScriptHex: string | null = null;

    // Precompile witnessScript for UNLOCK_P2WSH when a scriptDef is present
    if (input.type === 'UNLOCK_P2WSH' && input.scriptDef) {
      const scriptDef = findScriptDef(input.scriptDef);
      if (scriptDef) {
        try {
          witnessScriptHex = compileScriptAsmToHex(
            scriptDef,
            boundParams,
            input.scriptParams
          );
        } catch (e) {
          // Surface as generic compile error in generated code
          const msg =
            e instanceof Error ? e.message : 'Unknown script compile error';
          throw new Error(
            `BTSL_ERR_00: Failed to compile script "${input.scriptDef}" for input ${idx}: ${msg}`
          );
        }
      }
    }
    
    return `
    // Input ${idx}: ${input.utxoRef}
    {
      const utxoData = boundParams["${utxoRef}"]?.resolved;
      if (!utxoData) throw new Error('BTSL_ERR_04b: Unresolved UTXO for ${input.utxoRef}');
      
      const inputObj = buildInput({
        type: "${input.type || 'NATIVE_P2WPKH'}",
        txid: utxoData.txid,
        vout: utxoData.vout,
        value: utxoData.value,
        scriptPubKey: utxoData.scriptPubKey,
        sequence: ${input.sequence ?? 0xffffffff},
        ${input.scriptDef ? `scriptDef: "${input.scriptDef}",` : ''}
        ${input.scriptPath ? `scriptPath: "${input.scriptPath}",` : ''}
        ${witnessScriptHex ? `witnessScript: "${witnessScriptHex}",` : ''}
      }, boundParams);
      
      psbt.addInput(inputObj);
      inputValues.push(BigInt(utxoData.value));
      console.log('[v0] Added input ${idx}:', utxoData.txid + ':' + utxoData.vout, '-', utxoData.value, 'sats');
    }`;
  }).join('\n');
  
  // Collect all calc variable names for expression evaluation
  const calcVarNames = schema.calc.map(c => c.variable);
  
  // Generate calc code - each calc line can reference previously defined calc vars
  const calcCode = schema.calc.map((calc, idx) => {
    const availableVars = calcVarNames.slice(0, idx);
    const evalExpr = generateExpressionEval(
      calc.expression,
      constsMap,
      availableVars,
      'calc',
      utxoAliases,
      calc.variable
    );
    const isFeesVar = calc.variable === 'fees';
    const assignRhs = isFeesVar
      ? `Math.ceil(Number(${evalExpr}))`
      : `Math.floor(${evalExpr})`;
    return `    calcVars.${calc.variable} = ${assignRhs};
    console.log('[v0] calc: ${calc.variable} =', calcVars.${calc.variable});`;
  }).join('\n');
  
  // Helper to resolve amount expression - handles literal numbers, consts, calc vars, and @PARAM refs
  const resolveAmountExpr = (output: BTSLOutput): string => {
    if (typeof output.amount === 'number') {
      return String(output.amount);
    }
    if (output.amountVar) {
      if (output.amountVar.startsWith('@')) {
        const paramName = output.amountVar.replace(/^@/, '');
        return `boundParams["${paramName}"].resolved`;
      }
      if (constsMap[output.amountVar] !== undefined) {
        return String(constsMap[output.amountVar]);
      }
      return `calcVars.${output.amountVar}`;
    }
    return '0';
  };

  // Generate outputs code
  const outputsCode = schema.outputs.map((output, idx) => {
    let addressExpr = '';
    let amountExpr = '';

    switch (output.type) {
      case 'ADDRESS': {
        const addr = output.address ?? '';
        if (addr.startsWith('@')) {
          addressExpr = `boundParams["${addr.replace(/^@/, '').replace(/\.[a-z]+$/, '')}"].resolved${addr.includes('.') ? '.' + addr.split('.').pop() : ''}`;
        } else if (constsMap[addr] !== undefined) {
          addressExpr = JSON.stringify(String(constsMap[addr]));
        } else {
          addressExpr = JSON.stringify(addr);
        }
        amountExpr = resolveAmountExpr(output);
        break;
      }
        
      case 'CHANGE':
        const changeRef = output.address?.replace(/^@/, '').replace(/\.[a-z]+$/, '');
        addressExpr = `boundParams["${changeRef}"].resolved.address`;
        amountExpr = resolveAmountExpr(output);
        break;
        
      case 'SCRIPT':
        addressExpr = `null`; // Will use script
        amountExpr = resolveAmountExpr(output);
        break;
        
      case 'OP_RETURN': {
        addressExpr = `null`;
        amountExpr = `0`;
        break;
      }
    }

    // Resolve OP_RETURN payload to hex (from @PARAM or literal; text vs hex via payloadAsText)
    let payloadHex = '';
    if (output.type === 'OP_RETURN' && output.payload !== undefined) {
      const raw = output.payload.trim();
      if (raw.startsWith('@')) {
        const paramName = raw.replace(/^@/, '').trim();
        const param = boundParams[paramName];
        const value = (param?.rawValue ?? (typeof param?.resolved === 'string' ? param.resolved : '')) || '';
        const asText = Boolean(param?.payloadAsText);
        payloadHex = toPayloadHex(String(value), asText);
      } else if (raw.startsWith('"') && raw.endsWith('"')) {
        payloadHex = toPayloadHex(raw.slice(1, -1).replace(/\\"/g, '"'), true);
      } else {
        payloadHex = toPayloadHex(raw, false);
      }
      payloadHex = payloadHex.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    return `
    // Output ${idx}: ${output.type}
    {
      const outputObj = buildOutput({
        type: "${output.type}",
        address: ${addressExpr},
        amount: BigInt(${amountExpr}),
        ${output.type === 'OP_RETURN' ? `payload: "${payloadHex}",` : ''}
        ${output.scriptDef ? `scriptDef: "${output.scriptDef}",` : ''}
      }, calcVars);
      
      psbt.addOutput(outputObj);
      outputValues.push(BigInt(${amountExpr}));
      console.log('[v0] Added output ${idx}:', ${addressExpr}, '-', ${amountExpr}, 'sats');
    }`;
  }).join('\n');
  
  // Generate assert code - asserts can reference all calc vars
  const assertsCode = schema.asserts.map(assert => {
    const evalCondition = generateExpressionEval(assert.condition, constsMap, calcVarNames, 'assert', utxoAliases);
    return `
    // ASSERT ${assert.index}: ${assert.source}
    if (!(${evalCondition})) {
      throw new Error('BTSL_ERR_06: ASSERT ${assert.index} failed — ${assert.condition.replace(/'/g, "\\'")}');
    }
    console.log('[v0] ASSERT ${assert.index} passed: ${assert.condition.replace(/'/g, "\\'")}');`;
  }).join('\n');
  
  return `// ============================================================
// BTSL Generated Code - Schema: ${schema.name}
// Generated for browser-compatible ESM
// ============================================================

// NOTE: PSBT is constructed directly via bitcoinjs-lib.Psbt (no Transaction).
import * as bitcoin from 'https://esm.sh/bitcoinjs-lib@6.1.6';
import * as ecc from 'https://esm.sh/tiny-secp256k1@2.2.1';
import { hex } from 'https://esm.sh/@scure/base@1.2.4';

bitcoin.initEccLib(ecc);

// Phase 2 — Bound Parameters (injected from UI)
const boundParams = ${boundParamsJson};
const workflowContext = ${workflowContextJson};

// Constants from schema
const DUST_LIMIT = ${constsMap['DUST_LIMIT'] || DUST_LIMIT};

${generatePreciseVsizeBlock(schema, constsMap, document, boundParams)}

// Phase 4.2 — buildInput dispatcher function (Psbt input descriptors for bitcoinjs-lib)
function buildInput(inputDef, boundParams) {
  const base = {
    hash: inputDef.txid,
    index: inputDef.vout,
    sequence: inputDef.sequence ?? 0xffffffff,
  };

  switch (inputDef.type) {
    case 'NATIVE_P2WPKH':
    case 'NATIVE_P2TR_KEY':
      return {
        ...base,
        witnessUtxo: {
          script: Buffer.from(inputDef.scriptPubKey, 'hex'),
          value: inputDef.value,
        },
      };

    case 'NATIVE_P2PKH':
      return {
        ...base,
        nonWitnessUtxo: inputDef.rawTx,
      };

    case 'UNLOCK_P2WSH':
      return {
        ...base,
        witnessUtxo: {
          script: Buffer.from(inputDef.scriptPubKey, 'hex'),
          value: inputDef.value,
        },
        ...(inputDef.witnessScript
          ? { witnessScript: Buffer.from(inputDef.witnessScript, 'hex') }
          : {}),
      };

    case 'UNLOCK_P2TR_SCRIPT':
      return {
        ...base,
        witnessUtxo: {
          script: Buffer.from(inputDef.scriptPubKey, 'hex'),
          value: inputDef.value,
        },
        // tapLeafScript and controlBlock derived automatically
      };

    default:
      return {
        ...base,
        witnessUtxo: {
          script: Buffer.from(inputDef.scriptPubKey, 'hex'),
          value: inputDef.value,
        },
      };
  }
}

// Phase 4.3 — buildOutput dispatcher function (Psbt output descriptors for bitcoinjs-lib)
function buildOutput(outputDef, calcVars) {
  switch (outputDef.type) {
    case 'ADDRESS':
      return {
        address: outputDef.address,
        value: Number(outputDef.amount),
      };

    case 'CHANGE': {
      const changeAmount = BigInt(outputDef.amount);
      if (changeAmount < 0n) throw new Error('BTSL_ERR_08: Negative change amount');
      return {
        address: outputDef.address,
        value: Number(changeAmount),
      };
    }

    case 'SCRIPT':
      return {
        address: outputDef.address,
        value: Number(outputDef.amount),
      };

    case 'OP_RETURN': {
      const payloadHex = (outputDef.payload || '').replace(/^0x/i, '').replace(/\s/g, '');
      if (payloadHex.length / 2 > 80) {
        console.warn('BTSL_WARN_04: OP_RETURN payload exceeds 80 bytes');
      }
      const payloadBytes = payloadHex ? hex.decode(payloadHex) : new Uint8Array(0);
      const opReturnScript = Buffer.from([0x6a, payloadBytes.length, ...payloadBytes]);
      return {
        script: opReturnScript,
        value: 0,
      };
    }

    default:
      throw new Error('BTSL_ERR_04c: Unrecognized output type — ' + outputDef.type);
  }
}

// ============================================================
// Main Execution
// ============================================================

async function buildPSBT() {
  console.log('[v0] ========================================');
  console.log('[v0] Starting BTSL PSBT Construction');
  console.log('[v0] Schema: ${schema.name}');
  console.log('[v0] ========================================');
  
  // Phase 4.1 — Initialize native PSBT (bitcoinjs-lib Psbt only)
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  console.log('[v0] Initialized PSBT (BIP174, bitcoinjs-lib Psbt)');
  
  const inputValues = [];
  const outputValues = [];
  const calcVars = {};
  
  // Calculate sum of inputs for calc phase
  let sumInputs = 0n;
  for (const [key, param] of Object.entries(boundParams)) {
    if (param.resolved && typeof param.resolved === 'object' && 'value' in param.resolved) {
      sumInputs += BigInt(param.resolved.value);
    }
  }
  console.log('[v0] Sum of inputs:', sumInputs.toString(), 'sats');
  
  // Phase 3 — Execute calc assignments (sequential, declaration order)
  console.log('[v0] ----------------------------------------');
  console.log('[v0] Phase 3 — Executing calc block');
${calcCode}
  
  // Phase 4 — Build PSBT inputs
  console.log('[v0] ----------------------------------------');
  console.log('[v0] Phase 4 — Building PSBT inputs');
${inputsCode}
  
  // Phase 4 — Build PSBT outputs
  console.log('[v0] ----------------------------------------');
  console.log('[v0] Phase 4 — Building PSBT outputs');
${outputsCode}
  
  // Phase 5 — Zero-Trust Audit
  console.log('[v0] ----------------------------------------');
  console.log('[v0] Phase 5 — Zero-Trust Audit');
  
  // 5.1 Balance Invariant Check
  const totalInputs = inputValues.reduce((a, b) => a + b, 0n);
  const totalOutputs = outputValues.reduce((a, b) => a + b, 0n);
  const implicitFees = totalInputs - totalOutputs;
  
  console.log('[v0] Total inputs:', totalInputs.toString(), 'sats');
  console.log('[v0] Total outputs:', totalOutputs.toString(), 'sats');
  console.log('[v0] Implicit fees:', implicitFees.toString(), 'sats');
  
  if (implicitFees < 0n) {
    throw new Error('BTSL_ERR_06: Balance invariant failed — outputs exceed inputs');
  }
  
  // 5.2 ASSERT Evaluation
  console.log('[v0] Evaluating ASSERT conditions...');
${assertsCode}
  
  // 5.3 Dust Check
  console.log('[v0] Checking for dust outputs...');
  for (let i = 0; i < outputValues.length; i++) {
    // Skip OP_RETURN (index can be detected by type or zero amount)
    if (outputValues[i] > 0n && outputValues[i] < BigInt(DUST_LIMIT)) {
      throw new Error(\`BTSL_ERR_07: Dust output at index \${i} — value=\${outputValues[i]}\`);
    }
  }
  console.log('[v0] Dust check passed');
  
  // 5.4 Weight Check
  if (tx_weight > 400000) {
    console.warn('BTSL_WARN_04: Transaction exceeds standard relay weight (400k WU)');
  }
  
  // Phase 5.6 — Export PSBT
  console.log('[v0] ----------------------------------------');
  console.log('[v0] All audits passed — exporting PSBT');
  
  const psbtBase64 = psbt.toBase64();
  const psbtHex = psbt.toHex();
  
  console.log('[v0] ========================================');
  console.log('[v0] PSBT Generation Complete');
  console.log('[v0] Status: UNSIGNED — Ready for signing');
  console.log('[v0] ========================================');
  
  return {
    psbtBase64,
    psbtHex,
    status: 'READY_FOR_SIGNING',
    summary: {
      inputs: inputValues.map((v, i) => ({ index: i, value: v.toString() })),
      outputs: outputValues.map((v, i) => ({ index: i, value: v.toString() })),
      fees: implicitFees.toString(),
      vsize: vsize,
    }
  };
}

// Execute and return result
buildPSBT();
`;
}

// Generate a summary of the schema for display
export function generateSchemaSummary(schema: BTSLSchema): {
  inputs: Array<{ index: number; type: string; ref: string }>;
  outputs: Array<{ index: number; type: string; address?: string; amount?: string }>;
  calcVars: string[];
  asserts: number;
} {
  return {
    inputs: schema.inputs.map(input => ({
      index: input.index,
      type: input.type || 'FLEXIBLE',
      ref: input.utxoRef
    })),
    outputs: schema.outputs.map(output => ({
      index: output.index,
      type: output.type,
      address: output.address,
      amount: output.amount?.toString() || output.amountVar
    })),
    calcVars: schema.calc.map(c => c.variable),
    asserts: schema.asserts.length
  };
}
