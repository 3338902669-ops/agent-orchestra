#!/usr/bin/env node
// gate.mjs - the single source of truth for this repo's checks.
//
// Why it exists: the checks used to live in two places (a hand-written shell script in a
// temp directory and a list of steps in the CI workflow). They drifted, so a green local
// run did not mean a green build, and neither of them was itself tested. This runner is
// the one command CI and the local machine both execute, it writes machine-readable
// evidence bound to the exact revision, and it proves it can FAIL before it reports PASS:
//   * --self-test injects known-bad inputs and requires the runner to reject them, so a
//     gate that has quietly stopped checking anything cannot pass as green.
//
// Usage:
//   node scripts/gate.mjs [--evidence <dir>] [--no-self-test] [--quiet]
// Exit code 0 = every step passed and the self-test rejected every mutation; 1 = otherwise.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true);
};
const QUIET = argv.includes('--quiet');
// On by default: a gate that has never been observed to reject anything is not evidence.
const SELF_TEST = !argv.includes('--no-self-test');
const EVIDENCE_DIR = flag('--evidence', join(ROOT, 'evidence'));

const SKIP_DIRS = new Set(['.git', 'node_modules', 'evidence']);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.git')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, out); }
    else out.push(full);
  }
  return out;
}

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  return {
    status: result.status, 
    durationMs: Date.now() - started,
    out: (result.stdout || '').toString().trim(),
    err: (result.stderr || '').toString().trim(),
  };
}

const tail = (text, n = 400) => (text.length > n ? '...' + text.slice(-n) : text);

// ── steps ─────────────────────────────────────────────────────────────────────────────

const steps = [];
const node = (args) => run(process.execPath, args);
const step = (id, title, fn, criterion) => steps.push({ id, title, fn, criterion });

step('config', 'shipped config is usable by the engine', () =>
  node(['scripts/validate-config.mjs', 'config/agents.example.yaml']),
  'exit 0: every configured value belongs to an engine enum');

step('json', 'JSON examples and the manifest schema parse', () =>
  node(['-e', "JSON.parse(require('fs').readFileSync('examples/important-task.json','utf8'));JSON.parse(require('fs').readFileSync('references/agent-manifest.schema.json','utf8'));console.log('JSON OK')"]),
  'exit 0');

step('frontmatter', 'SKILL.md declares name and description', () =>
  node(['-e', 'const t=require("fs").readFileSync("SKILL.md","utf8");if(!/^---\\n[\\s\\S]*?name:\\s*\\S+[\\s\\S]*?description:\\s*\\S+[\\s\\S]*?\\n---/.test(t))throw new Error("invalid frontmatter");console.log("frontmatter OK")']),
  'exit 0: parseable frontmatter with name + description');

step('activation', 'activation engages on intent and stays silent on lookalikes', () =>
  node(['--test', 'scripts/acceptance.test.mjs']),
  'exit 0: the must-engage / must-not-engage table passes, and the config gate rejects the documented mutations');

step('engine', 'queue engine unit tests', () =>
  node(['--test', 'scripts/orchestrator/lib.test.mjs']),
  'exit 0: the engine suite passes, including concurrent writers, lock recovery, the rigor ladder and the intake gate');

step('cli-io', 'verification gate holds under real CLI use', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-gate-'));
  const state = join(dir, 'queue.json');
  const env = { ...process.env, ORCHESTRATOR_STATE: state };
  const o = (...args) => run(process.execPath, ['scripts/orchestrator/orchestrator.mjs', ...args], { env });
  const fail = (message) => ({ status: 1, durationMs: 0, out: '', err: message });
  if (o('init').status !== 0) return fail('init failed');
  if (o('create', '--title', 'gate', '--type', 'build').status !== 0) return fail('create failed');
  if (o('claim', '--task', 'task-0001', '--agent', 'generalist').status !== 0) return fail('claim failed');
  // The specify stage cannot end without its work products (R3), so the smoke test supplies them.
  if (o('complete', '--task', 'task-0001', '--agent', 'generalist', '--spec', 'gate smoke', '--acceptance', 'the gate exits 0').status !== 0) {
    return fail('complete failed');
  }
  if (o('claim', '--task', 'task-0001', '--agent', 'generalist').status !== 0) return fail('second claim failed');
  // A verification PASS carries its evidence (the gate rule), so the smoke test supplies one.
  if (o('complete', '--task', 'task-0001', '--agent', 'generalist', '--evidence', 'gate smoke: verify passed').status !== 0) {
    return fail('verify failed');
  }
  if (o('claim', '--task', 'task-0001', '--agent', 'specialist').status !== 0) return fail('verify claim failed');
  if (o('fail', '--task', 'task-0001', '--agent', 'specialist', '--criteria', 'acceptance test fails').status !== 0) return fail('fail command rejected');
  const task = JSON.parse(readFileSync(state, 'utf8')).tasks['task-0001'];
  if (task.verification.blocked !== true || task.phase !== 'implement') return fail('the gate did not close');
  if (o('override', '--task', 'task-0001', '--by', 'user', '--scope', 'ship').status === 0) return fail('an override without a reason must be refused');
  if (o('override', '--task', 'task-0001', '--by', 'user', '--scope', 'ship', '--reason', 'pre-existing defect accepted').status !== 0) return fail('a complete override was refused');
  const finalState = JSON.parse(readFileSync(state, 'utf8'));
  const after = finalState.tasks['task-0001'];
  if (after.verification.blocked !== false || !after.verification.override) return fail('the override was not recorded');
  if (after.verification.lastResult !== 'fail' || !after.verification.criteria) {
    return fail('the override erased the failure record');
  }
  if (!finalState.events.some((event) => event.type === 'verification_failed')) return fail('the failure event was lost');
  rmSync(dir, { recursive: true, force: true });
  return { status: 0, durationMs: 0, out: 'gate closed, override recorded, failure kept', err: '' };
}, 'exit 0: a failed verification blocks done/evidence, needs approver+scope+reason, and keeps the failure');

step('handoff', 'the handoff record discipline is checkable', () => {
  const tests = node(['--test', 'scripts/handoff.test.mjs']);
  const example = node(['scripts/check-handoff.mjs', '--dir', 'examples/handoff']);
  if (tests.status !== 0) return { status: 1, durationMs: 0, out: tail(tests.out, 300), err: tail(tests.err, 300) };
  if (example.status !== 0) return { status: 1, durationMs: 0, out: '', err: 'the shipped example record does not pass its own check: ' + example.err };
  return { status: 0, durationMs: 0, out: 'handoff tests pass and the example record validates', err: '' };
}, 'exit 0: the four record files exist, the live entry carries status/owner/steps/evidence, and the tests cover failure cases');

step('hygiene', 'no private paths, secrets or host-specific names ship', () => {
  const patterns = JSON.parse(readFileSync(join(ROOT, 'scripts/gate-patterns.json'), 'utf8'));
  const self = join(ROOT, 'scripts/gate-patterns.json');
  const hits = [];
  for (const file of walk(ROOT)) {
    if (file === self) continue;
    if (!/\.(md|mjs|cjs|js|json|ya?ml|txt)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    const all = [...patterns.privatePaths, ...patterns.secrets].map((s) => new RegExp(s));
    for (const re of all) {
      const m = text.match(re);
      if (m) hits.push(relative(ROOT, file) + ': ' + JSON.stringify(m[0].slice(0, 40)));
    }
    for (const name of patterns.disallowedProductNames) {
      // Word boundaries, not substrings: a host name buried inside an unrelated identifier is a
      // false positive, and a gate that cries wolf gets ignored - worse than not checking at all.
      // (The names themselves live in gate-patterns.json so this file never matches itself.)
      if (new RegExp('\\b' + name + '\\b', 'i').test(text)) hits.push(relative(ROOT, file) + ': host-specific name "' + name + '"');
    }
  }
  return hits.length
    ? { status: 1, durationMs: 0, out: hits.join('\n'), err: '' }
    : { status: 0, durationMs: 0, out: 'no private paths, secrets or host-specific names', err: '' };
}, 'exit 0: zero matches across every shipped file');

step('config-usage', 'no config key pretends to be behaviour the engine does not have', () => {
  const r = node(['scripts/check-config-usage.mjs']);
  return r.status === 0
    ? { status: 0, durationMs: 0, out: 'every config key is read by a script or declared advisory', err: '' }
    : { status: 1, durationMs: 0, out: '', err: r.err || r.out };
}, 'exit 0: each key is either referenced by the scripts or listed as advisory with a reason');

step('claims', 'numbers stated in the docs match reality', () => {
  // The config was once the thing that lied; the docs can lie the same way. Only current-state
  // documents are checked - CHANGELOG entries describe past releases and are historical by nature.
  const engine = node(['--test', 'scripts/orchestrator/lib.test.mjs']);
  const acceptance = node(['--test', 'scripts/acceptance.test.mjs']);
  const countOf = (result) => {
    const m = /tests (\d+)/.exec(result.out + result.err);
    return m ? Number(m[1]) : null;
  };
  const engineCount = countOf(engine);
  const acceptanceCount = countOf(acceptance);
  if (engineCount === null || acceptanceCount === null) {
    return { status: 1, durationMs: 0, out: '', err: 'could not read the test counts from the suites' };
  }
  const docs = ['README.md', 'SKILL.md']
    .concat(readdirSync(join(ROOT, 'references')).filter((f) => f.endsWith('.md')).map((f) => 'references/' + f));
  const problems = [];
  for (const rel of docs) {
    const file = join(ROOT, rel);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(\d+)\s+(?:unit\s+)?tests\b/g)) {
      const stated = Number(m[1]);
      if (stated !== engineCount && stated !== engineCount + acceptanceCount && stated !== acceptanceCount) {
        problems.push(rel + ' states ' + stated + ' tests; the suites hold ' + engineCount + ' engine + ' + acceptanceCount + ' acceptance');
      }
    }
  }
  return problems.length
    ? { status: 1, durationMs: 0, out: '', err: problems.join('\n') }
    : { status: 0, durationMs: 0, out: engineCount + ' engine tests + ' + acceptanceCount + ' acceptance tests; no stale claim found', err: '' };
}, 'exit 0: every test count stated in current-state docs equals the suites');
step('findings', 'accepted defects have an owner and a live review date', () => {
  const file = join(ROOT, 'KNOWN-FINDINGS.md');
  if (!existsSync(file)) return { status: 1, durationMs: 0, out: '', err: 'KNOWN-FINDINGS.md is missing; an absent register is a claim that no defects exist' };
  const rows = readFileSync(file, 'utf8').split('\n').filter((l) => /^\|\s*F-\d+/.test(l));
  const problems = [];
  if (rows.length === 0) problems.push('the register has no findings - if that is true, say so in prose');
  const today = new Date().toISOString().slice(0, 10);
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
    const id = cells[0];
    if (cells.length < 6) { problems.push(id + ': needs severity, finding, disposition, owner and review date'); continue; }
    const owner = cells[cells.length - 2];
    const review = cells[cells.length - 1];
    if (!owner) problems.push(id + ': no owner');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(review)) problems.push(id + ': review date must be YYYY-MM-DD, found "' + review + '"');
    else if (review < today) problems.push(id + ': review date ' + review + ' has passed (today is ' + today + ') - re-disposition it');
  }
  return problems.length
    ? { status: 1, durationMs: 0, out: '', err: problems.join('\n') }
    : { status: 0, durationMs: 0, out: rows.length + ' findings registered, all owned and in date', err: '' };
}, 'exit 0: every finding has an owner and a review date that has not passed');

// ── self-test: the gate must reject known-bad input ───────────────────────────────────

function selfTest() {
  const mutations = [
    { name: 'config the engine cannot use (the bug that shipped)', target: 'mutated.yaml', file: 'config/agents.example.yaml',
      mutate: (t) => t.replace('security_scan: [planned, skip]', 'security_scan: [yes, no]'),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/validate-config.mjs'), join(dir, 'mutated.yaml')]] },
    { name: 'single-writer ownership disabled', target: 'mutated.yaml', file: 'config/agents.example.yaml',
      mutate: (t) => t.replace('one_primary_writer_per_resource: true', 'one_primary_writer_per_resource: false'),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/validate-config.mjs'), join(dir, 'mutated.yaml')]] },
    { name: 'verification gate no longer fail-closed', target: 'mutated.yaml', file: 'config/agents.example.yaml',
      mutate: (t) => t.replace('unscored_verifier: fail_closed', 'unscored_verifier: continue'),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/validate-config.mjs'), join(dir, 'mutated.yaml')]] },
    { name: 'dispatch no longer a dry run', target: 'mutated.yaml', file: 'config/agents.example.yaml',
      mutate: (t) => t.replace('dispatch_mode: dry_run', 'dispatch_mode: auto_launch'),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/validate-config.mjs'), join(dir, 'mutated.yaml')]] },
    { name: 'rigor default is not an engine level', target: 'mutated.yaml', file: 'config/agents.example.yaml',
      mutate: (t) => t.replace('  default: L2', '  default: L9'),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/validate-config.mjs'), join(dir, 'mutated.yaml')]] },
    { name: 'a capability the engine does not know', target: 'mutated.yaml', file: 'config/agents.example.yaml',
      mutate: (t) => t.replace('capabilities: [full, web', 'capabilities: [full, nonsense, web'),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/validate-config.mjs'), join(dir, 'mutated.yaml')]] },
    { name: 'the evidence grade vocabulary drifts', target: 'mutated.yaml', file: 'config/agents.example.yaml',
      mutate: (t) => t.replace('grading: [E1, E2, E3, E4]', 'grading: [E1_reproducible, E2_peer_check]'),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/validate-config.mjs'), join(dir, 'mutated.yaml')]] },
    { name: 'the comparison markers are emptied', target: 'mutated.yaml', file: 'config/agents.example.yaml',
      mutate: (t) => t.replace(/comparison_words: \[[^\]]*\]/, 'comparison_words: []'),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/validate-config.mjs'), join(dir, 'mutated.yaml')]] },
    { name: 'the activation anchors are emptied', target: 'mutated.yaml', file: 'config/agents.example.yaml',
      mutate: (t) => t.replace(/agent_anchors: \[[^\]]*\]/, 'agent_anchors: []'),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/validate-config.mjs'), join(dir, 'mutated.yaml')]] },
    { name: 'the handoff record loses its next step', fixtureDir: 'examples/handoff', target: 'CURRENT-TASK.md', file: 'examples/handoff/CURRENT-TASK.md',
      mutate: (t) => t.replace(/下一步:[^\n]*\r?\n?/, ''),
      command: (dir) => [process.execPath, [join(ROOT, 'scripts/check-handoff.mjs'), '--dir', dir]] },
  ];
  const results = [];
  const copyDir = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, entry.name);
      const dst = join(to, entry.name);
      if (entry.isDirectory()) copyDir(src, dst);
      else writeFileSync(dst, readFileSync(src));
    }
  };
  for (const m of mutations) {
    const dir = mkdtempSync(join(tmpdir(), 'ao-selftest-'));
    // A mutation must be applied to the very file the command reads. Writing everything to
    // mutated.yaml once made the handoff mutation pass for the wrong reason (an empty directory
    // fails the checker too), which is a false qualification rather than a test.
    if (m.fixtureDir) {
      copyDir(join(ROOT, m.fixtureDir), dir);
      // Guard against the false qualification the verifier caught: if the file the command reads is
      // not the file being mutated, the mutation proves nothing.
      if (!existsSync(join(dir, m.target))) {
        results.push({ name: m.name, rejected: false, why: 'the fixture does not contain ' + m.target + ', so the mutation would not be checked' });
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
    }
    const original = readFileSync(join(ROOT, m.file), 'utf8');
    const mutated = m.mutate(original);
    if (mutated === original) { results.push({ name: m.name, rejected: false, why: 'mutation did not apply' }); rmSync(dir, { recursive: true, force: true }); continue; }
    writeFileSync(join(dir, m.target), mutated, 'utf8');
    for (const extra of ['SKILL.md', 'README.md']) {
      try { writeFileSync(join(dir, extra), readFileSync(join(ROOT, extra))); } catch { /* optional */ }
    }
    const [cmd, args] = m.command(dir);
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
    results.push({ name: m.name, rejected: r.status !== 0 });
    rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

// ── run ───────────────────────────────────────────────────────────────────────────────

const startedAt = new Date().toISOString();
const results = [];
let failed = 0;
for (const s of steps) {
  let outcome;
  try { outcome = s.fn(); } catch (error) { outcome = { status: 1, durationMs: 0, out: '', err: String(error.message) }; }
  const passed = outcome.status === 0;
  if (!passed) failed++;
  results.push({
    id: s.id, title: s.title, criterion: s.criterion, status: passed ? 'pass' : 'fail',
    exitCode: outcome.status, durationMs: outcome.durationMs,
    output: tail(outcome.out, 200), error: tail(outcome.err, 400),
  });
  if (!QUIET) console.log((passed ? 'PASS  ' : 'FAIL  ') + s.id.padEnd(12) + s.title);
  if (!passed && !QUIET) console.log('      ' + tail((outcome.err || outcome.out).replace(/\n/g, '\n      '), 300));
}

let selfTestResults = null;
let selfTestFailed = 0;
if (SELF_TEST) {
  selfTestResults = selfTest();
  selfTestFailed = selfTestResults.filter((r) => !r.rejected).length;
  if (!QUIET) {
    console.log('');
    console.log('self-test (the gate must reject known-bad input):');
    for (const r of selfTestResults) console.log('  ' + (r.rejected ? 'REJECTED' : 'ACCEPTED!') + '  ' + r.name);
  }
}

const revision = run('git', ['rev-parse', 'HEAD']).out || 'unknown';
const dirty = (run('git', ['status', '--porcelain']).out || '').length > 0;
const artifacts = {};
for (const rel of ['SKILL.md', 'config/agents.example.yaml', 'scripts/orchestrator/lib.mjs', 'scripts/orchestrator/orchestrator.mjs', 'scripts/detect-trigger.mjs']) {
  const full = join(ROOT, rel);
  if (existsSync(full)) artifacts[rel] = sha256(readFileSync(full));
}

const verdict = failed === 0 && selfTestFailed === 0 ? 'pass' : 'fail';
const evidence = {
  schema: 'agent-orchestra/gate-evidence@1',
  startedAt, finishedAt: new Date().toISOString(),
  revision, dirty,
  verdict,
  selfTest: selfTestResults ? { ran: true, mutations: selfTestResults.length, notRejected: selfTestFailed, results: selfTestResults } : { ran: false },
  artifacts,
  steps: results,
};

mkdirSync(EVIDENCE_DIR, { recursive: true });
const evidenceFile = join(EVIDENCE_DIR, 'gate-' + revision.slice(0, 12) + '.json');
writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
writeFileSync(join(EVIDENCE_DIR, 'latest.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');

console.log('');
console.log('revision ' + revision.slice(0, 12) + (dirty ? ' (dirty working tree)' : '') + ' | steps ' + results.length + ' | failed ' + failed + (SELF_TEST ? ' | self-test notRejected ' + selfTestFailed : ' | self-test SKIPPED'));
console.log('evidence: ' + relative(ROOT, evidenceFile));
console.log('VERDICT: ' + verdict.toUpperCase());
process.exit(verdict === 'pass' ? 0 : 1);
