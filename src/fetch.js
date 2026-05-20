/**
 * @param {string} source file path or http(s) URL
 * @returns {Promise<object>}
 */
export async function loadLedgerExport(source) {
    const trimmed = String(source).trim();

    if (/^https?:\/\//i.test(trimmed)) {
        const res = await fetch(trimmed, {
            headers: { Accept: 'application/json' },
            redirect: 'follow',
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status} fetching ${trimmed}`);
        }

        return /** @type {object} */ (await res.json());
    }

    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const path = resolve(trimmed);
    const raw = await readFile(path, 'utf8');

    return JSON.parse(raw);
}

/**
 * @param {string} baseUrl e.g. https://bitkurus.org
 */
export async function fetchStateHash(baseUrl) {
    const root = baseUrl.replace(/\/$/, '');
    const res = await fetch(`${root}/api/state`, { headers: { Accept: 'application/json' } });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${root}/api/state`);
    }

    const json = await res.json();
    const hash = json?.state_hash ?? json?.data?.state_hash;

    if (!hash) {
        throw new Error('state_hash not found in /api/state response');
    }

    return String(hash).toLowerCase();
}
