import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Acceptance tests for the things a unit test cannot see: does the skill actually ENGAGE
// on real phrasing, is the shipped config usable by the engine, and can the config gate
// actually fail? A gate that has never been observed to fail is not a gate - that is how a
// config the engine rejects ([yes, no]) and a keyword list that fired on \"k8s 编排\" both
// shipped while every test was green.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = (rel) => join(ROOT, rel);

function run(file, args, options = {}) {
  const result = spawnSync(process.execPath, [cli(file), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });
  return { code: result.status, out: (result.stdout || '').trim(), err: (result.stderr || '').trim() };
}

const engages = (text) => {
  const r = run('scripts/detect-trigger.mjs', ['--config', cli('config/agents.example.yaml'), '--text', text]);
  return { engaged: r.code === 0, ...r };
};

// ── activation: the skill must engage on intent, not on its own vocabulary ────────────

// Real request phrasings that must engage. These are the reason the skill exists.
const MUST_ENGAGE = [
  '让 AI 们一起把这个需求做了',
  '我要用三个 AI 一起做',
  '几个 agent 同时改代码冲突了',
  '两个 AI 改同一个文件',
  '我这几个AI老是互相覆盖对方改动',
  '换个助手继续',
  '多 agent 协作完成这次重构',
  '换助手继续干活',
  '我们需要独立核验这个实现',
  'we need multi-agent orchestration',
  'coordinate agents with a single-writer rule',
];

// Ordinary requests that merely contain a word the skill also uses. Engaging here is worse
// than staying silent: the skill would reorganise work that has nothing to do with agents.
const MUST_NOT_ENGAGE = [
  '帮我写个 k8s 编排文件',
  'docker-compose 编排这三个服务',
  '这个函数加个 verifier 校验入参',
  '帮我做下项目验收报告',
  '云成本优化方案怎么做',
  '我们团队分工一下这个需求',
  'just a question about regex',
];

test('activation engages on how people describe the problem', () => {
  const missed = MUST_ENGAGE.filter((t) => !engages(t).engaged);
  assert.deepEqual(missed, [], 'these must engage but did not: ' + JSON.stringify(missed));
});

test('activation stays silent on ordinary requests that share a word', () => {
  const falseHits = MUST_NOT_ENGAGE.filter((t) => engages(t).engaged);
  assert.deepEqual(falseHits, [], 'these must NOT engage but did: ' + JSON.stringify(falseHits));
});

test('the detector fails loudly when the config has no signals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ao-cfg-'));
  const empty = join(dir, 'empty.yaml');
  writeFileSync(empty, 'activation:\n  mode: keyword\n  keywords:\n', 'utf8');
  const r = run('scripts/detect-trigger.mjs', ['--config', empty, '--text', '多 agent 协作']);
  assert.equal(r.code, 2, 'an empty signal list must be a loud error, not a silent never-engage');
  assert.match(r.err, /empty keyword and pattern list/);
});

// ── the config gate must be able to FAIL ──────────────────────────────────────────────

const ORIGINAL = readFileSync(cli('config/agents.example.yaml'), 'utf8');

/** Copy the shipped config, apply one mutation, and assert the gate rejects it. */
function expectRejected(name, mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'ao-mut-'));
  const file = join(dir, 'mutated.yaml');
  const mutated = mutate(ORIGINAL);
  assert.notEqual(mutated, ORIGINAL, 'mutation \"' + name + '\" did not change the config');
  writeFileSync(file, mutated, 'utf8');
  copyFileSync(cli('SKILL.md'), join(dir, 'SKILL.md'));
  copyFileSync(cli('README.md'), join(dir, 'README.md'));
  const r = spawnSync(process.execPath, [cli('scripts/validate-config.mjs'), file], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 1, 'gate accepted the mutation \"' + name + '\" (it must reject it). stdout: ' + (r.stdout || '').trim());
  return (r.stderr || '').trim();
}

test('the shipped config passes the gate', () => {
  const r = run('scripts/validate-config.mjs', ['config/agents.example.yaml']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /checked against the engine enums/);
});

test('the gate rejects the exact config/code contradiction that shipped before', () => {
  const err = expectRejected('intake gate uses yes/no instead of planned/skip', (t) =>
    t.replace('security_scan: [planned, skip]', 'security_scan: [yes, no]'));
  assert.match(err, /security_scan contains \"yes\"/);
});

test('the gate rejects a config that would break the engine invariants', () => {
  const mutations = {
    'single-writer ownership turned off': (t) => t.replace('one_primary_writer_per_resource: true', 'one_primary_writer_per_resource: false'),
    'verifier marked as not independent': (t) => t.replace('    independent: true', '    independent: false'),
    'unscored verifier no longer fails closed': (t) => t.replace('unscored_verifier: fail_closed', 'unscored_verifier: continue'),
    'verification gate stops returning to implement': (t) => t.replace('on_failure: return_to_implement', 'on_failure: ignore'),
    'override loses its reason requirement': (t) => t.replace(/override_requires: \[[^\]]*\]/, 'override_requires: [approvedBy]'),
    'override is allowed to erase the failure': (t) => t.replace('override_keeps_failure_record: true', 'override_keeps_failure_record: false'),
    'dispatch stops being a dry run': (t) => t.replace('dispatch_mode: dry_run', 'dispatch_mode: auto_launch'),
    'auto routing drops below three agents': (t) => t.replace('minimum_agents_for_auto_routing: 3', 'minimum_agents_for_auto_routing: 1'),
    'evidence grading stops being required': (t) => t.replace('require_grade_label: true', 'require_grade_label: false'),
    'handoff record no longer outranks the queue': (t) => t.replace('record_outranks_queue: true', 'record_outranks_queue: false'),
    'a duplicate key is introduced': (t) => t.replace('mode: capability-first', 'mode: capability-first\nmode: something-else'),
  };
  const accepted = [];
  for (const [name, mutate] of Object.entries(mutations)) {
    try { expectRejected(name, mutate); } catch (error) { accepted.push(name + ' -> ' + error.message.split('\n')[0]); }
  }
  assert.deepEqual(accepted, [], 'the gate let these mutations through: ' + JSON.stringify(accepted, null, 1));
});

// ── the artifact must not reference anything missing ──────────────────────────────────

test('every file the docs reference exists', () => {
  const files = ['SKILL.md', ...['references', 'examples', 'scripts', 'config'].flatMap((dir) => {
    const full = join(ROOT, dir);
    return existsSync(full) ? [] : [];
  })];
  const referenced = new Set();
  const sources = ['SKILL.md', 'README.md', 'references/task-queue.md', 'references/handoff.md', 'references/routing-and-roles.md'];
  for (const source of sources) {
    if (!existsSync(cli(source))) continue;
    const text = readFileSync(cli(source), 'utf8');
    for (const m of text.matchAll(/`((?:references|scripts|config|examples)\/[\w./-]+)`/g)) {
      referenced.add(m[1]);
    }
  }
  assert.ok(referenced.size >= 5, 'expected the docs to reference real support files, found ' + referenced.size);
  const missing = [...referenced].filter((rel) => !existsSync(cli(rel)));
  assert.deepEqual(missing, [], 'the docs reference files that do not exist: ' + JSON.stringify(missing));
  assert.ok(files.length >= 1);
});
