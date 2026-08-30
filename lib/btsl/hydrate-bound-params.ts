/**
 * Build fully resolved BoundParams from raw string values (e.g. form + .params file).
 * Used by the Validator when merging file-prioritized values and by Confirm auto-fetch.
 */

import type {
  BoundParams,
  BTSLParam,
  ParamType,
  WorkflowContext,
  WorkflowOutputRef,
} from './types';
import { validateBoundParams } from './parser';
import {
  fetchUTXO,
  fetchUTXOByAddress,
  fetchUTXOByPubkey,
  parseUTXOString,
  validateAddress,
  validateHexData,
  type PubkeyAddressType,
} from './api';
import { parseWorkflowOutpoint, resolveWorkflowUtxo } from './workflow-utxo';

export interface HydrateBoundParamsOptions {
  payloadParamNames: string[];
  payloadAsText: Record<string, boolean>;
  derivedParamSources: Record<string, string>;
  derivedParamSourceTypes: Record<string, ParamType>;
  derivedParamAddressTypes: Record<string, PubkeyAddressType>;
  workflowDerivedUtxos: Record<string, WorkflowOutputRef>;
  workflowContext: WorkflowContext;
  /**
   * When hydrating from a string-only source, reuse payload-as-text flags from an existing binding.
   */
  existingPayloadAsTextFallback?: Record<string, boolean | undefined>;
}

function typeResolvedForParam(
  param: BTSLParam,
  raw: string,
  payloadParamNames: string[],
  payloadAsText: Record<string, boolean>
): { resolved?: BoundParams[string]['resolved']; error?: string } {
  switch (param.type) {
    case 'ADDRESS': {
      const result = validateAddress(raw);
      if (!result.valid) return { error: 'Invalid Bitcoin address format' };
      return { resolved: raw };
    }
    case 'FEERATE': {
      const feeRate = parseFloat(raw);
      if (isNaN(feeRate) || feeRate <= 0) return { error: 'Fee rate must be a positive number' };
      return { resolved: feeRate };
    }
    case 'PUBKEY': {
      const hex = raw.replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]{66}$/.test(hex)) {
        return { error: 'Pubkey must be 33-byte compressed (66 hex chars)' };
      }
      return { resolved: hex };
    }
    case 'HEX_DATA':
      if (payloadParamNames.includes(param.name)) {
        return { resolved: raw };
      }
      if (!validateHexData(raw)) return { error: 'Invalid hex format' };
      return { resolved: raw };
    case 'SATOSHI': {
      const satValue = parseInt(raw, 10);
      if (isNaN(satValue) || satValue < 0) return { error: 'Must be a non-negative integer' };
      return { resolved: satValue };
    }
    case 'UNTYPED':
      return { resolved: raw };
    default:
      return {};
  }
}

export async function hydrateBoundParamsFromValues(
  params: BTSLParam[],
  inputValues: Record<string, string>,
  opts: HydrateBoundParamsOptions
): Promise<{ ok: true; bound: BoundParams } | { ok: false; errors: string[] }> {
  const payloadAsText: Record<string, boolean> = { ...opts.payloadAsText };
  for (const p of params) {
    if (opts.existingPayloadAsTextFallback?.[p.name] !== undefined && payloadAsText[p.name] === undefined) {
      payloadAsText[p.name] = Boolean(opts.existingPayloadAsTextFallback[p.name]);
    }
  }

  const values: Record<string, string> = { ...inputValues };
  for (const p of params) {
    const wf = opts.workflowDerivedUtxos[p.name];
    if (!wf) continue;
    const step = opts.workflowContext?.steps?.[wf.schemaName];
    const op = parseWorkflowOutpoint(values[p.name] ?? '', wf.vout, step?.txid);
    if (op) values[p.name] = `${op.txid}:${op.vout}`;
  }

  const { valid, errors } = validateBoundParams(params, values, {
    payloadParamNames: opts.payloadParamNames,
  });
  if (!valid) {
    return { ok: false, errors: errors.map((e) => e.message) };
  }

  const bound: BoundParams = {};

  for (const p of params) {
    const raw = values[p.name] ?? '';

    if (p.type === 'UTXO') {
      const source = opts.derivedParamSources[p.name];
      if (source) {
        const srcRaw = values[source]?.trim() ?? '';
        const srcType = opts.derivedParamSourceTypes[p.name] ?? 'PUBKEY';
        if (!srcRaw) {
          return {
            ok: false,
            errors: [`UTXO @${p.name}: set @${source} (${srcType.toLowerCase()}) first`],
          };
        }
        try {
          const utxo =
            srcType === 'ADDRESS'
              ? await fetchUTXOByAddress(srcRaw)
              : await fetchUTXOByPubkey(
                  srcRaw,
                  'mainnet',
                  opts.derivedParamAddressTypes[p.name] ?? 'P2WPKH'
                );
          bound[p.name] = {
            type: p.type,
            rawValue: `${utxo.txid}:${utxo.vout}`,
            resolved: utxo,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, errors: [`UTXO @${p.name}: ${msg}`] };
        }
        continue;
      }

      const wf = opts.workflowDerivedUtxos[p.name];
      if (wf) {
        const resolved = await resolveWorkflowUtxo({
          paramName: p.name,
          rawValue: raw,
          ref: wf,
          step: opts.workflowContext?.steps?.[wf.schemaName],
        });
        if (!resolved.ok) {
          return { ok: false, errors: [resolved.error] };
        }
        bound[p.name] = {
          type: p.type,
          rawValue: `${resolved.utxo.txid}:${resolved.utxo.vout}`,
          resolved: resolved.utxo,
        };
        continue;
      }

      const parsed = parseUTXOString(raw);
      if (!parsed) {
        return {
          ok: false,
          errors: [`UTXO @${p.name}: invalid format (expected txid:vout)`],
        };
      }
      try {
        const utxo = await fetchUTXO(parsed.txid, parsed.vout);
        bound[p.name] = {
          type: p.type,
          rawValue: raw,
          resolved: utxo,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, errors: [`UTXO @${p.name}: ${msg}`] };
      }
      continue;
    }

    const typed = typeResolvedForParam(p, raw, opts.payloadParamNames, payloadAsText);
    if (typed.error) {
      return { ok: false, errors: [`@${p.name}: ${typed.error}`] };
    }

    bound[p.name] = {
      type: p.type,
      rawValue: raw,
      resolved: typed.resolved,
      ...(opts.payloadParamNames.includes(p.name) && {
        payloadAsText: Boolean(
          payloadAsText[p.name] ?? opts.existingPayloadAsTextFallback?.[p.name]
        ),
      }),
    };
  }

  return { ok: true, bound };
}
