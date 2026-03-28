/**
 * Shared BTSL calc / ASSERT runtime (Maker & Checker).
 * Aligns with spec §4.3.B–C, §3.8 (fees slack per implementation guide for fee line only).
 */

import type { BTSLDocument, BTSLSchema, BoundParams, WorkflowContext } from './types';
import { DUST_LIMIT, FEE_BUDGET_VSIZE_SLACK_VB } from './types';

export interface RuntimeLogs {
  push: (line: string) => void;
}

const noopLog: RuntimeLogs = { push: () => {} };

function tokenize(expr: string): (bigint | string)[] {
  const tokens: (bigint | string)[] = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    const char = s[i];

    if (char === '(' || char === ')') {
      tokens.push(char);
      i++;
      continue;
    }

    if (['+', '*', '/'].includes(char)) {
      tokens.push(char);
      i++;
      continue;
    }

    if (char === '-') {
      const lastToken = tokens[tokens.length - 1];
      if (
        tokens.length === 0 ||
        lastToken === '(' ||
        (typeof lastToken === 'string' && ['+', '-', '*', '/'].includes(lastToken))
      ) {
        i++;
        let numStr = '-';
        while (i < s.length && /\d/.test(s[i])) {
          numStr += s[i];
          i++;
        }
        tokens.push(BigInt(numStr));
      } else {
        tokens.push('-');
        i++;
      }
      continue;
    }

    if (/\d/.test(char)) {
      let numStr = '';
      while (i < s.length && /\d/.test(s[i])) {
        numStr += s[i];
        i++;
      }
      tokens.push(BigInt(numStr));
      continue;
    }

    i++;
  }

  return tokens;
}

function parseExpr(tokens: (bigint | string)[], pos: { i: number }): bigint {
  let left = parseTerm(tokens, pos);
  while (pos.i < tokens.length) {
    const op = tokens[pos.i];
    if (op !== '+' && op !== '-') break;
    pos.i++;
    const right = parseTerm(tokens, pos);
    if (op === '+') left = left + right;
    else left = left - right;
  }
  return left;
}

function parseTerm(tokens: (bigint | string)[], pos: { i: number }): bigint {
  let left = parseFactor(tokens, pos);
  while (pos.i < tokens.length) {
    const op = tokens[pos.i];
    if (op !== '*' && op !== '/') break;
    pos.i++;
    const right = parseFactor(tokens, pos);
    if (op === '*') left = left * right;
    else {
      if (right === BigInt(0)) throw new Error('BTSL_ERR_08: Division by zero');
      left = left / right;
    }
  }
  return left;
}

function parseFactor(tokens: (bigint | string)[], pos: { i: number }): bigint {
  const token = tokens[pos.i];
  if (token === '(') {
    pos.i++;
    const result = parseExpr(tokens, pos);
    if (tokens[pos.i] === ')') pos.i++;
    return result;
  }
  if (typeof token === 'bigint') {
    pos.i++;
    return token;
  }
  throw new Error(`Unexpected token: ${String(token)}`);
}

export function buildConsts(document: BTSLDocument, schema: BTSLSchema): Record<string, bigint | string> {
  const consts: Record<string, bigint | string> = { DUST_LIMIT: BigInt(DUST_LIMIT) };
  for (const c of document.consts) {
    consts[c.name] = typeof c.value === 'number' ? BigInt(c.value) : c.value;
  }
  for (const c of schema.consts ?? []) {
    consts[c.name] = typeof c.value === 'number' ? BigInt(c.value) : c.value;
  }
  return consts;
}

/** Per-output amount from schema (same rules as Maker PSBT build). */
export function computeOutputAmounts(
  schema: BTSLSchema,
  consts: Record<string, bigint | string>,
  boundParams: BoundParams,
  calcVars: Record<string, bigint>
): bigint[] {
  const out: bigint[] = [];
  for (const output of schema.outputs) {
    let amount = BigInt(0);
    if (output.type === 'OP_RETURN') {
      amount = BigInt(0);
    } else if (output.amountVar) {
      if (output.amountVar.startsWith('@')) {
        const paramName = output.amountVar.slice(1);
        const param = boundParams[paramName];
        if (typeof param?.resolved === 'number') {
          amount = BigInt(param.resolved);
        }
      } else if (consts[output.amountVar] !== undefined && typeof consts[output.amountVar] !== 'string') {
        amount = BigInt(consts[output.amountVar] as bigint);
      } else if (calcVars[output.amountVar] !== undefined) {
        amount = calcVars[output.amountVar];
      }
    } else if (output.amount !== undefined) {
      amount = BigInt(output.amount);
    }
    out.push(amount);
  }
  return out;
}

export function collectInputValues(schema: BTSLSchema, boundParams: BoundParams): bigint[] {
  const inputValues: bigint[] = [];
  for (const input of schema.inputs) {
    if (!input.utxoRef?.trim()) {
      inputValues.push(BigInt(0));
      continue;
    }
    const paramName = input.utxoRef.replace(/^@/, '').trim();
    const param = boundParams[paramName];
    if (param?.resolved && typeof param.resolved === 'object' && 'value' in param.resolved) {
      inputValues.push(BigInt((param.resolved as { value: number }).value));
    } else {
      inputValues.push(BigInt(0));
    }
  }
  return inputValues;
}

export interface ExprEvalContext {
  schema: BTSLSchema;
  boundParams: BoundParams;
  workflowContext: WorkflowContext;
  consts: Record<string, bigint | string>;
  calcVars: Record<string, bigint>;
  vsize: number;
  inputValues: bigint[];
  /** For SUM(OUTPUTS) during calc — uses current calcVars */
  getSumOutputs: () => bigint;
  utxoAliases: string[];
  /** Override @NAME.amount / REF(@NAME.amount) — Checker uses chain-certified fetch */
  getUtxoAmount?: (paramName: string) => bigint;
  logs: RuntimeLogs;
}

export function evalExpression(
  expr: string,
  ctx: ExprEvalContext,
  opts?: { calcAssignVar?: string; forAssert?: boolean }
): bigint {
  let result = expr;
  const vs =
    opts?.forAssert === true
      ? ctx.vsize
      : opts?.calcAssignVar === 'fees'
        ? ctx.vsize + FEE_BUDGET_VSIZE_SLACK_VB
        : ctx.vsize;

  const getParamValue = (ref: string): bigint => {
    if (ref.startsWith('@')) {
      const parts = ref.slice(1).split('.');
      const paramName = parts[0];
      const prop = parts[1];
      if (prop === 'amount') {
        if (ctx.getUtxoAmount) {
          return ctx.getUtxoAmount(paramName);
        }
        const param = ctx.boundParams[paramName];
        if (param?.resolved && typeof param.resolved === 'object' && 'value' in param.resolved) {
          return BigInt((param.resolved as { value: number }).value);
        }
      }
      const param = ctx.boundParams[paramName];
      if (typeof param?.resolved === 'number') {
        return BigInt(param.resolved);
      }
      return BigInt(0);
    }
    return BigInt(0);
  };

  for (const alias of ctx.utxoAliases) {
    const resolved = ctx.boundParams[alias]?.resolved;
    let value = '0';
    if (ctx.getUtxoAmount) {
      value = ctx.getUtxoAmount(alias).toString();
    } else if (typeof resolved === 'object' && resolved !== null && 'value' in resolved) {
      value = String((resolved as { value: number }).value);
    }
    result = result.replace(new RegExp(`\\b${alias}\\.amount\\b`, 'g'), value);
  }

  for (const [name, value] of Object.entries(ctx.consts)) {
    if (typeof value === 'bigint' || typeof value === 'number') {
      result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), String(value));
    }
  }

  for (const [name, value] of Object.entries(ctx.calcVars)) {
    result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), value.toString());
  }

  result = result.replace(/vSize\(CURRENT_PSBT\)/g, vs.toString());

  const sumIn = ctx.inputValues.reduce((a, b) => a + b, BigInt(0));
  result = result.replace(/SUM\(INPUTS\)/g, sumIn.toString());
  result = result.replace(/SUM\(OUTPUTS\)/g, ctx.getSumOutputs().toString());
  result = result.replace(/COUNT\(INPUTS\)/g, String(ctx.schema.inputs.length));
  result = result.replace(/COUNT\(OUTPUTS\)/g, String(ctx.schema.outputs.length));

  result = result.replace(/REF\((@[A-Z][A-Za-z0-9_]*\.[a-z]+)\)/g, (_, ref) => {
    return getParamValue(ref).toString();
  });

  result = result.replace(/REF\(([A-Z][A-Za-z0-9_]*):(\d+)\.amount\)/g, (_, sName, idx) => {
    const v = ctx.workflowContext?.steps?.[String(sName)]?.outputs?.[Number(idx)]?.valueSats;
    return String(v ?? '0');
  });
  result = result.replace(/([A-Z][A-Za-z0-9_]*):(\d+)\.amount\b/g, (_, sName, idx) => {
    const v = ctx.workflowContext?.steps?.[String(sName)]?.outputs?.[Number(idx)]?.valueSats;
    return String(v ?? '0');
  });

  result = result.replace(/@([A-Z][A-Za-z0-9_]*)\.([a-z]+)/g, (_, name, prop) => {
    if (prop === 'amount' && ctx.getUtxoAmount) {
      return ctx.getUtxoAmount(name).toString();
    }
    return getParamValue(`@${name}.${prop}`).toString();
  });
  result = result.replace(/@([A-Z][A-Za-z0-9_]*)/g, (_, name) => {
    const param = ctx.boundParams[name];
    if (typeof param?.resolved === 'number') {
      return param.resolved.toString();
    }
    return '0';
  });

  try {
    const tokens = tokenize(result);
    if (tokens.length === 0) return BigInt(0);
    return parseExpr(tokens, { i: 0 });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('BTSL_ERR')) {
      throw e;
    }
    ctx.logs.push(`[BTSL] Expression eval error: ${expr} -> ${result} (${e})`);
    return BigInt(0);
  }
}

export function runCalcBlock(
  schema: BTSLSchema,
  document: BTSLDocument,
  boundParams: BoundParams,
  workflowContext: WorkflowContext,
  vsize: number,
  inputValues: bigint[],
  options: {
    getUtxoAmount?: (paramName: string) => bigint;
    logs?: RuntimeLogs;
  } = {}
): Record<string, bigint> {
  const logs = options.logs ?? noopLog;
  const consts = buildConsts(document, schema);
  const utxoAliases = schema.inputs.map((i) => i.utxoAlias).filter(Boolean) as string[];
  const calcVars: Record<string, bigint> = {};

  for (const calc of schema.calc) {
    const ctx: ExprEvalContext = {
      schema,
      boundParams,
      workflowContext,
      consts,
      calcVars,
      vsize,
      inputValues,
      getSumOutputs: () =>
        computeOutputAmounts(schema, consts, boundParams, calcVars).reduce((a, b) => a + b, BigInt(0)),
      utxoAliases,
      getUtxoAmount: options.getUtxoAmount,
      logs,
    };
    let v = evalExpression(calc.expression, ctx, { calcAssignVar: calc.variable });
    if (calc.variable === 'fees') {
      v = BigInt(Math.ceil(Number(v)));
    }
    calcVars[calc.variable] = v;
    logs.push(`[BTSL] calc: ${calc.variable} = ${calcVars[calc.variable]}`);
  }

  return calcVars;
}

export function evaluateAsserts(
  schema: BTSLSchema,
  document: BTSLDocument,
  boundParams: BoundParams,
  workflowContext: WorkflowContext,
  vsize: number,
  inputValues: bigint[],
  calcVars: Record<string, bigint>,
  options: {
    getUtxoAmount?: (paramName: string) => bigint;
    logs?: RuntimeLogs;
  } = {}
): void {
  const logs = options.logs ?? noopLog;
  const consts = buildConsts(document, schema);
  const utxoAliases = schema.inputs.map((i) => i.utxoAlias).filter(Boolean) as string[];

  const sortedAsserts = [...schema.asserts].sort((a, b) => a.index - b.index);
  logs.push('[BTSL] Evaluating ASSERT conditions...');

  for (const assert of sortedAsserts) {
    const ctx: ExprEvalContext = {
      schema,
      boundParams,
      workflowContext,
      consts,
      calcVars,
      vsize,
      inputValues,
      getSumOutputs: () =>
        computeOutputAmounts(schema, consts, boundParams, calcVars).reduce((a, b) => a + b, BigInt(0)),
      utxoAliases,
      getUtxoAmount: options.getUtxoAmount,
      logs,
    };

    const compMatch = assert.condition.match(/(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)/);
    if (!compMatch) continue;

    const left = evalExpression(compMatch[1].trim(), ctx, { forAssert: true });
    const op = compMatch[2];
    const right = evalExpression(compMatch[3].trim(), ctx, { forAssert: true });

    let passed = false;
    switch (op) {
      case '>=':
        passed = left >= right;
        break;
      case '<=':
        passed = left <= right;
        break;
      case '==':
        passed = left === right;
        break;
      case '!=':
        passed = left !== right;
        break;
      case '>':
        passed = left > right;
        break;
      case '<':
        passed = left < right;
        break;
    }

    if (!passed) {
      throw new Error(`BTSL_ERR_06: ASSERT ${assert.index} failed — ${assert.condition}`);
    }
    logs.push(`[BTSL] ASSERT ${assert.index} passed: ${assert.condition}`);
  }
}

/**
 * Spec §3.8 / §4.3.C — implicit balance when `fees` is declared in calc.
 *
 * Bitcoin conservation: inputs = all outputs + **miner** fee only.
 * Schemas like TRICOUNT set `fees = @MAKER_FEE + fees_btc` while also paying the maker on an
 * output; using that sum here would double-count `MAKER_FEE`. Prefer `fees_btc` when present.
 */
export function checkImplicitBalance(
  sumInputs: bigint,
  sumOutputs: bigint,
  calcVars: Record<string, bigint>,
  logs: RuntimeLogs
): void {
  if (!('fees' in calcVars)) {
    logs.push('[BTSL] BTSL_WARN_06: No calc variable `fees` — implicit balance check skipped');
    return;
  }
  const burn = 'fees_btc' in calcVars ? calcVars.fees_btc : calcVars.fees;
  const burnLabel = 'fees_btc' in calcVars ? 'fees_btc' : 'fees';
  if (sumInputs !== sumOutputs + burn) {
    throw new Error(
      `BTSL_ERR_06: Balance invariant failed — SUM(INPUTS)=${sumInputs} != SUM(OUTPUTS)=${sumOutputs} + ${burnLabel}=${burn}`
    );
  }
  logs.push(`[BTSL] Implicit balance OK: ${sumInputs} == ${sumOutputs} + ${burnLabel}=${burn}`);
}

export function checkDustOutputs(
  schema: BTSLSchema,
  outputAmounts: bigint[],
  dustLimit: bigint,
  logs: RuntimeLogs
): void {
  logs.push('[BTSL] Checking for dust outputs...');
  for (let i = 0; i < outputAmounts.length; i++) {
    const output = schema.outputs[i];
    if (!output) continue;
    if (output.type === 'OP_RETURN') continue;
    if (outputAmounts[i] > BigInt(0) && outputAmounts[i] < dustLimit) {
      throw new Error(`BTSL_ERR_07: Dust output at index ${i} — value=${outputAmounts[i]}`);
    }
  }
  logs.push('[BTSL] Dust check passed');
}

export function logWeightWarning(txWeightWu: number, logs: RuntimeLogs): void {
  if (txWeightWu > 400_000) {
    logs.push('[BTSL] BTSL_WARN_07: Transaction exceeds standard relay weight (400k wu)');
  }
}
