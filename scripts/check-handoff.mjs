#!/usr/bin/env node
// check-handoff.mjs - verify a shared handoff record against the discipline the skill documents.
//
// The handoff layer used to be prose only: nothing checked that the four files existed or that the
// live entry carried the fields a successor needs, so 'read before acting, resume not redo' was a
// promise with no witness. This makes it a check.
//
// Usage: node scripts/check-handoff.mjs --dir <shared-record-dir>
// Exit 0 = the record is usable; 1 = it is not (every reason is printed).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export const REQUIRED_FILES = ['CURRENT-TASK.md', 'HANDOFF-RULES.md', 'MEMORY-SNAPSHOT.md', 'AGENT-ROLES.md'];
// 'handoff-wait' is the word the reference record uses for "stopped deliberately, ready to be picked
// up"; leaving it out of this list meant the documented template failed the checker built to police it.
export const STATUS_VALUES = ['进行中', '等待接续', '已完成', 'in-progress', 'waiting', 'handoff-wait', 'blocked', 'done'];

/**
 * Field aliases. The discipline is written in two languages AND the reference record in
 * references/handoff.md is written in lowercase, so all three spellings are accepted. The checker and
 * the template disagreeing was a real trap: following the documentation produced a rejected record.
 */
export const REQUIRED_FIELDS = [
  { name: 'status', keys: ['状态', 'Status', 'status'], values: STATUS_VALUES },
  { name: 'owner', keys: ['负责人', 'Owner', 'owner', '当前负责人'] },
  { name: 'current step', keys: ['当前步骤', 'Current step', 'current'] },
  { name: 'next step', keys: ['下一步', 'Next step', 'next'] },
  { name: 'evidence', keys: ['证据', 'Evidence', 'evidence'] },
];

/** Read one field, accepting the first alias that has a non-empty value. */
function fieldOf(text, keys) {
  for (const key of keys) {
    const m = text.match(new RegExp('^' + key + '\\s*[:：]\\s*(.*)$', 'm'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

export function checkHandoff(dir) {
  const problems = [];
  if (!existsSync(dir)) return { ok: false, problems: ['record directory does not exist: ' + dir] };
  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(dir, file))) problems.push('missing record file: ' + file);
  }
  const taskFile = join(dir, 'CURRENT-TASK.md');
  if (!existsSync(taskFile)) return { ok: false, problems };
  const text = readFileSync(taskFile, 'utf8');
  if (!text.trim()) problems.push('CURRENT-TASK.md is empty: a successor cannot resume from it');
  const values = {};
  for (const field of REQUIRED_FIELDS) {
    const value = fieldOf(text, field.keys);
    values[field.name] = value;
    if (!value) { problems.push('CURRENT-TASK.md is missing a value for: ' + field.name); continue; }
    if (field.values && !field.values.includes(value)) {
      problems.push('status "' + value + '" is not one of ' + field.values.join(' / '));
    }
  }
  // The iron rule that makes the record authoritative: it outranks the scheduler.
  // A precedence claim has to be positive. "不优先于" and "并非优先于" both contain 优先于, and
  // "never outranks" contains outranks, so a plain substring test accepts the exact opposite of the
  // requirement. The Chinese side had a guard from the start; the English side did not.
  const negatedEnglish = text.replace(
    /\b(?:not|never|no longer|does\s?n[o']?t|do\s?n[o']?t|should\s?n[o']?t|is\s?n[o']?t|will\s+not)\s+outranks?\b/gi,
    ' ',
  );
  const positiveEnglish = /outranks?/i.test(negatedEnglish);
  const positiveChinese = /(?<![不非])优先于/.test(text) || /(?<![不非])高于/.test(text);
  if (!positiveEnglish && !positiveChinese) {
    problems.push('CURRENT-TASK.md does not state that the record outranks the queue');
  }
  return { ok: problems.length === 0, problems, values };
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-handoff.mjs');
if (isMain) {
  const i = process.argv.indexOf('--dir');
  const dir = i >= 0 ? process.argv[i + 1] : null;
  if (!dir) { console.error('Usage: node scripts/check-handoff.mjs --dir <shared-record-dir>'); process.exit(2); }
  const result = checkHandoff(dir);
  if (result.ok) {
    console.log('handoff record OK: ' + dir);
    process.exit(0);
  }
  console.error(result.problems.map((x) => '  - ' + x).join('\n'));
  process.exit(1);
}
