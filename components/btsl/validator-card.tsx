'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { ShieldCheck, XCircle, CheckCircle, Terminal } from 'lucide-react';
import type { ExecutionResult } from '@/components/btsl/code-generation-card';
import type { BTSLDocument, BTSLParam, BoundParams, WorkflowContext } from '@/lib/btsl/types';
import { ERROR_CODES } from '@/lib/btsl/types';
import { runCheckerPipeline } from '@/lib/btsl/checker-pipeline';
import { mergeParamValuesWithParamsFile } from '@/lib/btsl/params-file';
import { hydrateBoundParamsFromValues } from '@/lib/btsl/hydrate-bound-params';
import type { HydrateBoundParamsOptions } from '@/lib/btsl/hydrate-bound-params';

type ValidatorBindingHydrate = Omit<
  HydrateBoundParamsOptions,
  'payloadAsText' | 'existingPayloadAsTextFallback'
>;

interface ValidatorCardProps {
  document: BTSLDocument | null;
  schemaIndex: number;
  /** Same param list as the binding card (e.g. filtered by active schema). */
  schemaParams: BTSLParam[];
  /** Last synced `.params` entries; Checker fills gaps from here when a param has no confirmed rawValue yet. */
  paramsFileEntries: Record<string, string> | null;
  bindingHydrate: ValidatorBindingHydrate;
  boundParams: BoundParams | null;
  workflowContext: WorkflowContext;
  /** If you built a PSBT in the Maker tab, leaving the field empty can use this PSBT. */
  executionResult: ExecutionResult | null;
  schemaName: string | null;
  onValidationComplete?: (success: boolean) => void;
  disabled?: boolean;
}

const VALIDATOR_CARD_TITLE = 'Validator — Checker';

export function ValidatorCard({
  document,
  schemaIndex,
  schemaParams,
  paramsFileEntries,
  bindingHydrate,
  boundParams,
  workflowContext,
  executionResult,
  schemaName,
  onValidationComplete,
  disabled,
}: ValidatorCardProps) {
  const [psbtOverride, setPsbtOverride] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    setLogs([]);
    setLastError(null);
    setAuthorized(null);
  }, [executionResult?.psbtBase64, schemaName, schemaIndex]);

  const handleRun = useCallback(async () => {
    if (!document || !boundParams) return;
    const schema = document.schemas[schemaIndex];
    if (!schema) return;

    const raw = psbtOverride.trim();
    const psbtPayload =
      raw.length > 0 ? raw : executionResult?.success ? executionResult.psbtBase64 : undefined;
    if (!psbtPayload?.trim()) {
      setLastError({
        code: 'BTSL_ERR_00',
        message:
          'Paste a PSBT (base64 or hex). If you just built one in the Maker tab, leave this empty only after a successful Run there.',
      });
      setAuthorized(null);
      setLogs([]);
      return;
    }

    setIsRunning(true);
    setLastError(null);
    setAuthorized(null);
    setLogs([]);

    const mergedValues = mergeParamValuesWithParamsFile(schemaParams, boundParams, paramsFileEntries);
    const existingPayloadAsTextFallback: Record<string, boolean | undefined> = {};
    for (const p of schemaParams) {
      existingPayloadAsTextFallback[p.name] = boundParams[p.name]?.payloadAsText;
    }

    try {
      const hydrated = await hydrateBoundParamsFromValues(schemaParams, mergedValues, {
        ...bindingHydrate,
        workflowContext,
        payloadAsText: {},
        existingPayloadAsTextFallback,
      });
      if (!hydrated.ok) {
        setLastError({
          code: 'BTSL_ERR_04b',
          message: hydrated.errors.join(' '),
        });
        setAuthorized(null);
        setLogs([]);
        onValidationComplete?.(false);
        return;
      }

      const result = await runCheckerPipeline(
        psbtPayload.replace(/\s/g, ''),
        document,
        schema,
        hydrated.bound,
        workflowContext
      );

      setLogs(result.logs);
      setAuthorized(result.authorized);
      if (!result.success && result.error) {
        setLastError(result.error);
      }
      onValidationComplete?.(result.success);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError({ code: 'BTSL_ERR_00', message: msg });
      setLogs([`[checker] [ERROR] ${msg}`]);
      onValidationComplete?.(false);
    } finally {
      setIsRunning(false);
    }
  }, [
    document,
    boundParams,
    schemaParams,
    paramsFileEntries,
    bindingHydrate,
    executionResult,
    schemaIndex,
    workflowContext,
    psbtOverride,
    onValidationComplete,
  ]);

  if (disabled) {
    return (
      <Card id="btsl-validator-card" className="opacity-50 scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            {VALIDATOR_CARD_TITLE}
          </CardTitle>
          <CardDescription>
            Truth triplet: this schema + <code className="text-xs">.params</code> (bound above) + PSBT — spec §9.3 /
            guide Partie 2
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>Waiting for parameters</AlertTitle>
            <AlertDescription>
              Parse the <strong>.bts</strong> schema above, then click <strong>Confirm Parameters</strong> so the
              Checker can bind the same <code className="text-xs">.params</code> contract as the Maker.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="btsl-validator-card" className="scroll-mt-24">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              {VALIDATOR_CARD_TITLE}
            </CardTitle>
            <CardDescription>
              {schemaName ? (
                <span>
                  Active schema <span className="font-mono">{schemaName}</span> — chain values, calc replay, ASSERT,
                  balance
                </span>
              ) : (
                'Independent from Maker: you only need schema + params + PSBT to audit'
              )}
            </CardDescription>
          </div>
          {authorized === true && (
            <Badge className="bg-green-600 hover:bg-green-700">
              <CheckCircle className="mr-1 h-3 w-3" />
              Authorized
            </Badge>
          )}
          {lastError && (
            <Badge variant="destructive">
              <XCircle className="mr-1 h-3 w-3" />
              {lastError.code}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="psbt-override">
            PSBT to audit (base64 or hex){' '}
            {!executionResult?.success && (
              <span className="text-muted-foreground font-normal">— or from a successful Maker Run (same session)</span>
            )}
          </Label>
          <Textarea
            id="psbt-override"
            placeholder={
              executionResult?.success
                ? 'Leave empty to use the PSBT from the Maker tab (last Run), or paste any PSBT…'
                : 'Paste PSBT base64 or hex (wallet, coordinator, or run Maker first then leave empty if wired)'
            }
            value={psbtOverride}
            onChange={(e) => setPsbtOverride(e.target.value)}
            className="font-mono text-xs min-h-[80px]"
          />
        </div>

        <Button className="w-full" onClick={() => void handleRun()} disabled={isRunning}>
          {isRunning ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Running Checker…
            </>
          ) : (
            <>
              <ShieldCheck className="mr-2 h-4 w-4" />
              Run Checker validation
            </>
          )}
        </Button>

        {lastError && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>{lastError.code}</AlertTitle>
            <AlertDescription>
              <span className="block font-medium text-foreground">{lastError.message}</span>
              {ERROR_CODES[lastError.code] && ERROR_CODES[lastError.code] !== lastError.message && (
                <span className="mt-1 block text-xs opacity-90">{ERROR_CODES[lastError.code]}</span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {authorized === true && !lastError && (
          <Alert className="border-green-500 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800">Checker passed</AlertTitle>
            <AlertDescription className="text-green-700">
              All steps 2.2–2.4 satisfied — signing is logically authorized (no keys used here).
            </AlertDescription>
          </Alert>
        )}

        {logs.length > 0 && (
          <div className="rounded-lg border bg-slate-900 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
              <Terminal className="h-4 w-4" />
              Checker log
            </div>
            <div className="max-h-[240px] overflow-auto font-mono text-xs">
              {logs.map((line, idx) => (
                <div
                  key={idx}
                  className={`py-0.5 ${
                    line.includes('[ERROR]') || line.includes('mismatch')
                      ? 'text-red-400'
                      : line.startsWith('[checker]')
                        ? 'text-green-400'
                        : 'text-slate-300'
                  }`}
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
