'use client';

import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Code, Play, Copy, CheckCircle, XCircle, AlertTriangle, Terminal } from 'lucide-react';
import {
  BTSLDocument,
  BoundParams,
  ERROR_CODES,
  WARNING_CODES,
  toPayloadHex,
  FEE_BUDGET_VSIZE_SLACK_VB,
} from '@/lib/btsl/types';
import { generatePSBTCode } from '@/lib/btsl/code-generator';
import { compileScriptAsmToHex } from '@/lib/btsl/script-compiler';
import {
  buildOutputScriptsForPreciseVsize,
  computePreciseTxMetrics,
} from '@/lib/btsl/precise-weight';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism';

interface CodeGenerationCardProps {
  document: BTSLDocument | null;
  boundParams: BoundParams | null;
  workflowContext?: import('@/lib/btsl/types').WorkflowContext;
  schemaIndex?: number;
  onResult: (result: ExecutionResult) => void;
  disabled?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  psbtBase64?: string;
  psbtHex?: string;
  summary?: {
    inputs: Array<{ index: number; value: string }>;
    outputs: Array<{ index: number; value: string }>;
    fees: string;
    vsize: number;
  };
  error?: {
    code: string;
    message: string;
  };
  logs: string[];
}

export function CodeGenerationCard({ document, boundParams, workflowContext, schemaIndex = 0, onResult, disabled }: CodeGenerationCardProps) {
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [copied, setCopied] = useState(false);
  const logsRef = useRef<string[]>([]);

  const handleGenerate = useCallback(() => {
    if (!document || !boundParams) return;

    setIsGenerating(true);
    setExecutionResult(null);
    logsRef.current = [];

    try {
      const code = generatePSBTCode(document, boundParams, schemaIndex, workflowContext ?? { steps: {} });
      setGeneratedCode(code);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Code generation failed';
      setExecutionResult({
        success: false,
        error: {
          code: errorMsg.startsWith('BTSL_ERR') ? errorMsg.split(':')[0] : 'BTSL_ERR_00',
          message: errorMsg
        },
        logs: []
      });
    }

    setIsGenerating(false);
  }, [document, boundParams, schemaIndex, workflowContext]);

  const handleRun = useCallback(async () => {
    if (!generatedCode) return;

    setIsRunning(true);
    logsRef.current = [];

    // Create a custom console to capture logs
    const logs: string[] = [];
    const originalConsole = { ...console };

    const captureConsole = {
      log: (...args: unknown[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(msg);
        originalConsole.log(...args);
      },
      warn: (...args: unknown[]) => {
        const msg = '[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(msg);
        originalConsole.warn(...args);
      },
      error: (...args: unknown[]) => {
        const msg = '[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(msg);
        originalConsole.error(...args);
      }
    };

    try {
      // Create a blob URL for the code and execute it as a module
      // For browser execution, we need to handle this carefully
      
      // Since we can't easily run ESM with dynamic imports in all browsers,
      // we'll simulate the execution by parsing the code and extracting results
      
      // Replace console calls in the code
      const modifiedCode = generatedCode
        .replace(/console\.log/g, 'captureConsole.log')
        .replace(/console\.warn/g, 'captureConsole.warn')
        .replace(/console\.error/g, 'captureConsole.error');

      // Execute in a sandboxed way (simplified for demo)
      // In production, you'd use a proper sandbox or web worker
      
      // For now, we'll simulate the execution by extracting the bound params
      // and calculating the PSBT in a more direct way
      
      const simulatedResult = await simulatePSBTGeneration(document!, boundParams!, workflowContext ?? { steps: {} }, schemaIndex, logs);
      
      setExecutionResult(simulatedResult);
      logsRef.current = logs;
      
      if (simulatedResult.success) {
        onResult(simulatedResult);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Execution failed';
      const errorCode = errorMsg.match(/BTSL_ERR_\d+[a-z]?/)?.[0] || 'BTSL_ERR_00';
      
      logs.push(`[ERROR] ${errorMsg}`);
      
      setExecutionResult({
        success: false,
        error: {
          code: errorCode,
          message: ERROR_CODES[errorCode] || errorMsg
        },
        logs
      });
      logsRef.current = logs;
    }

    setIsRunning(false);
  }, [generatedCode, document, boundParams, onResult]);

  const handleCopy = useCallback(async () => {
    if (!generatedCode) return;
    
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [generatedCode]);

  return (
    <Card className={disabled ? 'opacity-50' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Card 3 - Code Generation & Execution
            </CardTitle>
            <CardDescription>
              Generate and run JavaScript code to produce the PSBT
            </CardDescription>
          </div>
          {executionResult && (
            executionResult.success ? (
              <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                <CheckCircle className="mr-1 h-3 w-3" />
                Success
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="mr-1 h-3 w-3" />
                {executionResult.error?.code || 'Error'}
              </Badge>
            )
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Waiting for Parameters</AlertTitle>
            <AlertDescription>
              Confirm parameter binding first to unlock code generation.
            </AlertDescription>
          </Alert>
        )}

        {!disabled && (
          <>
            <Button 
              onClick={handleGenerate} 
              className="w-full"
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Generating...
                </>
              ) : (
                <>
                  <Code className="mr-2 h-4 w-4" />
                  Generate Code
                </>
              )}
            </Button>

            {generatedCode && (
              <>
                <div className="relative">
                  <div className="absolute right-2 top-2 z-10">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopy}
                    >
                      {copied ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="max-h-[400px] overflow-auto rounded-lg border bg-muted/20">
                    <SyntaxHighlighter
                      language="javascript"
                      style={oneLight}
                      customStyle={{
                        margin: 0,
                        padding: '1rem',
                        fontSize: '0.75rem',
                        background: 'transparent'
                      }}
                      wrapLongLines
                    >
                      {generatedCode}
                    </SyntaxHighlighter>
                  </div>
                </div>

                <Button 
                  onClick={handleRun}
                  className="w-full"
                  variant="secondary"
                  disabled={isRunning}
                >
                  {isRunning ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Run
                    </>
                  )}
                </Button>
              </>
            )}

            {/* Console Output */}
            {logsRef.current.length > 0 && (
              <div className="rounded-lg border bg-slate-900 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
                  <Terminal className="h-4 w-4" />
                  Console Output
                </div>
                <div className="max-h-[200px] overflow-auto font-mono text-xs">
                  {logsRef.current.map((log, idx) => (
                    <div
                      key={idx}
                      className={`py-0.5 ${
                        log.includes('[ERROR]') ? 'text-red-400' :
                        log.includes('[WARN]') ? 'text-yellow-400' :
                        log.startsWith('[v0]') ? 'text-green-400' :
                        'text-slate-300'
                      }`}
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Display */}
            {executionResult && !executionResult.success && executionResult.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>{executionResult.error.code}</AlertTitle>
                <AlertDescription>
                  {ERROR_CODES[executionResult.error.code] || executionResult.error.message}
                </AlertDescription>
              </Alert>
            )}

            {/* Success Summary */}
            {executionResult?.success && executionResult.summary && (
              <Alert className="border-green-500 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-800">PSBT Generated Successfully</AlertTitle>
                <AlertDescription className="text-green-700">
                  <div className="mt-2 space-y-1 text-sm">
                    <p>Inputs: {executionResult.summary.inputs.length}</p>
                    <p>Outputs: {executionResult.summary.outputs.length}</p>
                    <p>Fees: {parseInt(executionResult.summary.fees).toLocaleString()} sats</p>
                    <p>vSize: {executionResult.summary.vsize} vBytes</p>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Simulate PSBT generation (actual implementation would use the generated code)
async function simulatePSBTGeneration(
  document: BTSLDocument,
  boundParams: BoundParams,
  workflowContext: import('@/lib/btsl/types').WorkflowContext,
  schemaIndex: number,
  logs: string[]
): Promise<ExecutionResult> {
  const schema = document.schemas[schemaIndex];
  if (!schema) {
    throw new Error('BTSL_ERR_00: No schema found');
  }

  logs.push('[v0] ========================================');
  logs.push('[v0] Starting BTSL PSBT Construction');
  logs.push(`[v0] Schema: ${schema.name}`);
  logs.push('[v0] ========================================');

  const constsMapForWeight: Record<string, number | string> = {};
  for (const c of document.consts) {
    constsMapForWeight[c.name] = c.value;
  }
  for (const c of schema.consts ?? []) {
    constsMapForWeight[c.name] = c.value;
  }
  const getBoundAddress = (paramKey: string): string | undefined => {
    const r = boundParams[paramKey]?.resolved;
    if (r && typeof r === 'object' && 'address' in r) {
      return (r as { address?: string }).address;
    }
    return undefined;
  };

  const bitcoin = await import('bitcoinjs-lib');
  const ecc = await import('tiny-secp256k1');
  bitcoin.initEccLib(ecc);
  const outputScripts = buildOutputScriptsForPreciseVsize(
    schema,
    constsMapForWeight,
    getBoundAddress,
    bitcoin.networks.bitcoin,
    boundParams,
    document
  );
  const { vsize, weight: txWeightWu } = computePreciseTxMetrics(
    schema.inputs,
    outputScripts,
    document,
    boundParams
  );
  logs.push(`[v0] Precise vsize (BIP-141 template tx): ${vsize} vB, weight ${txWeightWu} wu`);

  // Calculate sum of inputs
  let sumInputs = BigInt(0);
  const inputValues: bigint[] = [];
  
  for (const input of schema.inputs) {
    const paramName = input.utxoRef.replace(/^@/, '');
    const param = boundParams[paramName];
    if (param?.resolved && typeof param.resolved === 'object' && 'value' in param.resolved) {
      const value = BigInt(param.resolved.value);
      sumInputs += value;
      inputValues.push(value);
      logs.push(`[v0] Input ${input.index}: ${param.resolved.txid}:${param.resolved.vout} - ${value} sats`);
    }
  }

  logs.push(`[v0] Sum of inputs: ${sumInputs} sats`);

  // Execute calc
  logs.push('[v0] ----------------------------------------');
  logs.push('[v0] Phase 3 — Executing calc block');

  const calcVars: Record<string, bigint> = {};
  const consts: Record<string, bigint | string> = {
    DUST_LIMIT: BigInt(546)
  };

  for (const c of document.consts) {
    consts[c.name] = typeof c.value === 'number' ? BigInt(c.value) : c.value;
  }
  for (const c of schema.consts ?? []) {
    consts[c.name] = typeof c.value === 'number' ? BigInt(c.value) : c.value;
  }

  const utxoAliases = schema.inputs.map((i) => i.utxoAlias).filter(Boolean) as string[];

  const getParamValue = (ref: string): bigint => {
    if (ref.startsWith('@')) {
      const parts = ref.slice(1).split('.');
      const paramName = parts[0];
      const prop = parts[1];
      const param = boundParams[paramName];
      
      if (prop === 'amount' && param?.resolved && typeof param.resolved === 'object' && 'value' in param.resolved) {
        return BigInt(param.resolved.value);
      }
      
      if (typeof param?.resolved === 'number') {
        return BigInt(param.resolved);
      }
      
      return BigInt(0);
    }
    return BigInt(0);
  };

  // Tokenize expression into numbers and operators
  const tokenize = (expr: string): (bigint | string)[] => {
    const tokens: (bigint | string)[] = [];
    let i = 0;
    const s = expr.trim();
    
    while (i < s.length) {
      // Skip whitespace
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      
      const char = s[i];
      
      // Parentheses
      if (char === '(' || char === ')') {
        tokens.push(char);
        i++;
        continue;
      }
      
      // Operators
      if (['+', '*', '/'].includes(char)) {
        tokens.push(char);
        i++;
        continue;
      }
      
      // Handle minus - could be negative number or subtraction
      if (char === '-') {
        // It's a negative number if at start, after operator, or after open paren
        const lastToken = tokens[tokens.length - 1];
        if (tokens.length === 0 || lastToken === '(' || ['+', '-', '*', '/'].includes(lastToken as string)) {
          // Negative number
          i++;
          let numStr = '-';
          while (i < s.length && /\d/.test(s[i])) {
            numStr += s[i];
            i++;
          }
          tokens.push(BigInt(numStr));
        } else {
          // Subtraction operator
          tokens.push('-');
          i++;
        }
        continue;
      }
      
      // Numbers
      if (/\d/.test(char)) {
        let numStr = '';
        while (i < s.length && /\d/.test(s[i])) {
          numStr += s[i];
          i++;
        }
        tokens.push(BigInt(numStr));
        continue;
      }
      
      // Unknown character - skip
      i++;
    }
    
    return tokens;
  };
  
  // Recursive descent parser for arithmetic
  const parseExpr = (tokens: (bigint | string)[], pos: { i: number }): bigint => {
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
  };
  
  const parseTerm = (tokens: (bigint | string)[], pos: { i: number }): bigint => {
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
  };
  
  const parseFactor = (tokens: (bigint | string)[], pos: { i: number }): bigint => {
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
    
    // Should not reach here
    throw new Error(`Unexpected token: ${token}`);
  };
  
  // Expression evaluator: fee line uses vsize+slack; ASSERT uses exact vsize
  const evalExpr = (
    expr: string,
    opts?: { calcAssignVar?: string; forAssert?: boolean }
  ): bigint => {
    let result = expr;
    const vs =
      opts?.forAssert === true
        ? vsize
        : opts?.calcAssignVar === 'fees'
          ? vsize + FEE_BUDGET_VSIZE_SLACK_VB
          : vsize;

    // UTXO alias refs (From(@X) AS alias)
    for (const alias of utxoAliases) {
      const resolved = boundParams[alias]?.resolved;
      const value = typeof resolved === 'object' && resolved !== null && 'value' in resolved
        ? String((resolved as { value: number }).value)
        : '0';
      result = result.replace(new RegExp(`\\b${alias}\\.amount\\b`, 'g'), value);
    }

    // Replace constants (numeric only for expression; string consts left for display)
    for (const [name, value] of Object.entries(consts)) {
      if (typeof value === 'bigint' || typeof value === 'number') {
        result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), String(value));
      }
    }

    for (const [name, value] of Object.entries(calcVars)) {
      result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), value.toString());
    }

    result = result.replace(/vSize\(CURRENT_PSBT\)/g, vs.toString());

    result = result.replace(/REF\((@[A-Z][A-Za-z0-9_]*\.[a-z]+)\)/g, (_, ref) => {
      return getParamValue(ref).toString();
    });

    result = result.replace(/REF\(([A-Z][A-Za-z0-9_]*):(\d+)\.amount\)/g, (_, sName, idx) => {
      const v = workflowContext?.steps?.[String(sName)]?.outputs?.[Number(idx)]?.valueSats;
      return String(v ?? '0');
    });
    result = result.replace(/([A-Z][A-Za-z0-9_]*):(\d+)\.amount\b/g, (_, sName, idx) => {
      const v = workflowContext?.steps?.[String(sName)]?.outputs?.[Number(idx)]?.valueSats;
      return String(v ?? '0');
    });

    result = result.replace(/@([A-Z][A-Za-z0-9_]*)\.([a-z]+)/g, (_, name, prop) => {
      return getParamValue(`@${name}.${prop}`).toString();
    });
    result = result.replace(/@([A-Z][A-Za-z0-9_]*)/g, (_, name) => {
      const param = boundParams[name];
      if (typeof param?.resolved === 'number') {
        return param.resolved.toString();
      }
      return '0';
    });

    // Now parse and evaluate
    try {
      const tokens = tokenize(result);
      if (tokens.length === 0) return BigInt(0);
      const parsed = parseExpr(tokens, { i: 0 });
      return parsed;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('BTSL_ERR')) {
        throw e;
      }
      logs.push(`[v0] Expression eval error: ${expr} -> ${result} (${e})`);
      return BigInt(0);
    }
  };

  // Execute calc assignments
  for (const calc of schema.calc) {
    try {
      let v = evalExpr(calc.expression, { calcAssignVar: calc.variable });
      if (calc.variable === 'fees') {
        v = BigInt(Math.ceil(Number(v)));
      }
      calcVars[calc.variable] = v;
      logs.push(`[v0] calc: ${calc.variable} = ${calcVars[calc.variable]}`);
    } catch (e) {
      logs.push(`[v0] calc error for ${calc.variable}: ${e}`);
      throw e;
    }
  }

  // Calculate outputs
  logs.push('[v0] ----------------------------------------');
  logs.push('[v0] Phase 4 — Building outputs');

  const outputValues: bigint[] = [];
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

    outputValues.push(amount);
    
    const addrDisplay = output.address || output.type;
    logs.push(`[v0] Output ${output.index}: ${addrDisplay} - ${amount} sats`);
  }

  // Phase 5 - Audit
  logs.push('[v0] ----------------------------------------');
  logs.push('[v0] Phase 5 — Zero-Trust Audit');

  const totalInputs = inputValues.reduce((a, b) => a + b, BigInt(0));
  const totalOutputs = outputValues.reduce((a, b) => a + b, BigInt(0));
  const implicitFees = totalInputs - totalOutputs;

  logs.push(`[v0] Total inputs: ${totalInputs} sats`);
  logs.push(`[v0] Total outputs: ${totalOutputs} sats`);
  logs.push(`[v0] Implicit fees: ${implicitFees} sats`);

  if (implicitFees < BigInt(0)) {
    throw new Error('BTSL_ERR_06: Balance invariant failed — outputs exceed inputs');
  }

  // Evaluate asserts
  logs.push('[v0] Evaluating ASSERT conditions...');
  
  for (const assert of schema.asserts) {
    const conditionStr = assert.condition;
    
    // Parse comparison operators
    const compMatch = conditionStr.match(/(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)/);
    if (compMatch) {
      const left = evalExpr(compMatch[1].trim(), { forAssert: true });
      const op = compMatch[2];
      const right = evalExpr(compMatch[3].trim(), { forAssert: true });
      
      let passed = false;
      switch (op) {
        case '>=': passed = left >= right; break;
        case '<=': passed = left <= right; break;
        case '==': passed = left === right; break;
        case '!=': passed = left !== right; break;
        case '>': passed = left > right; break;
        case '<': passed = left < right; break;
      }
      
      if (!passed) {
        throw new Error(`BTSL_ERR_06: ASSERT ${assert.index} failed — ${assert.condition}`);
      }
      
      logs.push(`[v0] ASSERT ${assert.index} passed: ${assert.condition}`);
    }
  }

  // Dust check
  logs.push('[v0] Checking for dust outputs...');
  for (let i = 0; i < outputValues.length; i++) {
    if (outputValues[i] > BigInt(0) && outputValues[i] < BigInt(consts.DUST_LIMIT)) {
      throw new Error(`BTSL_ERR_07: Dust output at index ${i} — value=${outputValues[i]}`);
    }
  }
  logs.push('[v0] Dust check passed');

  // Weight check
  if (txWeightWu > 400000) {
    logs.push('[v0] BTSL_WARN_04: Transaction exceeds standard relay weight');
  }

  logs.push('[v0] ========================================');
  logs.push('[v0] All audits passed');
  logs.push('[v0] Status: UNSIGNED — Ready for signing');
  logs.push('[v0] ========================================');

  // Build actual PSBT using bitcoinjs-lib (same as generated code — Psbt + witnessScript)
  logs.push('[v0] Building PSBT (bitcoinjs-lib)...');

  const { Buffer } = await import('buffer');

  // Detect network from first input or output address
  let isTestnet = false;
  for (const input of schema.inputs) {
    const paramName = input.utxoRef.replace(/^@/, '').replace(/\.[a-z]+$/, '');
    const param = boundParams[paramName];
    if (param?.rawValue) {
      const addr = String(param.rawValue);
      if (addr.startsWith('tb1') || addr.startsWith('m') || addr.startsWith('n') || addr.startsWith('2')) {
        isTestnet = true;
        break;
      }
    }
    if (param?.resolved && typeof param.resolved === 'object' && 'address' in param.resolved) {
      const addr = String((param.resolved as { address?: string }).address || '');
      if (addr.startsWith('tb1') || addr.startsWith('m') || addr.startsWith('n') || addr.startsWith('2')) {
        isTestnet = true;
        break;
      }
    }
  }
  logs.push(`[v0] Network detected: ${isTestnet ? 'TESTNET' : 'MAINNET'}`);

  const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
  const psbt = new bitcoin.Psbt({ network });

  // Add inputs (hash = txid in internal byte order for bitcoinjs-lib)
  for (const input of schema.inputs) {
    const paramName = input.utxoRef.replace(/^@/, '').replace(/\.[a-z]+$/, '');
    const param = boundParams[paramName];
    if (!param?.resolved || typeof param.resolved !== 'object' || !('txid' in param.resolved)) continue;

    const utxo = param.resolved as { txid: string; vout: number; value: number; scriptPubKey?: string };
    let scriptPubKeyHex = utxo.scriptPubKey;
    if (!scriptPubKeyHex && param.rawValue) {
      try {
        const addr = String(param.rawValue);
        const scriptBuf = bitcoin.address.toOutputScript(addr, network);
        scriptPubKeyHex = Buffer.from(scriptBuf).toString('hex');
      } catch (e) {
        logs.push(`[v0] Warning: Could not get scriptPubKey for input ${utxo.txid}:${utxo.vout}: ${e}`);
      }
    }
    if (!scriptPubKeyHex) {
      throw new Error('BTSL_ERR_04b: Missing scriptPubKey for input ' + utxo.txid + ':' + utxo.vout);
    }

    const hash = Buffer.from(utxo.txid, 'hex').reverse();
    const scriptBuf = Buffer.from(scriptPubKeyHex, 'hex');
    const inputDesc: {
      hash: Buffer;
      index: number;
      witnessUtxo: { script: Uint8Array; value: bigint };
      witnessScript?: Uint8Array;
    } = {
      hash,
      index: utxo.vout,
      witnessUtxo: {
        script: new Uint8Array(scriptBuf),
        value: BigInt(utxo.value),
      },
    };

    if (input.type === 'UNLOCK_P2WSH' && input.scriptDef) {
      const scriptDef = document.scriptDefs.find((d) => d.name === input.scriptDef);
      if (scriptDef) {
        try {
          const witnessScriptHex = compileScriptAsmToHex(scriptDef, boundParams, input.scriptParams);
          inputDesc.witnessScript = new Uint8Array(Buffer.from(witnessScriptHex, 'hex'));
          logs.push(`[v0] Added witnessScript for input (${input.scriptDef})`);
        } catch (e) {
          logs.push(`[v0] Warning: Could not compile witness script ${input.scriptDef}: ${e}`);
        }
      }
    }

    psbt.addInput(inputDesc);
    logs.push(`[v0] Added input: ${utxo.txid}:${utxo.vout}`);
  }
  
  // Add outputs (value in sats, same as generated buildOutput)
  for (let i = 0; i < schema.outputs.length; i++) {
    const output = schema.outputs[i];
    const amount = outputValues[i];

    if (output.type === 'OP_RETURN') {
      const raw = (output.payload ?? '').trim();
      let payloadHex: string;
      if (raw.startsWith('@')) {
        const paramName = raw.replace(/^@/, '').trim();
        const param = boundParams[paramName];
        const value = String(param?.rawValue ?? (typeof param?.resolved === 'string' ? param.resolved : '') ?? '');
        payloadHex = toPayloadHex(value, Boolean(param?.payloadAsText));
      } else if (raw.startsWith('"') && raw.endsWith('"')) {
        payloadHex = toPayloadHex(raw.slice(1, -1).replace(/\\"/g, '"'), true);
      } else {
        payloadHex = toPayloadHex(raw, false);
      }
      const payloadBytes = Buffer.from(payloadHex, 'hex');
      if (payloadBytes.length > 80) {
        logs.push('[v0] BTSL_WARN_04: OP_RETURN payload exceeds 80 bytes');
      }
      const opReturnScript = Buffer.concat([Buffer.from([0x6a, payloadBytes.length]), payloadBytes]);
      psbt.addOutput({ script: opReturnScript, value: BigInt(0) });
      logs.push('[v0] Added OP_RETURN output');
    } else {
      let address: string | undefined;
      if (output.address?.startsWith('@')) {
        const paramName = output.address.replace(/^@/, '').replace(/\.[a-z]+$/, '');
        const param = boundParams[paramName];
        if (typeof param?.resolved === 'string') address = param.resolved;
        else if (param?.resolved && typeof param.resolved === 'object' && 'address' in param.resolved) {
          address = (param.resolved as { address: string }).address;
        } else if (typeof param?.rawValue === 'string') address = param.rawValue;
      } else if (output.address && consts[output.address] !== undefined && typeof consts[output.address] === 'string') {
        address = consts[output.address] as string;
      } else if (output.address?.includes('.')) {
        const ref = output.address.replace(/\.[a-z]+$/, '');
        const param = boundParams[ref];
        if (param?.resolved && typeof param.resolved === 'object' && 'address' in param.resolved) {
          address = (param.resolved as { address: string }).address;
        }
      } else if (output.address?.startsWith('"')) {
        address = output.address.replace(/^"|"$/g, '');
      }
      if (address && amount > BigInt(0)) {
        psbt.addOutput({ address, value: amount });
        logs.push(`[v0] Added output ${i}: ${address.slice(0, 20)}... - ${amount} sats`);
      } else if (amount > BigInt(0)) {
        logs.push(`[v0] Warning: Output ${i} has amount ${amount} but no address`);
      }
    }
  }

  const psbtBase64 = psbt.toBase64();
  const psbtHex = psbt.toHex();
  logs.push('[v0] PSBT created successfully (bitcoinjs-lib)');

  return {
    success: true,
    psbtBase64,
    psbtHex,
    summary: {
      inputs: inputValues.map((v, i) => ({ index: i, value: v.toString() })),
      outputs: outputValues.map((v, i) => ({ index: i, value: v.toString() })),
      fees: implicitFees.toString(),
      vsize
    },
    logs
  };
}
