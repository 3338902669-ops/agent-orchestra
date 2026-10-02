#!/usr/bin/env node
// smoke.mjs - the skill catalogue CLIs, end to end, on a fixture that ships with the repository.
//
// The unit suite covers buildIndex and topMatch. It never runs the two commands a person actually
// types, which is where a module usually breaks: a flag renamed, an output path changed, a catalogue
// written somewhere the router does not look. This builds one from examples/skill-catalog, routes two
// queries through the CLI, and refuses to pass unless the right skill wins each time.
//
// Known gap, pinned in KNOWN-FINDINGS as F-018: DEFAULT_STOP holds only Chinese function words, so
// the documented rule 'a query made only of function words is refused' holds for Chinese and not for
// English. This smoke asserts the behaviour that exists; it does not enshrine the gap as expected.
//
// Nothing is written inside the repository: the catalogue goes to a temp directory.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(ROOT, 'examples', 'skill-catalog');

const run = (script, args) =>
  execFileSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The router prints '#1 (score x) [category] name'; the winner is the first such line. */
const winnerOf = (text) => {
  const line = text.split('\n').find((l) => /^\s*#1 /.test(l)) || '';
  return line.trim();
};

const problems = [];
const out = mkdtempSync(join(tmpdir(), 'ao-skill-catalog-'));
try {
  run('rebuild-skill-catalog.mjs', ['--source', 'fixture=' + FIXTURE, '--out', out]);
  const catalog = join(out, 'skills-catalog.json');
  // The queries deliberately avoid the skill NAMES: 'changelog-writer' contains 'changelog', so a
  // query built from the name wins by name alone and proves nothing about description-led routing,
  // which is the whole reason this module exists. Each query below can only be answered from the
  // description, so editing a description is what can break it - verified by breaking one on purpose.
  const cases = [
    { query: 'trace every cell reference back to its source sheet', expect: 'sheet-audit' },
    { query: 'group the merged work into release notes by kind', expect: 'changelog-writer' },
  ];
  for (const c of cases) {
    const line = winnerOf(run('skill-router.mjs', ['--catalog', catalog, c.query]));
    if (!line.includes(c.expect)) {
      problems.push('query ' + JSON.stringify(c.query) + ' routed to ' + JSON.stringify(line.slice(0, 90)) + ', expected ' + c.expect);
    }
  }
  // The documented refusal, in the language whose function words the stoplist actually covers.
  const refusal = run('skill-router.mjs', ['--catalog', catalog, '今天天气怎么样']);
  if (!/No skill matched/.test(refusal)) {
    problems.push('a Chinese function-word-only query was matched instead of refused: ' + JSON.stringify(refusal.split('\n')[0].slice(0, 80)));
  }
  // NOT asserted, and deliberately: an unrelated ENGLISH query is currently matched, because
  // DEFAULT_STOP holds only Chinese function words, so 'for' counts as content and scores against a
  // description. That is F-018 - registered with an owner and a date rather than frozen here as
  // expected behaviour, which is how this repository treats every known gap.
} catch (e) {
  problems.push('the CLI failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(-1)[0]);
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (problems.length) {
  console.error(problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log('skill-catalog CLIs: the fixture routes correctly, and a function-word-only query is refused');
