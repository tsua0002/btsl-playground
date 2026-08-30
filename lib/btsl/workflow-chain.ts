/**
 * Bind workflow-chained UTXOs from in-memory parent outputs / predicted txid,
 * then optionally build every remaining schema in a DEPENDS_ON chain.
 */

import type { BoundParams, BTSLDocument, WorkflowContext } from './types';
import { buildSchemaPsbt, type BuildPsbtResult } from './build-schema-psbt';
import { resolveWorkflowUtxo } from './workflow-utxo';

export async function attachWorkflowUtxoBindings(
  document: BTSLDocument,
  schemaIndex: number,
  bound: BoundParams,
  workflow: WorkflowContext
): Promise<BoundParams> {
  const schema = document.schemas[schemaIndex];
  if (!schema) return bound;
  const next: BoundParams = { ...bound };
  for (const inp of schema.inputs ?? []) {
    if (!inp.workflowRef) continue;
    const name = inp.utxoRef.replace(/^@/, '');
    const parent = workflow.steps[inp.workflowRef.schemaName];
    const existing = next[name]?.resolved;
    const raw =
      next[name]?.rawValue?.trim() ||
      (existing && typeof existing === 'object' && 'txid' in existing
        ? `${(existing as { txid: string }).txid}:${(existing as { vout: number }).vout}`
        : '') ||
      parent?.txid ||
      '';
    const resolved = await resolveWorkflowUtxo({
      paramName: name,
      rawValue: raw,
      ref: inp.workflowRef,
      step: parent,
    });
    if (!resolved.ok) throw new Error(resolved.error);
    next[name] = {
      type: 'UTXO',
      rawValue: `${resolved.utxo.txid}:${resolved.utxo.vout}`,
      resolved: resolved.utxo,
    };
  }
  return next;
}

export function applyPsbtResultToWorkflow(
  workflow: WorkflowContext,
  schemaName: string,
  result: BuildPsbtResult
): WorkflowContext {
  if (!result.success || !result.summary) return workflow;
  const predictedTxid = result.summary.predictedTxid?.trim();
  return {
    steps: {
      ...workflow.steps,
      [schemaName]: {
        ...(workflow.steps[schemaName] ?? {}),
        ...(predictedTxid ? { txid: predictedTxid } : {}),
        outputs: result.summary.outputs.map((o) => ({
          index: o.index,
          valueSats: o.value,
          scriptPubKey: o.scriptPubKey,
        })),
      },
    },
  };
}

/**
 * Build unsigned PSBTs from `fromIndex` through the last schema (inclusive).
 * Parent need not be on-chain: each hop uses predicted txid + local output scripts.
 */
export async function buildRemainingWorkflowPsbt(opts: {
  document: BTSLDocument;
  fromIndex: number;
  boundParams: BoundParams;
  workflowContext: WorkflowContext;
}): Promise<{
  results: Record<string, BuildPsbtResult>;
  workflow: WorkflowContext;
}> {
  let workflow = opts.workflowContext;
  const results: Record<string, BuildPsbtResult> = {};
  for (let i = opts.fromIndex; i < opts.document.schemas.length; i++) {
    const schema = opts.document.schemas[i];
    const bound = await attachWorkflowUtxoBindings(opts.document, i, opts.boundParams, workflow);
    const logs: string[] = [];
    const result = await buildSchemaPsbt(opts.document, bound, workflow, i, logs);
    results[schema.name] = result;
    if (!result.success) {
      return { results, workflow };
    }
    workflow = applyPsbtResultToWorkflow(workflow, schema.name, result);
  }
  return { results, workflow };
}
