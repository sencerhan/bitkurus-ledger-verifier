import { createHash } from 'node:crypto';

/**
 * BitKuruş canonical JSON (matches PHP CanonicalJson + wallet.js).
 */
export function normalize(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalize(item));
    }

    if (value !== null && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((acc, key) => {
                acc[key] = normalize(value[key]);
                return acc;
            }, {});
    }

    return value;
}

export function canonicalJson(value) {
    return JSON.stringify(normalize(value));
}

export function sha256HexCanonical(value) {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * Export document hash: SHA-256(canonical_json({ledger_events, token_parents, tokens, transactions}))
 */
export function exportCanonicalHash(doc) {
    const body = {
        ledger_events: doc.ledger_events ?? [],
        token_parents: doc.token_parents ?? [],
        tokens: doc.tokens ?? [],
        transactions: doc.transactions ?? [],
    };

    return sha256HexCanonical(body);
}

/**
 * Active-set state_hash from export tokens[].
 */
export function stateHashFromTokens(tokens) {
    const active = tokens
        .filter((t) => t.status === 'active')
        .map((t) => ({
            token_id: t.token_id,
            owner: t.owner,
            value: normalizeDecimal(t.value),
            version: t.version,
        }))
        .sort((a, b) => (a.token_id < b.token_id ? -1 : a.token_id > b.token_id ? 1 : 0));

    return sha256HexCanonical(active);
}

export function normalizeDecimal(value) {
    const raw = String(value ?? '').trim();

    if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(raw)) {
        throw new Error(`Invalid decimal: ${value}`);
    }

    const [whole, fraction = ''] = raw.split('.');

    return `${whole}.${fraction.slice(0, 18).padEnd(18, '0')}`;
}

export function decimalToUnits(value) {
    const normalized = normalizeDecimal(value);
    const [whole, fraction] = normalized.split('.');

    return BigInt(whole) * 1000000000000000000n + BigInt(fraction);
}
