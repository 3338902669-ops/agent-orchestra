// Tests for the skill catalogue engine. Every assertion here corresponds to a defect that was
// actually observed on a real 264-skill catalogue, not to a hypothetical.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIndex, topMatch } from './skill-router.mjs';
import { buildCatalog, renderMarkdown, parseFrontmatter } from './rebuild-skill-catalog.mjs';

const catalog = {
  categories: { coding: 'Coding and debugging', docs: 'Documents and writing' },
  total: 4,
  skills: [
    { name: 'alpha-debugger', category: 'coding', keywords: [],
      description: 'Track down a failing test, a stack trace or an error and find its root cause.', locations: [] },
    { name: 'beta-writer', category: 'docs', keywords: [],
      description: 'Draft and revise a README, a changelog or user documentation.', locations: [] },
    { name: 'gamma-router', category: 'unmapped', keywords: [],
      description: 'Route a request to the right handler when several tools could serve it.', locations: [] },
    // Written the way a real catalogue entry would be. An earlier version of this fixture quoted
    // the test query verbatim, which made the test assert something impossible: if a description
    // literally contains "天气怎么样", the overlap is a genuine phrase match, not merely function
    // words, and no lexical router should refuse it. The gate's contract is narrower than that -
    // it refuses queries whose ONLY overlap is function words.
    { name: 'delta-trends', category: 'unmapped', keywords: [],
      description: '每小时刷新今天的热门话题与趋势榜单。', locations: [] },
  ],
};

test('a skill with no keywords is still routable, because the description carries it', () => {
  const index = buildIndex(catalog);
  const hits = topMatch(index, 'the test is failing with a stack trace, find the root cause');
  assert.ok(hits.length, 'expected a match');
  assert.equal(hits[0].skill.name, 'alpha-debugger');
});

test('an uncategorised skill is routable rather than filtered out', () => {
  const index = buildIndex(catalog);
  const hits = topMatch(index, 'several tools could serve this request, route it to the right handler');
  assert.equal(hits[0].skill.name, 'gamma-router');
  // The regression this pins: excluding category === 'unmapped' made such a skill unselectable
  // no matter how well its description matched.
});

test('a query made only of function words is refused, not matched on an accidental bigram', () => {
  const index = buildIndex(catalog);
  assert.deepEqual(topMatch(index, '今天天气怎么样'), [],
    'function words are not evidence; without the stoplist this scored 9.78 against a trends skill');
  assert.deepEqual(topMatch(index, 'what should I eat for dinner'), []);
});

test('the evidence gate needs more than one accidental CJK bigram', () => {
  const index = buildIndex(catalog);
  // '天气' alone appears in delta-trends; one shared bigram must not be enough.
  assert.deepEqual(topMatch(index, '天气'), []);
});

test('parseFrontmatter reads folded and literal block scalars instead of the indicator', () => {
  const folded = parseFrontmatter('---\nname: a\ndescription: >-\n  first line\n  second line\n---\nbody');
  assert.equal(folded.description, 'first line second line');

  const literal = parseFrontmatter('---\nname: b\ndescription: |\n  line one\n  line two\n---\nbody');
  assert.equal(literal.description, 'line one\nline two');

  const plain = parseFrontmatter('---\nname: c\ndescription: >\n  only line\n---\nbody');
  assert.equal(plain.description, 'only line');
});

test('a colon inside a block scalar does not become a new key', () => {
  const fm = parseFrontmatter('---\nname: d\ndescription: >-\n  Use when the task says: do the thing\n  and also when it says: stop\n---\nbody');
  assert.equal(fm.name, 'd');
  assert.equal(fm.description, 'Use when the task says: do the thing and also when it says: stop');
  assert.deepEqual(Object.keys(fm).sort(), ['description', 'name'],
    'prose must not leak into the metadata as extra keys');
});

test('the builder counts what it lists, including the uncategorised skills', () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-'));
  const src = join(root, 'skills');
  const mk = (name, body) => {
    mkdirSync(join(src, name), { recursive: true });
    writeFileSync(join(src, name, 'SKILL.md'), body, 'utf8');
  };
  mk('one', '---\nname: one\ndescription: >-\n  A folded description.\n---\n');
  mk('two', '---\nname: two\ndescription: A plain one.\n---\n');
  mk('three', '---\nname: three\n---\n');

  const built = buildCatalog({ sources: { t: src }, categories: { coding: 'Coding' }, meta: { one: ['coding', ['x']] } });
  assert.equal(built.total, 3);
  assert.equal(built.total, built.skills.length);
  assert.equal(built.skills.find((s) => s.name === 'one').description, 'A folded description.');
  assert.equal(built.skills.find((s) => s.name === 'three').category, 'unmapped');

  const md = renderMarkdown(built);
  assert.match(md, /3 skills: 1 categorised, 2 uncategorised/);
  assert.match(md, /## unmapped \(2\)/, 'uncategorised skills must be listed, not silently dropped');
  for (const s of built.skills) assert.ok(md.includes(s.name), s.name + ' missing from the markdown index');
});
