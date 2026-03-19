import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseBTSL } from '@/lib/btsl/parser';
import { parseResultToSnapshot } from '@/lib/btsl/parse-result-serialize';

const CORPUS_DIR = join(__dirname, 'corpus');

describe('BTSL parser corpus', () => {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.btsl'));

  it.each(files)('%s matches snapshot', (name) => {
    const source = readFileSync(join(CORPUS_DIR, name), 'utf-8');
    const result = parseBTSL(source);
    const snapshot = parseResultToSnapshot(result);
    expect(snapshot).toMatchSnapshot();
  });
});
