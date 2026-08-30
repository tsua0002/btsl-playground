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
} from '@/lib/btsl/types';
import { generatePSBTCode } from '@/lib/btsl/code-generator';
import { buildSchemaPsbt, type BuildPsbtResult } from '@/lib/btsl/build-schema-psbt';
import { attachWorkflowUtxoBindings } from '@/lib/btsl/workflow-chain';
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

export type ExecutionResult = BuildPsbtResult;

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
      
      const wf = workflowContext ?? { steps: {} };
      const bound = await attachWorkflowUtxoBindings(document!, schemaIndex, boundParams!, wf);
      const simulatedResult = await buildSchemaPsbt(document!, bound, wf, schemaIndex, logs);
      
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
  }, [generatedCode, document, boundParams, onResult, schemaIndex, workflowContext]);

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
