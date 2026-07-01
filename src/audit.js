import {
    canonicalJson,
    decimalToUnits,
    exportCanonicalHash,
    normalizeDecimal,
    stateHashFromTokens,
} from './canonical.js';
import { signingPayloadFromTransaction, verifyEd25519Signature } from './crypto.js';

/**
 * Compare two arrays as multisets of canonical JSON (order-independent).
 * @param {unknown[]} a
 * @param {unknown[]} b
 */
function sameMultiset(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }

    const key = (x) => canonicalJson(x);
    const left = a.map(key).sort();
    const right = b.map(key).sort();

    return left.every((v, i) => v === right[i]);
}

/**
 * The bytes that were actually signed live in tx.payload, which preserves the
 * original input/output element order. The top-level tx.inputs/outputs arrays
 * are re-sorted in the export, so reconstructing the payload from them yields
 * different canonical bytes and breaks verification for multi-input merges.
 *
 * Using tx.payload directly is only safe if it describes the same effect the
 * ledger applied — otherwise a signed-but-unrelated payload could pass. So we
 * also assert payload identity fields and input/output multisets match the
 * top-level transaction before trusting it.
 *
 * @returns {{ payload: object } | { mismatch: true } | null}
 */
function signedPayloadForTransaction(tx) {
    const reconstructed = signingPayloadFromTransaction(tx);

    if (!tx.payload || typeof tx.payload !== 'object') {
        return { payload: reconstructed };
    }

    const p = tx.payload;
    const scalarsMatch =
        p.tx_id === reconstructed.tx_id &&
        p.type === reconstructed.type &&
        p.sender === reconstructed.sender &&
        p.nonce === reconstructed.nonce;

    const setsMatch =
        sameMultiset(p.inputs ?? [], reconstructed.inputs) &&
        sameMultiset(p.outputs ?? [], reconstructed.outputs);

    if (!scalarsMatch || !setsMatch) {
        return { mismatch: true };
    }

    return { payload: p };
}

/**
 * @typedef {object} AuditIssue
 * @property {'error'|'warn'} level
 * @property {string} code
 * @property {string} message
 * @property {string} [tx_id]
 */

/**
 * @param {object} doc full ledger export
 * @param {{ skipSignatures?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, issues: AuditIssue[], stats: object, computed: object }>}
 */
export async function auditLedgerExport(doc, opts = {}) {
    const issues = /** @type {AuditIssue[]} */ ([]);
    const skipSignatures = opts.skipSignatures === true;

    const transactions = doc.transactions ?? [];
    const tokens = doc.tokens ?? [];
    const events = doc.ledger_events ?? [];

    const computedHash = exportCanonicalHash(doc);
    const declaredHash = String(doc.canonical_hash ?? '').toLowerCase();

    if (!/^[0-9a-f]{64}$/.test(declaredHash)) {
        issues.push({ level: 'error', code: 'canonical_hash_missing', message: 'canonical_hash missing or invalid' });
    } else if (declaredHash !== computedHash) {
        issues.push({
            level: 'error',
            code: 'canonical_hash_mismatch',
            message: `canonical_hash mismatch: declared ${declaredHash.slice(0, 16)}… computed ${computedHash.slice(0, 16)}…`,
        });
    }

    const computedState = stateHashFromTokens(tokens);
    const metaState = doc.meta?.state_hash ? String(doc.meta.state_hash).toLowerCase() : null;

    if (metaState && metaState !== computedState) {
        issues.push({
            level: 'error',
            code: 'state_hash_mismatch',
            message: 'meta.state_hash does not match active tokens in export',
        });
    }

    const tokenById = new Map(tokens.map((t) => [t.token_id, t]));

    for (const tx of transactions) {
        const txId = tx.tx_id;

        if (tx.status !== 'committed') {
            issues.push({
                level: 'error',
                code: 'non_committed_in_export',
                message: 'transaction status is not committed',
                tx_id: txId,
            });
        }

        const inputCount = tx.inputs?.length ?? 0;
        const outputCount = tx.outputs?.length ?? 0;

        if (tx.type === 'transfer' && (inputCount !== 1 || outputCount !== 1)) {
            issues.push({ level: 'error', code: 'transfer_shape', message: 'transfer must be 1→1', tx_id: txId });
        }

        if (tx.type === 'split' && (inputCount !== 1 || outputCount < 2)) {
            issues.push({ level: 'error', code: 'split_shape', message: 'split must be 1→2+', tx_id: txId });
        }

        if (tx.type === 'merge' && (inputCount < 2 || outputCount !== 1)) {
            issues.push({ level: 'error', code: 'merge_shape', message: 'merge must be N→1', tx_id: txId });
        }

        let inputSum = 0n;
        const seenInputs = new Set();

        for (const input of tx.inputs ?? []) {
            if (seenInputs.has(input.token_id)) {
                issues.push({ level: 'error', code: 'duplicate_input', message: 'duplicate input token_id', tx_id: txId });
            }

            seenInputs.add(input.token_id);

            const tok = tokenById.get(input.token_id);

            if (!tok) {
                issues.push({
                    level: 'warn',
                    code: 'input_token_not_in_tokens',
                    message: `input token ${input.token_id} not listed in tokens[] (may be burned)`,
                    tx_id: txId,
                });
            }

            if (tok) {
                try {
                    inputSum += decimalToUnits(tok.value);
                } catch (e) {
                    issues.push({
                        level: 'error',
                        code: 'invalid_token_value',
                        message: String(e.message ?? e),
                        tx_id: txId,
                    });
                }
            }
        }

        let outputSum = 0n;
        const seenOutputs = new Set();

        for (const output of tx.outputs ?? []) {
            if (seenOutputs.has(output.token_id)) {
                issues.push({ level: 'error', code: 'duplicate_output', message: 'duplicate output token_id', tx_id: txId });
            }

            seenOutputs.add(output.token_id);

            try {
                outputSum += decimalToUnits(output.value);
            } catch (e) {
                issues.push({
                    level: 'error',
                    code: 'invalid_output_value',
                    message: String(e.message ?? e),
                    tx_id: txId,
                });
            }

            const owner = String(output.owner ?? '');

            if (!/^[0-9a-f]{64}$/.test(owner)) {
                issues.push({ level: 'error', code: 'invalid_output_owner', message: 'output owner must be 64 hex', tx_id: txId });
            }
        }

        const fee = tx.fee_amount ? decimalToUnits(normalizeDecimal(tx.fee_amount)) : 0n;

        if (inputSum > 0n && outputSum > 0n && inputSum !== outputSum + fee) {
            issues.push({
                level: 'error',
                code: 'value_conservation',
                message: `sum(inputs) ${inputSum} != sum(outputs) ${outputSum} + fee ${fee}`,
                tx_id: txId,
            });
        }

        // System-minted transactions (validator commission / issuance) are not
        // Ed25519-signed by a wallet — they carry signature "system" and are
        // constrained by the issuance/conservation rules instead.
        const isSystemTx = tx.signature === 'system' || tx.type === 'issuance';

        if (!skipSignatures && !isSystemTx) {
            const signed = signedPayloadForTransaction(tx);

            if (signed?.mismatch) {
                issues.push({
                    level: 'error',
                    code: 'payload_mismatch',
                    message: 'tx.payload does not match top-level inputs/outputs/identity',
                    tx_id: txId,
                });
            } else {
                const ok = await verifyEd25519Signature(signed.payload, tx.signature, tx.sender);

                if (!ok) {
                    issues.push({
                        level: 'error',
                        code: 'invalid_signature',
                        message: 'Ed25519 signature does not verify over canonical signing payload',
                        tx_id: txId,
                    });
                }
            }
        }
    }

    const errors = issues.filter((i) => i.level === 'error');

    return {
        ok: errors.length === 0,
        issues,
        stats: {
            transactions: transactions.length,
            tokens: tokens.length,
            ledger_events: events.length,
            token_parents: (doc.token_parents ?? []).length,
            errors: errors.length,
            warnings: issues.filter((i) => i.level === 'warn').length,
        },
        computed: {
            canonical_hash: computedHash,
            state_hash: computedState,
        },
    };
}
