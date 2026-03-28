'use client';

import { useState, useCallback, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { CheckCircle, XCircle, AlertTriangle, Link2, Zap, Lock, FileUp, Camera, FlaskConical } from 'lucide-react';
import { QRScanner } from '@/components/btsl/qr-scanner';
import type { WorkflowContext, WorkflowOutputRef } from '@/lib/btsl/types';
import { BTSLParam, BoundParams, ResolvedUTXO, ParamType } from '@/lib/btsl/types';
import { fetchUTXO, fetchFeeRate, fetchUTXOByPubkey, fetchUTXOByAddress, validateAddress, validateHexData, parseUTXOString, type PubkeyAddressType } from '@/lib/btsl/api';
import { parseDotParamsFile, upsertParamsFileLine } from '@/lib/btsl/params-file';
import { hydrateBoundParamsFromValues } from '@/lib/btsl/hydrate-bound-params';

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
  /** Called when the user applies a `.params` file so the Validator can prefer these entries over the form. */
  onParamsFileApplied?: (entries: Record<string, string>) => void;
  disabled?: boolean;
  /** Pre-fill values from example selection */
  prefillValues?: Record<string, string>;
  /** Called once prefill values have been applied */
  onPrefillConsumed?: () => void;
  /** Optional playground demo: full `.params` text applied like “Apply to fields” */
  demoParamsTemplate?: string;
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
  onParamsFileApplied,
  disabled,
  prefillValues,
  onPrefillConsumed,
  demoParamsTemplate,
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
  const [paramsFileText, setParamsFileText] = useState('');
  const [paramsFileWarnings, setParamsFileWarnings] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const paramNamesKey = params.map((p) => p.name).join('\0');
  /** Last @PUBKEY (or @ADDRESS) value we successfully resolved per derived UTXO alias — avoids duplicate Blockstream calls. */
  const derivedAutoSuccessSourceRef = useRef<Record<string, string>>({});
  useEffect(() => {
    setParamsFileText('');
    setParamsFileWarnings([]);
    derivedAutoSuccessSourceRef.current = {};
  }, [paramNamesKey]);

  const updateParamState = useCallback((name: string, updates: Partial<ParamState>) => {
    setParamStates(prev => {
      const base = prev[name];
      const next = { ...base, ...updates };
      if (next.value === undefined) next.value = base?.value ?? '';
      return { ...prev, [name]: next };
    });
  }, []);

  const fetchUtxoByRaw = useCallback(
    async (paramName: string, raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      const parsed = parseUTXOString(trimmed);
      if (!parsed) {
        updateParamState(paramName, {
          error: 'Invalid format. Use txid:vout (64 hex chars:number)',
          isValid: false,
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
          error: undefined,
        });
      } catch (error) {
        updateParamState(paramName, {
          error: error instanceof Error ? error.message : 'Failed to fetch UTXO',
          isLoading: false,
          isValid: false,
        });
      }
    },
    [updateParamState]
  );

  const handleFetchUTXO = useCallback(
    async (paramName: string) => {
      const state = paramStates[paramName];
      if (!state?.value) return;
      await fetchUtxoByRaw(paramName, state.value);
    },
    [paramStates, fetchUtxoByRaw]
  );

  const plainUtxoParamNames = useMemo(
    () =>
      params
        .filter(
          (p) =>
            p.type === 'UTXO' &&
            !derivedParamSources[p.name] &&
            !workflowDerivedUtxos[p.name]
        )
        .map((p) => p.name),
    [params, derivedParamSources, workflowDerivedUtxos]
  );

  const plainUtxoValuesKey = useMemo(
    () => plainUtxoParamNames.map((n) => paramStates[n]?.value ?? '').join('\0'),
    [plainUtxoParamNames, paramStates]
  );

  const paramStatesRef = useRef(paramStates);
  paramStatesRef.current = paramStates;

  useEffect(() => {
    if (disabled) return;
    const t = setTimeout(() => {
      const latest = paramStatesRef.current;
      for (const name of plainUtxoParamNames) {
        const st = latest[name];
        const v = st?.value?.trim() ?? '';
        const parsed = parseUTXOString(v);
        if (!parsed) continue;
        if (st?.isLoading) continue;
        const r = st?.resolved;
        if (r && typeof r === 'object' && r !== null && 'txid' in r && 'vout' in r) {
          const ru = r as ResolvedUTXO;
          if (ru.txid.toLowerCase() === parsed.txid.toLowerCase() && ru.vout === parsed.vout) continue;
        }
        void fetchUtxoByRaw(name, v);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [disabled, plainUtxoParamNames, plainUtxoValuesKey, fetchUtxoByRaw]);

  const handleFetchFeeRate = useCallback(async (paramName: string) => {
    updateParamState(paramName, { isLoading: true, error: undefined });

    try {
      const fees = await fetchFeeRate();
      const rateStr = String(fees.fastestFee);
      updateParamState(paramName, {
        value: rateStr,
        resolved: fees.fastestFee,
        isLoading: false,
        isValid: true,
        error: undefined,
      });
      setParamsFileText((prev) => {
        const next = upsertParamsFileLine(prev, paramName, rateStr);
        if (onParamsFileApplied) {
          const { entries } = parseDotParamsFile(next);
          queueMicrotask(() => onParamsFileApplied(entries));
        }
        return next;
      });
    } catch (error) {
      updateParamState(paramName, { 
        error: error instanceof Error ? error.message : 'Failed to fetch fee rate',
        isLoading: false,
        isValid: false
      });
    }
  }, [updateParamState, onParamsFileApplied]);

  const handleFetchDerivedUTXO = useCallback(
    async (aliasParamName: string, statesSnapshot?: Record<string, ParamState>) => {
      const sourceParam = derivedParamSources[aliasParamName];
      if (!sourceParam) return;
      const states = statesSnapshot ?? paramStates;
      const sourceState = states[sourceParam];
      const raw = typeof sourceState?.resolved === 'string' ? sourceState.resolved : sourceState?.value;
      if (!raw?.trim()) {
        const t = derivedParamSourceTypes[aliasParamName] ?? 'PUBKEY';
        updateParamState(aliasParamName, { error: `Set @${sourceParam} (${t.toLowerCase()}) first`, isValid: false });
        return;
      }
      const trimmed = raw.trim();
      updateParamState(aliasParamName, { isLoading: true, error: undefined });
      try {
        const srcType = derivedParamSourceTypes[aliasParamName] ?? 'PUBKEY';
        const utxo =
          srcType === 'ADDRESS'
            ? await fetchUTXOByAddress(trimmed)
            : await fetchUTXOByPubkey(trimmed, 'mainnet', derivedParamAddressTypes[aliasParamName] ?? 'P2WPKH');
        derivedAutoSuccessSourceRef.current[aliasParamName] = trimmed;
        updateParamState(aliasParamName, {
          value: `${utxo.txid}:${utxo.vout}`,
          resolved: utxo,
          isLoading: false,
          isValid: true,
          error: undefined,
        });
      } catch (e) {
        delete derivedAutoSuccessSourceRef.current[aliasParamName];
        updateParamState(aliasParamName, {
          error: e instanceof Error ? e.message : 'Failed to fetch UTXO from source',
          isLoading: false,
          isValid: false,
        });
      }
    },
    [derivedParamSources, derivedParamSourceTypes, derivedParamAddressTypes, paramStates, updateParamState]
  );

  const derivedSourceValuesKey = useMemo(() => {
    return params
      .filter((p) => p.type === 'UTXO' && derivedParamSources[p.name])
      .map((p) => {
        const src = derivedParamSources[p.name];
        return `${p.name}:${src}:${paramStates[src]?.value ?? ''}`;
      })
      .join('|');
  }, [params, derivedParamSources, paramStates]);

  useEffect(() => {
    if (disabled) return;
    const t = window.setTimeout(() => {
      const latest = paramStatesRef.current;
      for (const p of params) {
        if (p.type !== 'UTXO') continue;
        const alias = p.name;
        const src = derivedParamSources[alias];
        if (!src) continue;
        const srcState = latest[src];
        const raw =
          (typeof srcState?.resolved === 'string' ? srcState.resolved : srcState?.value)?.trim() ?? '';
        if (!raw) continue;
        const srcType = derivedParamSourceTypes[alias] ?? 'PUBKEY';
        if (srcType === 'PUBKEY') {
          const hex = raw.replace(/^0x/i, '');
          if (!/^[0-9a-fA-F]{66}$/.test(hex)) continue;
        } else if (srcType === 'ADDRESS') {
          if (!validateAddress(raw).valid) continue;
        }
        const st = latest[alias];
        if (st?.isLoading) continue;
        if (derivedAutoSuccessSourceRef.current[alias] === raw && st?.isValid === true) continue;
        void handleFetchDerivedUTXO(alias, latest);
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [disabled, params, derivedParamSources, derivedParamSourceTypes, derivedSourceValuesKey, handleFetchDerivedUTXO]);

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

  const paramsFileInputRef = useRef<HTMLInputElement>(null);

  const handleParamsFileChosen = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setParamsFileText(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleApplyParamsFile = useCallback(() => {
    const { entries, warnings } = parseDotParamsFile(paramsFileText);
    setParamsFileWarnings(warnings);
    for (const p of params) {
      if (entries[p.name] !== undefined) {
        handleValueChange(p, entries[p.name]);
      }
    }
    onParamsFileApplied?.(entries);
    window.setTimeout(() => {
      for (const p of params) {
        if (p.type !== 'UTXO') continue;
        if (derivedParamSources[p.name] || workflowDerivedUtxos[p.name]) continue;
        const v = entries[p.name];
        if (v === undefined) continue;
        if (!parseUTXOString(v.trim())) continue;
        void fetchUtxoByRaw(p.name, v);
      }
    }, 0);
  }, [
    paramsFileText,
    params,
    handleValueChange,
    onParamsFileApplied,
    derivedParamSources,
    workflowDerivedUtxos,
    fetchUtxoByRaw,
  ]);

  const handleLoadDemoParams = useCallback(() => {
    const text = demoParamsTemplate?.trim();
    if (!text) return;
    setParamsFileText(text);
    const { entries, warnings } = parseDotParamsFile(text);
    setParamsFileWarnings(warnings);
    for (const p of params) {
      if (entries[p.name] !== undefined) {
        handleValueChange(p, entries[p.name]);
      }
    }
    onParamsFileApplied?.(entries);
    window.setTimeout(() => {
      for (const p of params) {
        if (p.type !== 'UTXO') continue;
        if (derivedParamSources[p.name] || workflowDerivedUtxos[p.name]) continue;
        const v = entries[p.name];
        if (v === undefined) continue;
        if (!parseUTXOString(v.trim())) continue;
        void fetchUtxoByRaw(p.name, v);
      }
    }, 0);
  }, [
    demoParamsTemplate,
    params,
    handleValueChange,
    onParamsFileApplied,
    derivedParamSources,
    workflowDerivedUtxos,
    fetchUtxoByRaw,
  ]);

  const handleConfirmParameters = useCallback(async () => {
    setIsValidating(true);
    setValidationErrors([]);

    const values: Record<string, string> = {};
    params.forEach((p) => {
      values[p.name] = paramStates[p.name]?.value || '';
    });

    const result = await hydrateBoundParamsFromValues(params, values, {
      payloadParamNames,
      payloadAsText,
      derivedParamSources,
      derivedParamSourceTypes,
      derivedParamAddressTypes,
      workflowDerivedUtxos,
      workflowContext: workflowContext ?? { steps: {} },
    });

    if (!result.ok) {
      setValidationErrors(result.errors);
      setIsValidating(false);
      return;
    }

    setIsValidating(false);
    onBound(result.bound);
  }, [
    params,
    paramStates,
    payloadParamNames,
    payloadAsText,
    derivedParamSources,
    derivedParamSourceTypes,
    derivedParamAddressTypes,
    workflowDerivedUtxos,
    workflowContext,
    onBound,
  ]);

  const allValid = params.every((p) => {
    const state = paramStates[p.name] ?? { value: '' };
    const v = state.value?.trim() ?? '';

    if (p.type === 'UTXO') {
      if (derivedParamSources[p.name]) {
        const src = derivedParamSources[p.name];
        const srcState = paramStates[src] ?? { value: '' };
        const sv = srcState.value?.trim() ?? '';
        if (!sv) return false;
        return srcState.isValid !== false;
      }
      if (workflowDerivedUtxos[p.name]) {
        return true;
      }
      if (!v) return false;
      return /^[0-9a-fA-F]{64}:\d+$/.test(v);
    }

    if (!v) return false;
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

        {!disabled && params.length > 0 && demoParamsTemplate?.trim() && (
          <Alert className="border-primary/35 bg-primary/5">
            <FlaskConical className="h-4 w-4 text-primary" />
            <AlertTitle>Recommended next step</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Click <strong>Load demo fixture</strong> below to paste the playground&apos;s <span className="font-mono">.params</span>{' '}
              snippet and fill every field (including UTXO lookup from pubkey where the schema uses{' '}
              <span className="font-mono">From(@PUBKEY)</span>). Real mainnet data for testing only — you cannot sign without the
              keys. Then click <strong>Confirm Parameters</strong> so Maker and Validator share the same binding.
            </AlertDescription>
          </Alert>
        )}

        {!disabled && params.length > 0 && (
          <div
            id="btsl-params-load-section"
            className="rounded-lg border bg-muted/30 p-4 space-y-2 scroll-mt-24"
          >
            <div className="space-y-1">
              <Label className="text-sm font-semibold">Load PARAMS</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Paste <span className="font-mono">.params</span> text (<code className="text-xs">KEY=value</code> per line,{' '}
                <code className="text-xs">#</code> comments allowed) or choose a file
                {demoParamsTemplate?.trim() ? (
                  <> — or use the playground demo fixture button.</>
                ) : (
                  <>.</>
                )}
              </p>
            </div>
            <Textarea
              value={paramsFileText}
              onChange={(e) => setParamsFileText(e.target.value)}
              placeholder={'MY_UTXO=ab12...ef:0\nFEE_RATE=12'}
              className="font-mono text-xs min-h-[72px]"
              spellCheck={false}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={paramsFileInputRef}
                type="file"
                accept=".params,.txt,text/plain"
                className="hidden"
                onChange={handleParamsFileChosen}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => paramsFileInputRef.current?.click()}
              >
                <FileUp className="mr-2 h-4 w-4" />
                Choose file
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleApplyParamsFile}
                disabled={!paramsFileText.trim()}
              >
                Apply to fields
              </Button>
              {demoParamsTemplate?.trim() ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleLoadDemoParams}
                  title="Pastes the bundled .params text, applies all KEY=value lines to the form, and triggers chain lookup for UTXOs where applicable"
                >
                  <FlaskConical className="mr-2 h-4 w-4" />
                  Load demo fixture
                </Button>
              ) : null}
            </div>
            {demoParamsTemplate?.trim() ? (
              <p className="text-xs text-muted-foreground">
                One click loads the same values our Quick Start examples use. Schemas with <span className="font-mono">From(@PUBKEY)</span>{' '}
                also auto-resolve a UTXO from Blockstream after the pubkey is set — no extra click needed unless you change the key.
              </p>
            ) : null}
            {paramsFileWarnings.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500">{paramsFileWarnings.join(' · ')}</p>
            )}
            <p className="text-xs text-muted-foreground">
              After <strong>Confirm Parameters</strong>, the Checker uses your confirmed field values; the box above stays
              in sync when you use <strong>Fetch Current</strong> on fee rate. Use Apply to load a file, then Confirm so
              Maker and Validator share the same binding.
            </p>
          </div>
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
