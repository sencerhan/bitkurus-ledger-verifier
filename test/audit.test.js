import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { auditLedgerExport } from '../src/audit.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'minimal-export.json');

test('audit passes hash checks with --no-signatures equivalent', async () => {
    const doc = JSON.parse(await readFile(fixturePath, 'utf8'));
    const result = await auditLedgerExport(doc, { skipSignatures: true });

    assert.equal(result.ok, true);
    assert.equal(result.stats.errors, 0);
});
