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
} from '@/lib/btsl/types';
import {
  buildConsts,
  collectInputValues,
  runCalcBlock,
  evaluateAsserts,
  checkImplicitBalance,
  checkDustOutputs,
  logWeightWarning,
  computeOutputAmounts,
} from '@/lib/btsl/runtime-expr';
import { generatePSBTCode } from '@/lib/btsl/code-generator';
import { compileScriptAsmToHex } from '@/lib/btsl/script-compiler';
import {
  buildOutputScriptsForPreciseVsize,
  computePreciseTxMetrics,
} from '@/lib/btsl/precise-weight';
import { buildOpReturnScript } from '@/lib/btsl/op-return-script';
import { buildScriptOutputPkScript } from '@/lib/btsl/script-output-pk';
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
          message: errorMsg,
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
                        log.startsWith('[BTSL]') ? 'text-green-400' :
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
                  <span className="block font-medium text-foreground">{executionResult.error.message}</span>
                  {ERROR_CODES[executionResult.error.code] &&
                    ERROR_CODES[executionResult.error.code] !== executionResult.error.message && (
                      <span className="mt-1 block text-xs opacity-90">
                        {ERROR_CODES[executionResult.error.code]}
                      </span>
                    )}
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

  logs.push('[BTSL] ========================================');
  logs.push('[BTSL] Starting BTSL PSBT Construction');
  logs.push(`[BTSL] Schema: ${schema.name}`);
  logs.push('[BTSL] ========================================');

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
  logs.push(`[BTSL] Precise vsize (BIP-141 template tx): ${vsize} vB, weight ${txWeightWu} wu`);

  const inputValues = collectInputValues(schema, boundParams);
  const sumInputs = inputValues.reduce((a, b) => a + b, BigInt(0));
  for (const input of schema.inputs) {
    const paramName = input.utxoRef.replace(/^@/, '');
    const param = boundParams[paramName];
    if (param?.resolved && typeof param.resolved === 'object' && 'value' in param.resolved) {
      const r = param.resolved as { txid: string; vout: number; value: number };
      logs.push(`[BTSL] Input ${input.index}: ${r.txid}:${r.vout} - ${r.value} sats`);
    }
  }
  logs.push(`[BTSL] Sum of inputs: ${sumInputs} sats`);

  logs.push('[BTSL] ----------------------------------------');
  logs.push('[BTSL] Phase 3 — Executing calc block');

  const logSink = { push: (s: string) => logs.push(s) };
  const consts = buildConsts(document, schema);

  let calcVars: Record<string, bigint>;
  try {
    calcVars = runCalcBlock(schema, document, boundParams, workflowContext, vsize, inputValues, {
      logs: logSink,
    });
  } catch (e) {
    logs.push(`[BTSL] calc error: ${e}`);
    throw e;
  }

  logs.push('[BTSL] ----------------------------------------');
  logs.push('[BTSL] Phase 4 — Building outputs');
  const outputValues = computeOutputAmounts(schema, consts, boundParams, calcVars);
  for (const output of schema.outputs) {
    const amt = outputValues[output.index] ?? BigInt(0);
    const addrDisplay = output.address || output.type;
    logs.push(`[BTSL] Output ${output.index}: ${addrDisplay} - ${amt} sats`);
  }

  logs.push('[BTSL] ----------------------------------------');
  logs.push('[BTSL] Phase 5 — Validation (pre-PSBT)');

  const totalInputs = inputValues.reduce((a, b) => a + b, BigInt(0));
  const totalOutputs = outputValues.reduce((a, b) => a + b, BigInt(0));
  logs.push(`[BTSL] Total inputs: ${totalInputs} sats`);
  logs.push(`[BTSL] Total outputs: ${totalOutputs} sats`);

  if (!('fees' in calcVars) && totalOutputs > totalInputs) {
    throw new Error('BTSL_ERR_06: Outputs exceed inputs (no `fees` in calc for implicit balance)');
  }

  try {
    evaluateAsserts(schema, document, boundParams, workflowContext, vsize, inputValues, calcVars, {
      logs: logSink,
    });
  } catch (e) {
    throw e;
  }

  try {
    checkImplicitBalance(totalInputs, totalOutputs, calcVars, logSink);
  } catch (e) {
    throw e;
  }

  const dustLimit =
    typeof consts.DUST_LIMIT === 'bigint' ? consts.DUST_LIMIT : BigInt(Number(consts.DUST_LIMIT));
  try {
    checkDustOutputs(schema, outputValues, dustLimit, logSink);
  } catch (e) {
    throw e;
  }

  logWeightWarning(txWeightWu, logSink);

  const implicitFees = totalInputs - totalOutputs;

  logs.push('[BTSL] ========================================');
  logs.push('[BTSL] All audits passed');
  logs.push('[BTSL] Status: UNSIGNED — Ready for signing');
  logs.push('[BTSL] ========================================');

  // Build actual PSBT using bitcoinjs-lib (same as generated code — Psbt + witnessScript)
  logs.push('[BTSL] Building PSBT (bitcoinjs-lib)...');

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
  logs.push(`[BTSL] Network detected: ${isTestnet ? 'TESTNET' : 'MAINNET'}`);

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
        logs.push(`[BTSL] Warning: Could not get scriptPubKey for input ${utxo.txid}:${utxo.vout}: ${e}`);
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
          logs.push(`[BTSL] Added witnessScript for input (${input.scriptDef})`);
        } catch (e) {
          logs.push(`[BTSL] Warning: Could not compile witness script ${input.scriptDef}: ${e}`);
        }
      }
    }

    psbt.addInput(inputDesc);
    logs.push(`[BTSL] Added input: ${utxo.txid}:${utxo.vout}`);
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
        logs.push('[BTSL] BTSL_WARN_04: OP_RETURN payload exceeds 80 bytes');
      }
      const opReturnScript = buildOpReturnScript(payloadBytes);
      psbt.addOutput({ script: opReturnScript, value: BigInt(0) });
      logs.push('[BTSL] Added OP_RETURN output');
    } else if (output.type === 'SCRIPT' && output.scriptDef) {
      const scriptPk = buildScriptOutputPkScript(document, output, boundParams, network);
      if (scriptPk && amount > BigInt(0)) {
        psbt.addOutput({ script: scriptPk, value: amount });
        logs.push(`[BTSL] Added output ${i}: SCRIPT ${output.scriptDef} - ${amount} sats`);
      } else if (amount > BigInt(0)) {
        logs.push(`[BTSL] Warning: Output ${i} SCRIPT ${output.scriptDef} — could not build scriptPubKey`);
      }
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
        logs.push(`[BTSL] Added output ${i}: ${address.slice(0, 20)}... - ${amount} sats`);
      } else if (amount > BigInt(0)) {
        logs.push(`[BTSL] Warning: Output ${i} has amount ${amount} but no address`);
      }
    }
  }

  const psbtBase64 = psbt.toBase64();
  const psbtHex = psbt.toHex();
  logs.push('[BTSL] PSBT created successfully (bitcoinjs-lib)');

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
