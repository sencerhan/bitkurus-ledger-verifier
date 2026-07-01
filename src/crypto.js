import { subtle } from 'node:crypto';
import { canonicalJson } from './canonical.js';

function hexToBytes(hex, expectedLen, label) {
    const s = String(hex ?? '').toLowerCase();

    if (!/^[0-9a-f]+$/.test(s) || s.length !== expectedLen * 2) {
        throw new Error(`Invalid ${label} hex length`);
    }

    const out = new Uint8Array(expectedLen);

    for (let i = 0; i < expectedLen; i++) {
        out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    }

    return out;
}

/**
 * @param {object} signingPayload tx_id, type, sender, nonce, inputs, outputs
 */
export async function verifyEd25519Signature(signingPayload, signatureHex, publicKeyHex) {
    try {
        const signature = hexToBytes(signatureHex, 64, 'signature');
        const publicKey = hexToBytes(publicKeyHex, 32, 'public key');
        const message = new TextEncoder().encode(canonicalJson(signingPayload));

        const key = await subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);

        // WebCrypto is verify(algorithm, key, signature, data) — the CryptoKey must
        // be the 2nd argument. Passing (algo, signature, key, …) throws a TypeError
        // that the catch below swallows, silently failing every signature check.
        return await subtle.verify({ name: 'Ed25519' }, key, signature, message);
    } catch {
        return false;
    }
}

export function signingPayloadFromTransaction(tx) {
    return {
        tx_id: tx.tx_id,
        type: tx.type,
        sender: tx.sender,
        nonce: tx.nonce,
        inputs: tx.inputs,
        outputs: tx.outputs,
    };
}
