import { describe, it, expect } from 'vitest';
import {
  parseDotParamsFile,
  mergeParamValuesWithParamsFile,
  upsertParamsFileLine,
} from '../lib/btsl/params-file';
import type { BoundParams, BTSLParam } from '../lib/btsl/types';

describe('parseDotParamsFile', () => {
  it('parses KEY=value lines', () => {
    const { entries, warnings } = parseDotParamsFile('FOO=bar\nBAZ=qux=with=equals');
    expect(warnings).toEqual([]);
    expect(entries.FOO).toBe('bar');
    expect(entries.BAZ).toBe('qux=with=equals');
  });

  it('ignores empty lines and # comments', () => {
    const { entries } = parseDotParamsFile('\n  # skip\nX=1\n');
    expect(entries).toEqual({ X: '1' });
  });

  it('warns on line without equals', () => {
    const { warnings } = parseDotParamsFile('nope');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('last duplicate key wins', () => {
    const { entries } = parseDotParamsFile('A=1\nA=2');
    expect(entries.A).toBe('2');
  });
});

describe('upsertParamsFileLine', () => {
  it('replaces an existing key', () => {
    const t = '# h\nFEE_RATE=2\nPUBKEY=03ab\n';
    expect(upsertParamsFileLine(t, 'FEE_RATE', '12')).toContain('FEE_RATE=12');
    expect(upsertParamsFileLine(t, 'FEE_RATE', '12')).not.toContain('FEE_RATE=2');
  });

  it('appends when key missing', () => {
    expect(upsertParamsFileLine('A=1', 'FEE_RATE', '6').trimEnd()).toBe('A=1\nFEE_RATE=6');
  });

  it('handles empty content', () => {
    expect(upsertParamsFileLine('', 'FEE_RATE', '3')).toBe('FEE_RATE=3');
  });
});

describe('mergeParamValuesWithParamsFile', () => {
  const params: BTSLParam[] = [
    { name: 'U', type: 'UTXO' },
    { name: 'R', type: 'ADDRESS' },
  ];

  it('prefers confirmed binding when non-empty over file', () => {
    const bound: BoundParams = {
      U: { type: 'UTXO', rawValue: 'aa'.repeat(32) + ':0', resolved: undefined as never },
      R: { type: 'ADDRESS', rawValue: 'bc1qold', resolved: 'bc1qold' },
    };
    const merged = mergeParamValuesWithParamsFile(params, bound, { U: 'bb'.repeat(32) + ':1' });
    expect(merged.U).toBe('aa'.repeat(32) + ':0');
    expect(merged.R).toBe('bc1qold');
  });

  it('uses file when binding rawValue is empty for that key', () => {
    const bound: BoundParams = {
      U: { type: 'UTXO', rawValue: '', resolved: undefined as never },
      R: { type: 'ADDRESS', rawValue: 'bc1qnew', resolved: 'bc1qnew' },
    };
    const merged = mergeParamValuesWithParamsFile(params, bound, { U: 'cc'.repeat(32) + ':0' });
    expect(merged.U).toBe('cc'.repeat(32) + ':0');
    expect(merged.R).toBe('bc1qnew');
  });

  it('falls back to form when file key missing or empty', () => {
    const bound: BoundParams = {
      U: { type: 'UTXO', rawValue: 'cc'.repeat(32) + ':0', resolved: undefined as never },
      R: { type: 'ADDRESS', rawValue: 'bc1qxx', resolved: 'bc1qxx' },
    };
    expect(mergeParamValuesWithParamsFile(params, bound, { U: '  ' }).U).toBe('cc'.repeat(32) + ':0');
    expect(mergeParamValuesWithParamsFile(params, bound, null).R).toBe('bc1qxx');
  });
});
