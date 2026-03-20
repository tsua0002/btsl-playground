'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { CheckCircle, XCircle, AlertTriangle, Link2, Zap, Lock, Camera } from 'lucide-react';
import { QRScanner } from '@/components/btsl/qr-scanner';
import type { WorkflowContext, WorkflowOutputRef } from '@/lib/btsl/types';
import { BTSLParam, BoundParams, ResolvedUTXO, ERROR_CODES, WARNING_CODES, ParamType } from '@/lib/btsl/types';
import { fetchUTXO, fetchFeeRate, fetchUTXOByPubkey, fetchUTXOByAddress, validateAddress, validateHexData, parseUTXOString, type PubkeyAddressType } from '@/lib/btsl/api';
import { validateBoundParams } from '@/lib/btsl/parser';

interface ParameterBindingCardProps {
  params: BTSLParam[];
  /** Param names used as OP_RETURN payload (e.g. PAYLOAD) — show "Treat as text" checkbox */
  payloadParamNames?: string[];
  /** Derived UTXO params: alias -> source param name (e.g. selected_utxo -> PUBKEY) */
  derivedParamSources?: Record<string, string>;
  /** Derived UTXO params: alias -> source param type (PUBKEY or ADDRESS) */
  derivedParamSourceTypes?: Record<string, ParamType>;
  /** Address type per derived UTXO alias (P2WPKH / P2TR / P2PKH) from INPUT line */
  derivedParamAddressTypes?: Record<string, PubkeyAddressType>;
  /** Derived workflow UTXO params: internal param name -> workflow output ref */
  workflowDerivedUtxos?: Record<string, WorkflowOutputRef>;
  workflowContext?: WorkflowContext;
  onBound: (boundParams: BoundParams) => void;
  disabled?: boolean;
  /** Pre-fill values from example selection */
  prefillValues?: Record<string, string>;
  /** Called once prefill values have been applied */
  onPrefillConsumed?: () => void;
}

interface ParamState {
  value: string;
  resolved?: ResolvedUTXO | number | string;
  error?: string;
  isLoading?: boolean;
  isValid?: boolean;
}

export function ParameterBindingCard({
  params,
  payloadParamNames = [],
  derivedParamSources = {},
  derivedParamSourceTypes = {},
  derivedParamAddressTypes = {},
  workflowDerivedUtxos = {},
  workflowContext,
  onBound,
  disabled,
  prefillValues,
  onPrefillConsumed,
}: ParameterBindingCardProps) {
  const [paramStates, setParamStates] = useState<Record<string, ParamState>>(() => {
    const initial: Record<string, ParamState> = {};
    params.forEach(p => {
      initial[p.name] = { value: '' };
    });
    return initial;
  });

  useEffect(() => {
    setParamStates((prev) => {
      const next = { ...prev };
      for (const p of params) {
        if (!next[p.name]) next[p.name] = { value: '' };
        if (next[p.name].value === undefined) next[p.name].value = '';
      }
      return next;
    });
  }, [params]);

  // Apply prefill values from example selection (non-UTXO only — UTXOs need real data)
  const [appliedPrefillKey, setAppliedPrefillKey] = useState<string | null>(null);
  useEffect(() => {
    if (!prefillValues) return;
    const prefillKey = JSON.stringify(prefillValues);
    if (prefillKey === appliedPrefillKey) return;

    setParamStates((prev) => {
      const next = { ...prev };
      for (const p of params) {
        if (p.type === 'UTXO') continue; // UTXOs require real data, skip
        const val = prefillValues[p.name];
        if (val !== undefined && val !== '') {
          next[p.name] = { ...(next[p.name] ?? {}), value: val, isValid: undefined, error: undefined };
        }
      }
      return next;
    });

    setAppliedPrefillKey(prefillKey);
    onPrefillConsumed?.();
  }, [prefillValues, params, appliedPrefillKey, onPrefillConsumed]);

  const [payloadAsText, setPayloadAsText] = useState<Record<string, boolean>>({});
  const [isValidating, setIsValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const updateParamState = useCallback((name: string, updates: Partial<ParamState>) => {
    setParamStates(prev => {
      const base = prev[name];
      const next = { ...base, ...updates };
      if (next.value === undefined) next.value = base?.value ?? '';
      return { ...prev, [name]: next };
    });
  }, []);

  const handleFetchUTXO = useCallback(async (paramName: string) => {
    const state = paramStates[paramName];
    if (!state?.value) return;

    const parsed = parseUTXOString(state.value);
    if (!parsed) {
      updateParamState(paramName, { 
        error: 'Invalid format. Use txid:vout (64 hex chars:number)',
        isValid: false
      });
      return;
    }

    updateParamState(paramName, { isLoading: true, error: undefined });

    try {
      const utxo = await fetchUTXO(parsed.txid, parsed.vout);
      updateParamState(paramName, { 
        resolved: utxo, 
        isLoading: false, 
        isValid: true,
        error: undefined
      });
    } catch (error) {
      updateParamState(paramName, { 
        error: error instanceof Error ? error.message : 'Failed to fetch UTXO',
        isLoading: false,
        isValid: false
      });
    }
  }, [paramStates, updateParamState]);

  const handleFetchFeeRate = useCallback(async (paramName: string) => {
    updateParamState(paramName, { isLoading: true, error: undefined });

    try {
      const fees = await fetchFeeRate();
      updateParamState(paramName, { 
        value: String(fees.fastestFee),
        resolved: fees.fastestFee,
        isLoading: false, 
        isValid: true,
        error: undefined
      });
    } catch (error) {
      updateParamState(paramName, { 
        error: error instanceof Error ? error.message : 'Failed to fetch fee rate',
        isLoading: false,
        isValid: false
      });
    }
  }, [updateParamState]);

  const handleFetchDerivedUTXO = useCallback(async (aliasParamName: string) => {
    const sourceParam = derivedParamSources[aliasParamName];
    if (!sourceParam) return;
    const sourceState = paramStates[sourceParam];
    const raw = typeof sourceState?.resolved === 'string' ? sourceState.resolved : sourceState?.value;
    if (!raw?.trim()) {
      const t = derivedParamSourceTypes[aliasParamName] ?? 'PUBKEY';
      updateParamState(aliasParamName, { error: `Set @${sourceParam} (${t.toLowerCase()}) first`, isValid: false });
      return;
    }
    updateParamState(aliasParamName, { isLoading: true, error: undefined });
    try {
      const srcType = derivedParamSourceTypes[aliasParamName] ?? 'PUBKEY';
      const utxo =
        srcType === 'ADDRESS'
          ? await fetchUTXOByAddress(raw.trim())
          : await fetchUTXOByPubkey(raw.trim(), 'mainnet', derivedParamAddressTypes[aliasParamName] ?? 'P2WPKH');
      updateParamState(aliasParamName, {
        value: `${utxo.txid}:${utxo.vout}`,
        resolved: utxo,
        isLoading: false,
        isValid: true,
        error: undefined
      });
    } catch (e) {
      updateParamState(aliasParamName, {
        error: e instanceof Error ? e.message : 'Failed to fetch UTXO from source',
        isLoading: false,
        isValid: false
      });
    }
  }, [derivedParamSources, derivedParamSourceTypes, derivedParamAddressTypes, paramStates, updateParamState]);

  const handleFetchUTXOFromWorkflow = useCallback(async (paramName: string) => {
    const ref = workflowDerivedUtxos[paramName];
    if (!ref) return;
    const step = workflowContext?.steps?.[ref.schemaName];
    const txid = step?.txid;
    if (!txid) {
      updateParamState(paramName, {
        error: `Missing txid for workflow step ${ref.schemaName} — set it after signing/broadcast`,
        isValid: false,
      });
      return;
    }
    updateParamState(paramName, { isLoading: true, error: undefined });
    try {
      const utxo = await fetchUTXO(txid.trim(), ref.vout);
      updateParamState(paramName, {
        value: `${utxo.txid}:${utxo.vout}`,
        resolved: utxo,
        isLoading: false,
        isValid: true,
        error: undefined,
      });
    } catch (e) {
      updateParamState(paramName, {
        error: e instanceof Error ? e.message : 'Failed to fetch workflow UTXO',
        isLoading: false,
        isValid: false,
      });
    }
  }, [workflowContext, workflowDerivedUtxos, updateParamState]);

  const handleValueChange = useCallback((param: BTSLParam, value: string) => {
    const updates: Partial<ParamState> = { value, error: undefined };

    // Inline validation based on type
    switch (param.type) {
      case 'ADDRESS':
        if (value) {
          const result = validateAddress(value);
          updates.isValid = result.valid;
          updates.resolved = value;
          if (!result.valid) {
            updates.error = 'Invalid Bitcoin address format';
          }
        }
        break;

      case 'FEERATE':
        const feeRate = parseFloat(value);
        if (value && (isNaN(feeRate) || feeRate <= 0)) {
          updates.error = 'Fee rate must be a positive number';
          updates.isValid = false;
        } else if (value) {
          updates.isValid = true;
          updates.resolved = feeRate;
        }
        break;

      case 'PUBKEY':
        if (value) {
          const hex = value.replace(/^0x/i, '');
          if (/^[0-9a-fA-F]{66}$/.test(hex)) {
            updates.isValid = true;
            updates.resolved = hex;
          } else {
            updates.error = 'Pubkey must be 33-byte compressed (66 hex chars)';
            updates.isValid = false;
          }
        }
        break;

      case 'HEX_DATA':
        // When used as OP_RETURN payload, accept any string (hex or text; "Treat as text" decides conversion)
        if (payloadParamNames.includes(param.name)) {
          if (value) {
            updates.isValid = true;
            updates.resolved = value;
          }
        } else if (value && !validateHexData(value)) {
          updates.error = 'Invalid hex format (use 0x prefix or raw hex)';
          updates.isValid = false;
        } else if (value) {
          updates.isValid = true;
          updates.resolved = value;
        }
        break;

      case 'SATOSHI':
        const satValue = parseInt(value, 10);
        if (value && (isNaN(satValue) || satValue < 0)) {
          updates.error = 'Must be a non-negative integer';
          updates.isValid = false;
        } else if (value) {
          updates.isValid = true;
          updates.resolved = satValue;
        }
        break;

      case 'UTXO':
        // Don't auto-validate UTXO, wait for fetch
        updates.isValid = undefined;
        updates.resolved = undefined;
        break;

      default:
        // Untyped - accept any value
        if (value) {
          updates.isValid = true;
          updates.resolved = value;
        }
        break;
    }

    updateParamState(param.name, updates);
  }, [updateParamState, payloadParamNames]);

  const handleConfirmParameters = useCallback(async () => {
    setIsValidating(true);
    setValidationErrors([]);

    // Build values map
    const values: Record<string, string> = {};
    params.forEach(p => {
      values[p.name] = paramStates[p.name]?.value || '';
    });

    // Validate all parameters
    const { valid, errors, warnings } = validateBoundParams(params, values, { payloadParamNames });

    // Check all UTXOs are resolved
    const unresolvedUtxos = params
      .filter(p => p.type === 'UTXO')
      .filter(p => !paramStates[p.name]?.resolved);

    if (unresolvedUtxos.length > 0) {
      setValidationErrors([
        ...errors.map(e => e.message),
        ...unresolvedUtxos.map(p => `UTXO @${p.name} not resolved - click Fetch to resolve`)
      ]);
      setIsValidating(false);
      return;
    }

    if (!valid) {
      setValidationErrors(errors.map(e => e.message));
      setIsValidating(false);
      return;
    }

    // Build bound params
    const boundParams: BoundParams = {};
    params.forEach(p => {
      const state = paramStates[p.name];
      boundParams[p.name] = {
        type: p.type,
        rawValue: state?.value || '',
        resolved: state?.resolved,
        ...(payloadParamNames.includes(p.name) && { payloadAsText: Boolean(payloadAsText[p.name]) })
      };
    });

    setIsValidating(false);
    onBound(boundParams);
  }, [params, paramStates, onBound]);

  const allValid = params.every(p => {
    const state = paramStates[p.name];
    if (!state?.value) return false;
    if (p.type === 'UTXO' && !state.resolved) return false;
    return state.isValid !== false;
  });

  const renderParamInput = (param: BTSLParam) => {
    const state = paramStates[param.name] || { value: '' };

    return (
      <div key={param.name} className="space-y-2 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <Label htmlFor={param.name} className="flex items-center gap-2 font-mono text-sm">
            @{param.name}
            <Badge variant="outline" className="text-xs">
              {param.type === 'UNTYPED' ? (
                <span className="flex items-center gap-1 text-yellow-600">
                  <AlertTriangle className="h-3 w-3" />
                  UNTYPED
                </span>
              ) : (
                param.type
              )}
            </Badge>
          </Label>
          {state.isValid === true && (
            <CheckCircle className="h-4 w-4 text-green-600" />
          )}
          {state.isValid === false && (
            <XCircle className="h-4 w-4 text-red-600" />
          )}
        </div>

        <div className="flex gap-2">
          {param.type === 'UTXO' && (
            <>
              {derivedParamSources[param.name] ? (
                <>
                  <Input
                    id={param.name}
                    placeholder={`From @${derivedParamSources[param.name]} — click Fetch`}
                    value={state.value}
                    readOnly
                    className="font-mono text-sm bg-muted"
                    disabled={disabled}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFetchDerivedUTXO(param.name)}
                    disabled={disabled || state.isLoading}
                  >
                    {state.isLoading ? <Spinner className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                    Fetch from @{derivedParamSources[param.name]}
                  </Button>
                </>
              ) : workflowDerivedUtxos[param.name] ? (
                <>
                  <Input
                    id={param.name}
                    placeholder={`From workflow ${workflowDerivedUtxos[param.name].schemaName}:${workflowDerivedUtxos[param.name].outputIndex} — click Resolve`}
                    value={state.value}
                    readOnly
                    className="font-mono text-sm bg-muted"
                    disabled={disabled}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFetchUTXOFromWorkflow(param.name)}
                    disabled={disabled || state.isLoading}
                  >
                    {state.isLoading ? <Spinner className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                    Resolve from workflow
                  </Button>
                </>
              ) : (
                <>
                  <Input
                    id={param.name}
                    placeholder="txid:vout (e.g., abc123...def:0)"
                    value={state.value}
                    onChange={(e) => handleValueChange(param, e.target.value)}
                    className="font-mono text-sm"
                    disabled={disabled}
                  />
                  <QRScanner
                    onScan={(data) => handleValueChange(param, data.trim())}
                    title={`Scan UTXO QR for @${param.name}`}
                    trigger={
                      <button
                        type="button"
                        className="flex items-center justify-center h-9 w-9 rounded-md border border-input bg-background hover:bg-muted transition-colors shrink-0"
                        title="Scan QR code"
                        disabled={disabled}
                      >
                        <Camera className="h-4 w-4 text-muted-foreground" />
                      </button>
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFetchUTXO(param.name)}
                    disabled={disabled || !state.value || state.isLoading}
                  >
                    {state.isLoading ? <Spinner className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                    Fetch
                  </Button>
                </>
              )}
            </>
          )}

          {param.type === 'PUBKEY' && (
            <Input
              id={param.name}
              placeholder="33-byte compressed pubkey (66 hex chars)"
              value={state.value}
              onChange={(e) => handleValueChange(param, e.target.value)}
              className="font-mono text-sm"
              disabled={disabled}
            />
          )}

          {param.type === 'FEERATE' && (
            <>
              <Input
                id={param.name}
                type="number"
                placeholder="sat/vByte"
                value={state.value}
                onChange={(e) => handleValueChange(param, e.target.value)}
                className="font-mono text-sm"
                disabled={disabled}
                min={1}
                step={1}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleFetchFeeRate(param.name)}
                disabled={disabled || state.isLoading}
              >
                {state.isLoading ? <Spinner className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                Fetch Current
              </Button>
            </>
          )}

          {param.type === 'ADDRESS' && (
            <>
              <Input
                id={param.name}
                placeholder="bc1q... or 1... or 3..."
                value={state.value}
                onChange={(e) => handleValueChange(param, e.target.value)}
                className="font-mono text-sm"
                disabled={disabled}
              />
              <QRScanner
                onScan={(data) => handleValueChange(param, data.trim())}
                title={`Scan address QR for @${param.name}`}
                trigger={
                  <button
                    type="button"
                    className="flex items-center justify-center h-9 w-9 rounded-md border border-input bg-background hover:bg-muted transition-colors shrink-0"
                    title="Scan QR code"
                    disabled={disabled}
                  >
                    <Camera className="h-4 w-4 text-muted-foreground" />
                  </button>
                }
              />
            </>
          )}

          {param.type === 'HEX_DATA' && (
            <Input
              id={param.name}
              placeholder="0x... or raw hex"
              value={state.value}
              onChange={(e) => handleValueChange(param, e.target.value)}
              className="font-mono text-sm"
              disabled={disabled}
            />
          )}

          {param.type === 'SATOSHI' && (
            <Input
              id={param.name}
              type="number"
              placeholder="Amount in satoshis"
              value={state.value}
              onChange={(e) => handleValueChange(param, e.target.value)}
              className="font-mono text-sm"
              disabled={disabled}
              min={0}
              step={1}
            />
          )}

          {param.type === 'UNTYPED' && (
            <Input
              id={param.name}
              placeholder="Enter value..."
              value={state.value}
              onChange={(e) => handleValueChange(param, e.target.value)}
              className="font-mono text-sm"
              disabled={disabled}
            />
          )}
        </div>

        {/* OP_RETURN payload: treat as text (UTF-8 → hex) */}
        {payloadParamNames.includes(param.name) && (
          <label className="flex items-center gap-2 mt-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={payloadAsText[param.name] ?? false}
              onChange={(e) => setPayloadAsText(prev => ({ ...prev, [param.name]: e.target.checked }))}
              disabled={disabled}
              className="rounded border-input"
            />
            <span>Treat as text (UTF-8 → hex for OP_RETURN)</span>
          </label>
        )}

        {/* Error message */}
        {state.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}

        {/* Resolved UTXO info */}
        {param.type === 'UTXO' && state.resolved && typeof state.resolved === 'object' && 'value' in state.resolved && (
          <div className="mt-2 rounded border bg-muted/50 p-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Value:</span>
              <span className="font-semibold">{state.resolved.value.toLocaleString()} sats</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type:</span>
              <span>{state.resolved.scriptType}</span>
            </div>
            {state.resolved.address && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Address:</span>
                <span className="truncate max-w-[200px]">{state.resolved.address}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className={disabled ? 'opacity-50' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Card 2 - Parameter Binding
            </CardTitle>
            <CardDescription>
              Bind values to the {params.length} detected parameters
            </CardDescription>
          </div>
          {allValid && (
            <Badge variant="default" className="bg-green-600 hover:bg-green-700">
              <CheckCircle className="mr-1 h-3 w-3" />
              All Valid
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Waiting for Schema</AlertTitle>
            <AlertDescription>
              Parse a valid BTSL schema first to unlock parameter binding.
            </AlertDescription>
          </Alert>
        )}

        {!disabled && params.length === 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No Parameters</AlertTitle>
            <AlertDescription>
              This schema has no @PARAM declarations.
            </AlertDescription>
          </Alert>
        )}

        {!disabled && params.map(renderParamInput)}

        {validationErrors.length > 0 && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Validation Errors</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 mt-2 space-y-1">
                {validationErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Button 
          onClick={handleConfirmParameters} 
          className="w-full"
          disabled={disabled || !allValid || isValidating}
        >
          {isValidating ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Validating...
            </>
          ) : (
            'Confirm Parameters'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
