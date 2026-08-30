/**
 * Parse a `.params` file: one assignment per line, KEY=value (first "=" separates).
 * Empty lines and lines starting with # are ignored.
 */

import type { BoundParams, BTSLParam } from './types';

export interface ParseDotParamsFileResult {
  entries: Record<string, string>;
  /** Human-readable issues (e.g. empty key) */
  warnings: string[];
}

export function lookupParamsFileValue(
  entries: Record<string, string>,
  paramName: string
): string | undefined {
  if (entries[paramName] !== undefined) return entries[paramName];
  const aliases: Record<string, string[]> = {
    USER: ['USER_UTXO'],
    USER_UTXO: ['USER'],
    CHANGE_ADDR: ['CHANGE_ADDRESS'],
    CHANGE_ADDRESS: ['CHANGE_ADDR'],
  };
  for (const a of aliases[paramName] ?? []) {
    if (entries[a] !== undefined) return entries[a];
  }
  return undefined;
}

export function parseDotParamsFile(content: string): ParseDotParamsFileResult {
  const entries: Record<string, string> = {};
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) {
      warnings.push(`Line ${i + 1}: no "=" — skipped`);
      continue;
    }

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (!key) {
      warnings.push(`Line ${i + 1}: empty parameter name — skipped`);
      continue;
    }

    entries[key] = value;
  }

  return { entries, warnings };
}

/**
 * Insert or replace a single `KEY=value` line in `.params` text (comments and other keys preserved).
 */
export function upsertParamsFileLine(content: string, key: string, value: string): string {
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return line;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const k = trimmed.slice(0, eq).trim();
    if (k === key) {
      replaced = true;
      const indent = line.match(/^\s*/)?.[0] ?? '';
      return `${indent}${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    const tail = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    return (content.length === 0 ? '' : content + tail) + `${key}=${value}`;
  }
  return out.join('\n');
}

/**
 * For each schema param: **confirmed binding** (`boundParams.rawValue`) wins when non-empty;
 * otherwise use the `.params` file entry (air-gap / paste-only flows).
 */
export function mergeParamValuesWithParamsFile(
  params: BTSLParam[],
  boundParams: BoundParams | null,
  fileEntries: Record<string, string> | null | undefined
): Record<string, string> {
  const file = fileEntries ?? {};
  const out: Record<string, string> = {};
  for (const p of params) {
    const fromFile = lookupParamsFileValue(file, p.name)?.trim() ?? '';
    const fromForm = boundParams?.[p.name]?.rawValue?.trim() ?? '';
    out[p.name] = fromForm.length > 0 ? fromForm : fromFile;
  }
  return out;
}
