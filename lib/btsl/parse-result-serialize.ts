/**
 * Stable JSON serialization of ParseResult for corpus tests and future Rust parity.
 * Keys are sorted recursively so snapshots stay deterministic.
 */

import type { ParseResult } from './types';

function stripUndefined(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const v = stripUndefined(obj[key]);
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key]);
  }
  return sorted;
}

/** Shape stored in corpus snapshots (document omitted when parse failed). */
export interface ParseSnapshot {
  success: boolean;
  document?: unknown;
  params?: unknown;
  errors: unknown[];
  warnings: unknown[];
}

export function parseResultToSnapshot(result: ParseResult): ParseSnapshot {
  const base: ParseSnapshot = {
    success: result.success,
    errors: sortKeysDeep(stripUndefined(result.errors)) as unknown[],
    warnings: sortKeysDeep(stripUndefined(result.warnings)) as unknown[],
  };
  if (result.success && result.document) {
    base.document = sortKeysDeep(stripUndefined(result.document));
  }
  if (result.params !== undefined) {
    base.params = sortKeysDeep(stripUndefined(result.params));
  }
  return sortKeysDeep(base) as ParseSnapshot;
}

export function serializeParseResult(result: ParseResult): string {
  return JSON.stringify(parseResultToSnapshot(result), null, 2);
}
