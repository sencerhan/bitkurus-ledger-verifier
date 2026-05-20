#!/usr/bin/env node

import { auditLedgerExport } from '../src/audit.js';
import { exportCanonicalHash } from '../src/canonical.js';
import { loadLedgerExport, fetchStateHash } from '../src/fetch.js';

const HELP = `bitkurus-verify — BitKuruş ledger auditor (Node 18+)

Usage:
  bitkurus-verify audit <file-or-url> [more…]     Full audit (hash, signatures, conservation)
  bitkurus-verify compare <url-or-file> …         Cross-check canonical_hash across sources
  bitkurus-verify hash <file-or-url>              Print recomputed canonical_hash only
  bitkurus-verify fetch <node-url> [-o file.json] Download /api/ledger/export

Examples:
  bitkurus-verify audit https://bitkurus.org/api/ledger/export
  bitkurus-verify compare https://bitkurus.org https://bitlira.tr
  bitkurus-verify audit export.json --no-signatures

Options:
  --no-signatures    Skip Ed25519 checks (faster; hash-only audit)
  --json             Machine-readable report on stdout
  -o, --output       Write fetched export to file (fetch command)
`;

function parseArgs(argv) {
    const args = [...argv];
    const flags = {
        json: false,
        noSignatures: false,
        output: null,
    };

    const positional = [];

    for (let i = 0; i < args.length; i++) {
        const a = args[i];

        if (a === '--json') {
            flags.json = true;
        } else if (a === '--no-signatures') {
            flags.noSignatures = true;
        } else if (a === '-o' || a === '--output') {
            flags.output = args[++i] ?? null;
        } else if (a === '--help' || a === '-h') {
            flags.help = true;
        } else {
            positional.push(a);
        }
    }

    return { positional, flags };
}

function printHumanAudit(label, result) {
    const status = result.ok ? 'OK' : 'FAIL';
    const prefix = label ? `[${label}] ` : '';

    console.log(`${prefix}${status} — ${result.stats.transactions} tx, ${result.stats.tokens} tokens, ${result.stats.errors} errors, ${result.stats.warnings} warnings`);
    console.log(`  canonical_hash: ${result.computed.canonical_hash}`);

    if (result.computed.state_hash) {
        console.log(`  state_hash:     ${result.computed.state_hash}`);
    }

    for (const issue of result.issues) {
        const tag = issue.level === 'error' ? 'ERROR' : 'WARN';
        const tx = issue.tx_id ? ` (${issue.tx_id})` : '';

        console.log(`  ${tag} [${issue.code}]${tx} ${issue.message}`);
    }
}

async function cmdAudit(sources, flags) {
    let failed = false;

    for (const source of sources) {
        const started = performance.now();
        const doc = await loadLedgerExport(source);
        const result = await auditLedgerExport(doc, { skipSignatures: flags.noSignatures });
        const ms = Math.round(performance.now() - started);

        if (flags.json) {
            console.log(JSON.stringify({ source, ms, ...result }, null, 2));
        } else {
            printHumanAudit(source, result);
            console.log(`  elapsed: ${ms}ms`);
        }

        if (!result.ok) {
            failed = true;
        }
    }

    return failed ? 1 : 0;
}

async function cmdCompare(sources, flags) {
    const entries = [];

    for (const source of sources) {
        const started = performance.now();
        const doc = await loadLedgerExport(source);
        const hash = exportCanonicalHash(doc);
        const declared = String(doc.canonical_hash ?? '').toLowerCase();
        const ms = Math.round(performance.now() - started);

        entries.push({
            source,
            ms,
            computed: hash,
            declared: declared || null,
            match: !declared || declared === hash,
            byteLength: JSON.stringify(doc).length,
        });
    }

    const unique = new Set(entries.map((e) => e.computed));
    const converged = unique.size === 1 && entries.every((e) => e.match);

    if (flags.json) {
        console.log(JSON.stringify({ converged, entries }, null, 2));
    } else {
        for (const e of entries) {
            console.log(`${e.source}`);
            console.log(`  computed: ${e.computed}`);
            console.log(`  declared: ${e.declared ?? '(none)'}`);
            console.log(`  self-ok:  ${e.match ? 'yes' : 'NO'}`);
            console.log(`  ${e.ms}ms, ~${Math.round(e.byteLength / 1024)} KiB JSON`);
        }

        console.log(converged ? '\nCONVERGED — all sources agree on canonical_hash' : '\nDIVERGED — hashes differ');
    }

    return converged ? 0 : 1;
}

async function cmdHash(source, flags) {
    const doc = await loadLedgerExport(source);
    const hash = exportCanonicalHash(doc);

    if (flags.json) {
        console.log(JSON.stringify({ source, canonical_hash: hash, declared: doc.canonical_hash ?? null }));
    } else {
        console.log(hash);
    }

    return 0;
}

async function cmdFetch(source, flags) {
    const root = source.replace(/\/$/, '');
    const url = root.includes('/api/ledger/export') ? root : `${root}/api/ledger/export`;
    const doc = await loadLedgerExport(url);
    const raw = JSON.stringify(doc, null, 2);

    if (flags.output) {
        const { writeFile } = await import('node:fs/promises');

        await writeFile(flags.output, raw, 'utf8');
        console.error(`Wrote ${flags.output} (${raw.length} bytes)`);
    } else {
        process.stdout.write(raw);
    }

    try {
        const live = await fetchStateHash(root.replace(/\/api\/ledger\/export$/, ''));
        const exportState = doc.meta?.state_hash ? String(doc.meta.state_hash).toLowerCase() : null;

        if (exportState && live !== exportState) {
            console.error(`WARN: export meta.state_hash != live /api/state (${live})`);
        }
    } catch {
        // optional
    }

    return 0;
}

async function main() {
    const { positional, flags } = parseArgs(process.argv.slice(2));

    if (flags.help || positional.length === 0) {
        process.stdout.write(HELP);
        process.exit(positional.length === 0 ? 2 : 0);
    }

    const [cmd, ...rest] = positional;

    try {
        let code = 2;

        if (cmd === 'audit') {
            if (rest.length === 0) {
                process.stderr.write('audit requires at least one file or URL\n');
            } else {
                code = await cmdAudit(rest, flags);
            }
        } else if (cmd === 'compare') {
            if (rest.length < 2) {
                process.stderr.write('compare requires at least two sources\n');
            } else {
                code = await cmdCompare(rest, flags);
            }
        } else if (cmd === 'hash') {
            if (rest.length !== 1) {
                process.stderr.write('hash requires exactly one source\n');
            } else {
                code = await cmdHash(rest[0], flags);
            }
        } else if (cmd === 'fetch') {
            if (rest.length !== 1) {
                process.stderr.write('fetch requires one node base URL\n');
            } else {
                code = await cmdFetch(rest[0], flags);
            }
        } else {
            process.stderr.write(`Unknown command: ${cmd}\n`);
            process.stdout.write(HELP);
        }

        process.exit(code);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (flags.json) {
            console.log(JSON.stringify({ ok: false, error: message }));
        } else {
            process.stderr.write(`Fatal: ${message}\n`);
        }

        process.exit(1);
    }
}

main();
