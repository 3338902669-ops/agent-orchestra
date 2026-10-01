#!/usr/bin/env node
// check-conformance.mjs - the protocol's MUSTs against the code that enforces them.
//
// A conformance matrix is only worth reading if it cannot lie. Every row in conformance.json is
// checked here: the enforcement symbols and files must exist, the pinning test names must exist in
// the suites, the gate mutations must exist in gate.mjs, and a row may only claim ENFORCED if it
// names BOTH an enforcement point and a test that pins it. The markdown is generated from the same
// data, and the check fails if the committed markdown has drifted from it.
//
// Usage: node scripts/check-conformance.mjs [--write]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATUSES = ['ENFORCED', 'PARTIALLY ENFORCED', 'DOCUMENTED ONLY', 'OUT OF SCOPE'];
const TEST_FILES = ['scripts/orchestrator/lib.test.mjs', 'scripts/acceptance.test.mjs', 'scripts/handoff.test.mjs'];
const SYMBOL_FILES = ['scripts/orchestrator/lib.mjs', 'scripts/orchestrator/orchestrator.mjs', 'scripts/detect-trigger.mjs', 'scripts/check-handoff.mjs'];

export function testNames() {
  const names = new Set();
  for (const file of TEST_FILES) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/test\('([^']+)'/g)) names.add(m[1]);
    // template-literal test names (the parametrised stage-machine cases)
    for (const m of text.matchAll(/test\(`([^`]+)`/g)) names.add(m[1].replace(/\$\{[^}]+\}/g, '').trim() + ' ');
  }
  return names;
}

export function gateMutations() {
  const text = readFileSync(join(ROOT, 'scripts/gate.mjs'), 'utf8');
  return new Set([...text.matchAll(/name: '([^']+)'/g)].map((m) => m[1]));
}

export function checkConformance(data) {
  const problems = [];
  const tests = testNames();
  const mutations = gateMutations();
  const symbols = SYMBOL_FILES.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  for (const row of data.requirements) {
    const at = row.id + ': ';
    if (!STATUSES.includes(row.status)) problems.push(at + 'unknown status "' + row.status + '"');
    if (row.status === 'ENFORCED') {
      if (!row.enforcedBy?.length) problems.push(at + 'ENFORCED without an enforcement point');
      if (!row.pinnedBy?.length) problems.push(at + 'ENFORCED without a pinning test');
    }
    if (!['ENFORCED', 'PARTIALLY ENFORCED'].includes(row.status) && (row.enforcedBy?.length || row.pinnedBy?.length)) {
      problems.push(at + row.status + ' should not claim enforcement points');
    }
    if (!['ENFORCED', 'PARTIALLY ENFORCED'].includes(row.status) && !row.note) {
      problems.push(at + row.status + ' needs a note explaining the boundary');
    }
    for (const ref of row.enforcedBy ?? []) {
      if (ref.startsWith('symbol:')) {
        // Internal helpers enforce as much as exported ones (requireOwner, namedOwner), so the
        // reference resolves against any function or const declaration in the engine files.
        if (!new RegExp('(export )?(function|const) ' + ref.slice(7) + '\\b').test(symbols)) problems.push(at + 'no symbol ' + ref.slice(7));
      } else if (ref.startsWith('file:')) {
        if (!existsSync(join(ROOT, ref.slice(5)))) problems.push(at + 'missing file ' + ref.slice(5));
      } else problems.push(at + 'unrecognised enforcement reference ' + ref);
    }
    for (const ref of row.pinnedBy ?? []) {
      if (ref.startsWith('test:')) {
        const name = ref.slice(5);
        if (![...tests].some((t) => t === name)) problems.push(at + 'no test named "' + name + '"');
      } else if (ref.startsWith('gate:')) {
        const name = ref.slice(5);
        if (![...mutations].some((m) => m === name)) problems.push(at + 'no gate mutation named "' + name + '"');
      } else problems.push(at + 'unrecognised pin reference ' + ref);
    }
  }
  return { problems, tests: tests.size, mutations: mutations.size };
}

export function renderMarkdown(data) {
  const out = [];
  out.push('# Protocol conformance');
  out.push('');
  out.push('Every MUST in [AGENT-ORCHESTRA-PROTOCOL.md](AGENT-ORCHESTRA-PROTOCOL.md) mapped to the code that');
  out.push('enforces it and the test that pins it. **This table is machine-checked** by');
  out.push('`scripts/check-conformance.mjs`, which fails if a reference does not resolve, if an ENFORCED row');
  out.push('has no enforcement point or no test, or if this file has drifted from `conformance.json`.');
  out.push('');
  out.push('| ID | Contract | Requirement | Status | Enforced by | Pinned by |');
  out.push('|---|---|---|---|---|---|');
  for (const row of data.requirements) {
    const enforced = (row.enforcedBy ?? []).map((r) => '`' + r.replace(/^(symbol|file):/, '') + '`').join(', ') || '-';
    const pinned = (row.pinnedBy ?? []).map((r) => r.startsWith('test:') ? 'test: `' + r.slice(5) + '`' : 'gate mutation: ' + r.slice(5)).join('<br>') || '-';
    out.push('| ' + row.id + ' | ' + row.contract + ' | ' + row.requirement + ' | ' + row.status + ' | ' + enforced + ' | ' + pinned + ' |');
  }
  out.push('');
  const counts = {};
  for (const row of data.requirements) counts[row.status] = (counts[row.status] ?? 0) + 1;
  out.push('**' + data.requirements.length + ' requirements: ' + Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', ') + '.**');
  out.push('');
  out.push('The two OUT OF SCOPE rows are the honest boundary of a local, dependency-free runtime, and they');
  out.push('are registered in KNOWN-FINDINGS.md rather than implied: E1 is a structural claim rather than');
  out.push('provenance (F-012), and the queue is a ledger rather than an authorisation server (F-003, F-011).');
  out.push('');
  return out.join('\n');
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-conformance.mjs');
if (isMain) {
  const data = JSON.parse(readFileSync(join(ROOT, 'conformance.json'), 'utf8'));
  const { problems, tests, mutations } = checkConformance(data);
  const rendered = renderMarkdown(data);
  const target = join(ROOT, 'CONFORMANCE.md');
  if (process.argv.includes('--write')) {
    writeFileSync(target, rendered);
    console.log('wrote CONFORMANCE.md');
  } else {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current !== rendered) problems.push('CONFORMANCE.md has drifted from conformance.json (run with --write)');
  }
  if (problems.length) {
    console.error(problems.map((x) => '  - ' + x).join('\n'));
    process.exit(1);
  }
  const counts = {};
  for (const row of data.requirements) counts[row.status] = (counts[row.status] ?? 0) + 1;
  console.log(data.requirements.length + ' requirements, ' + tests + ' tests and ' + mutations + ' gate mutations available to cite');
  console.log(Object.entries(counts).map(([k, v]) => k + ': ' + v).join(' | '));
  process.exit(0);
}
