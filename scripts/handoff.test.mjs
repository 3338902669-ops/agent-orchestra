// handoff.test.mjs - the handoff discipline, checked rather than promised.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkHandoff, REQUIRED_FILES } from './check-handoff.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VALID = [
  '# CURRENT-TASK.md',
  '',
  '状态: 进行中',
  '负责人: planner',
  '当前步骤: spec 与 acceptance 已写入队列',
  '下一步: builder 实现，auditor 独立核验',
  '证据: node scripts/gate.mjs 退出码 0',
  '',
  'the record outranks the queue.',
  '',
].join('\n');

/** Build a record directory; `overrides` replaces a file's contents, `skip` omits one. */
function makeRecord({ content = VALID, skip = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-'));
  for (const file of REQUIRED_FILES) {
    if (file === skip) continue;
    writeFileSync(join(dir, file), file === 'CURRENT-TASK.md' ? content : '# ' + file + '\n', 'utf8');
  }
  return dir;
}

test('the shipped example record passes', () => {
  const result = checkHandoff(join(ROOT, 'examples/handoff'));
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.values.owner, 'planner');
  assert.equal(result.values.status, '进行中');
});

test('a missing record file is reported, not ignored', () => {
  const result = checkHandoff(makeRecord({ skip: 'MEMORY-SNAPSHOT.md' }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('MEMORY-SNAPSHOT.md')));
});

test('a missing field fails: a successor cannot resume without it', () => {
  const withoutNext = VALID.replace(/下一步:.*\n/, '');
  const result = checkHandoff(makeRecord({ content: withoutNext }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('next step')), JSON.stringify(result.problems));
});

test('an unrecognised status is refused instead of silently accepted', () => {
  const result = checkHandoff(makeRecord({ content: VALID.replace('状态: 进行中', '状态: 大概在做吧') }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('not one of')));
});

test('a record that does not claim precedence over the queue is incomplete', () => {
  const result = checkHandoff(makeRecord({ content: VALID.replace('the record outranks the queue.', '') }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('outranks')));
});

test('an empty entry is a failure, not a blank success', () => {
  const result = checkHandoff(makeRecord({ content: '' }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('empty')));
});
