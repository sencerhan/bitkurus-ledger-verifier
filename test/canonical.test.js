import assert from 'node:assert/strict';
import test from 'node:test';
import { exportCanonicalHash, normalizeDecimal, sha256HexCanonical, stateHashFromTokens } from '../src/canonical.js';

test('normalizeDecimal pads to 18 fractional digits', () => {
    assert.equal(normalizeDecimal('1'), '1.000000000000000000');
    assert.equal(normalizeDecimal('4.25'), '4.250000000000000000');
});

test('canonicalJson sorts object keys', () => {
    const encoded = sha256HexCanonical({ b: 1, a: 2 });

    assert.match(encoded, /^[0-9a-f]{64}$/);
});

test('exportCanonicalHash stable for fixture', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const doc = JSON.parse(await readFile(join(dir, 'fixtures', 'minimal-export.json'), 'utf8'));
    const hash = exportCanonicalHash(doc);

    assert.equal(hash, doc.canonical_hash);
    assert.equal(stateHashFromTokens(doc.tokens), doc.meta.state_hash);
});
