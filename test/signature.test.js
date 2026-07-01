import assert from 'node:assert/strict';
import test from 'node:test';
import { subtle } from 'node:crypto';
import { canonicalJson } from '../src/canonical.js';
import { verifyEd25519Signature } from '../src/crypto.js';
import { auditLedgerExport } from '../src/audit.js';

/** Sign canonicalJson(payload) with a raw Ed25519 private key, return hex. */
async function signCanonical(payload, privateKey) {
    const bytes = new TextEncoder().encode(canonicalJson(payload));
    const sig = await subtle.sign({ name: 'Ed25519' }, privateKey, bytes);

    return Buffer.from(sig).toString('hex');
}

async function freshWallet() {
    const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const rawPub = await subtle.exportKey('raw', pair.publicKey);

    return { pair, pubHex: Buffer.from(rawPub).toString('hex') };
}

// Regression: verifyEd25519Signature must return true for a valid signature.
// A swapped (algorithm, signature, key, data) call throws a TypeError that the
// internal try/catch swallows, so this guards the crypto.js argument order.
test('verifyEd25519Signature accepts a genuine signature', async () => {
    const { pair, pubHex } = await freshWallet();
    const payload = { a: 1, b: 'x', nested: { z: 2, y: 1 } };
    const sigHex = await signCanonical(payload, pair.privateKey);

    assert.equal(await verifyEd25519Signature(payload, sigHex, pubHex), true);
    assert.equal(await verifyEd25519Signature({ a: 2 }, sigHex, pubHex), false);
});

// Regression: a merge whose top-level inputs are ordered differently from the
// signed tx.payload must still verify (the export re-sorts top-level inputs,
// but canonical JSON preserves array order, so audit must verify tx.payload).
test('audit verifies a merge with reordered top-level inputs', async () => {
    const { pair, pubHex } = await freshWallet();

    // Original signing order (as the wallet selected them).
    const signedInputs = [
        { token_id: 'commission-token-zzzz', version: 1 },
        { token_id: 'apple-aaaa', version: 1 },
    ];
    const outputs = [{ owner: 'f'.repeat(64), token_id: 'wallet-merged-1', value: '3.000000000000000000' }];

    const payload = {
        tx_id: 'wallet-merge-1',
        type: 'merge',
        sender: pubHex,
        nonce: 'wallet-merge-1-nonce',
        inputs: signedInputs,
        outputs,
    };
    const signature = await signCanonical(payload, pair.privateKey);

    const doc = {
        canonical_hash: '0'.repeat(64), // hash checks not under test here
        tokens: [
            { token_id: 'commission-token-zzzz', owner: pubHex, value: '1.000000000000000000', version: 1, status: 'spent' },
            { token_id: 'apple-aaaa', owner: pubHex, value: '2.000000000000000000', version: 1, status: 'spent' },
        ],
        transactions: [
            {
                tx_id: 'wallet-merge-1',
                type: 'merge',
                sender: pubHex,
                nonce: 'wallet-merge-1-nonce',
                // Top-level inputs sorted by token_id — DIFFERENT order than signed.
                inputs: [
                    { token_id: 'apple-aaaa', version: 1 },
                    { token_id: 'commission-token-zzzz', version: 1 },
                ],
                outputs,
                signature,
                status: 'committed',
                fee_amount: '0.000000000000000000',
                payload,
            },
        ],
    };

    const result = await auditLedgerExport(doc);
    const sigIssues = result.issues.filter(
        (i) => i.code === 'invalid_signature' || i.code === 'payload_mismatch',
    );

    assert.deepEqual(sigIssues, []);
});

// A tx.payload that disagrees with the applied top-level effect must be caught,
// so a signed-but-unrelated payload cannot launder a tampered transaction.
test('audit rejects a tx.payload that mismatches top-level outputs', async () => {
    const { pair, pubHex } = await freshWallet();

    const payload = {
        tx_id: 'wallet-tx-1',
        type: 'transfer',
        sender: pubHex,
        nonce: 'wallet-tx-1-nonce',
        inputs: [{ token_id: 'apple-aaaa', version: 1 }],
        outputs: [{ owner: 'a'.repeat(64), token_id: 'out-1', value: '1.000000000000000000' }],
    };
    const signature = await signCanonical(payload, pair.privateKey);

    const doc = {
        canonical_hash: '0'.repeat(64),
        tokens: [{ token_id: 'apple-aaaa', owner: pubHex, value: '1.000000000000000000', version: 1, status: 'spent' }],
        transactions: [
            {
                tx_id: 'wallet-tx-1',
                type: 'transfer',
                sender: pubHex,
                nonce: 'wallet-tx-1-nonce',
                inputs: [{ token_id: 'apple-aaaa', version: 1 }],
                // Applied output pays a DIFFERENT owner than the signed payload.
                outputs: [{ owner: 'b'.repeat(64), token_id: 'out-1', value: '1.000000000000000000' }],
                signature,
                status: 'committed',
                fee_amount: '0.000000000000000000',
                payload,
            },
        ],
    };

    const result = await auditLedgerExport(doc);

    assert.equal(result.issues.some((i) => i.code === 'payload_mismatch'), true);
});
