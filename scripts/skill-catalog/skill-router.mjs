#!/usr/bin/env node
/**
 * skill-router.mjs - route a task description to the skills that can serve it.
 *
 *   node skill-router.mjs "<task>"                  top matches
 *   node skill-router.mjs --all                     every skill, grouped
 *   node skill-router.mjs --category <name>         one category
 *   echo "<task>" | node skill-router.mjs           read the task from stdin
 *   node skill-router.mjs --catalog <path>          use a catalog other than ./skills-catalog.json
 *
 * WHY DESCRIPTION IS THE PRIMARY SIGNAL
 *
 * The obvious design is a hand-written keyword list per skill. It does not scale, and this
 * implementation is built on the reason why: a keyword list is a SECOND, hand-maintained copy
 * of information that already exists. By convention every skill's frontmatter carries a
 * `description` written as its trigger ("Use when ...") - that field exists precisely so a
 * router can find the skill, and every author must write it or the skill is unusable. In the
 * catalogue this was extracted from, 264 of 264 skills had a description and only 121 had
 * keywords. The keywords were the incomplete copy.
 *
 * So the score is led by idf-weighted token overlap over name + description, and keywords are
 * a BONUS when present rather than an entry requirement. Two consequences worth stating:
 *
 *   - Recall becomes total. Every skill with a description can be reached, with no authoring.
 *   - A skill nobody categorised, keyworded or promoted is still findable.
 *
 * THE PRECISION PROBLEM, AND WHY A STOPLIST IS ALLOWED
 *
 * Lexical scoring alone is credulous. Splitting Chinese into 2-grams turns function words into
 * evidence: "what is the weather today" scored 9.78 against a trending-topics skill - higher
 * than four genuine task queries. Measured on a 16-query sample, no threshold on score, match
 * count or coverage separated the two classes; only removing function words did.
 *
 * That is why this file ships a stoplist but no keyword list, and the distinction is the whole
 * point: **function words are a closed class** - pronouns, question words, time words,
 * quantifiers - and can be enumerated once and finished. **Domain keywords are an open class**
 * and can never be finished. One is a bounded chore; the other is a treadmill.
 *
 * On the same 16 queries, stoplist + evidence gate scored 16/16: every genuine task matched,
 * every irrelevant query was refused. Note it is a 16-query sample, not a labelled corpus - the
 * stoplist is expected to grow as real false positives appear. It will finish; a keyword list
 * would not.
 *
 * Zero dependencies. Node 18+.
 */

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Generic domain phrases only - no skill names, no machine-specific behaviour. Extend per catalogue. */
export const DEFAULT_SYNONYMS = [
  { re: /(官网|网站|网页|落地页|landing|建站|页面|前端|design.?web)/i, add: 'frontend web ui design' },
  { re: /(外联|触达|开发信|cold\s?(mail|email)|获客|客户开发|拉新)/i, add: 'outreach email sales marketing' },
  { re: /(截图|设计稿|效果图).*(转|生成)/i, add: 'screenshot to code' },
];

export function normalize(s) {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Subsequence match: the characters of kw appear in order inside task. Carries Chinese, which has no spaces. */
export function isSubsequence(task, kw) {
  const t = task.replace(/\s+/g, '');
  const k = kw.replace(/\s+/g, '');
  if (!k || k.length > t.length) return false;
  let i = 0;
  for (let j = 0; j < t.length && i < k.length; j += 1) {
    if (t[j] === k[i]) i += 1;
  }
  return i === k.length;
}

/** ASCII words + CJK 2-grams. Bigrams are a crude but adequate stand-in for Chinese segmentation. */
export function tokenize(s) {
  const text = (s || '').toLowerCase();
  const out = [];
  const ascii = text.match(/[a-z0-9][a-z0-9+.#_-]*/g);
  if (ascii) out.push(...ascii);
  const cjk = text.match(/[\u4e00-\u9fff]+/g);
  if (cjk) {
    for (const run of cjk) {
      for (let i = 0; i + 1 < run.length; i += 1) out.push(run.slice(i, i + 2));
    }
  }
  return out;
}

/** Closed-class function words. Extend, but it is finite by construction. */
export const DEFAULT_STOP = new Set(('怎么 什么 这个 那个 一下 帮我 我们 他们 你们 可以 今天 明天 昨天 现在 是不是 有没有 为什 时候 一个 一份 一点 一些 就是 还是 但是 因为 所以 如果 这样 那样 知道 觉得 应该 需要 想要 去哪 帮忙 如何 哪些 哪个').split(/\s+/).filter(Boolean));

export function loadCatalog(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Precompute the document token sets and the idf table once. */
export function buildIndex(catalog, { stop = DEFAULT_STOP, synonyms = DEFAULT_SYNONYMS } = {}) {
  const docTokens = new Map();
  const df = new Map();
  for (const s of catalog.skills) {
    const toks = new Set(tokenize(s.name + ' ' + (s.description || '') + ' ' + (s.keywords || []).join(' ')));
    docTokens.set(s.name, toks);
    for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  }
  const n = catalog.skills.length;
  return {
    catalog, docTokens, df, n, stop, synonyms,
    idf: (t) => Math.log(1 + n / (1 + (df.get(t) || 0))),
  };
}

export function scoreSkill(index, skill, taskNorm) {
  let score = 0;
  const hits = [];

  const doc = index.docTokens.get(skill.name) || new Set();
  const matched = [];
  let idfScore = 0;
  for (const t of new Set(tokenize(taskNorm))) {
    if (index.stop.has(t)) continue; // function words are not evidence
    if (doc.has(t)) { idfScore += index.idf(t); matched.push(t); }
  }
  if (idfScore) {
    score += idfScore;
    hits.push(...matched.sort((a, b) => index.idf(b) - index.idf(a)).slice(0, 4));
  }

  // Evidence gate. One accidental bigram is not a match: require two content CJK tokens, or
  // one ASCII token, or an explicit name/keyword hit.
  const cjkContent = matched.filter((t) => !/^[a-z0-9]/.test(t)).length;
  const asciiContent = matched.length - cjkContent;
  let strong = cjkContent >= 2 || asciiContent >= 1;

  for (const kw of skill.keywords || []) {
    const k = kw.toLowerCase();
    if (taskNorm.includes(k)) { score += 2; hits.push(kw); strong = true; }
    else if (isSubsequence(taskNorm, k)) { score += 1; hits.push('~' + kw); }
  }
  if (taskNorm.includes(skill.name)) { score += 4; hits.push('name:' + skill.name); strong = true; }
  const catName = (index.catalog.categories || {})[skill.category] || skill.category;
  if (catName && taskNorm.includes(String(catName))) { score += 2; hits.push('cat:' + skill.category); }

  return { skill, score: Number(score.toFixed(2)), hits, strong };
}

export function topMatch(index, task, n = 6) {
  const base = normalize(task);
  let extra = '';
  for (const g of index.synonyms || []) {
    try { if (g.re.test(base)) extra += ' ' + g.add; } catch { /* a bad pattern must not break routing */ }
  }
  const taskNorm = (base + extra).trim();
  if (!taskNorm) return [];
  // No category filter. Excluding uncategorised skills means "installed but never selectable".
  return index.catalog.skills
    .map((s) => scoreSkill(index, s, taskNorm))
    .filter((r) => r.strong && r.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, n);
}

function resolveCatalogPath(args) {
  const ci = args.indexOf('--catalog');
  if (ci >= 0 && args[ci + 1]) return resolve(args[ci + 1]);
  if (process.env.SKILL_CATALOG) return resolve(process.env.SKILL_CATALOG);
  const beside = join(HERE, 'skills-catalog.json');
  const cwd = resolve('skills-catalog.json');
  try { readFileSync(beside); return beside; } catch { return cwd; }
}

function main() {
  const args = process.argv.slice(2);
  const catalogPath = resolveCatalogPath(args);
  let catalog;
  try {
    catalog = loadCatalog(catalogPath);
  } catch (error) {
    console.error('Cannot read catalogue at ' + catalogPath + ': ' + (error && error.message ? error.message : error));
    console.error('Pass one with --catalog <path>, set SKILL_CATALOG, or generate it with rebuild-skill-catalog.mjs.');
    process.exit(2);
  }
  const index = buildIndex(catalog);

  if (args.includes('--all')) {
    for (const c of Object.keys(catalog.categories || {})) {
      const list = catalog.skills.filter((s) => s.category === c);
      console.log('\n## ' + c + ' - ' + catalog.categories[c] + ' (' + list.length + ')');
      for (const s of list) console.log('  ' + s.name);
    }
    const unmapped = catalog.skills.filter((s) => s.category === 'unmapped');
    if (unmapped.length) {
      // Listed, not omitted: a human-readable index that silently drops half the entries is a
      // number in the header that does not match what follows it.
      console.log('\n## unmapped (' + unmapped.length + ')');
      for (const s of unmapped) console.log('  ' + s.name);
    }
    console.log('\n' + catalog.skills.length + ' skills total');
    return;
  }

  const ci = args.indexOf('--category');
  if (ci >= 0 && args[ci + 1]) {
    const c = args[ci + 1];
    const list = catalog.skills.filter((s) => s.category === c);
    console.log('## ' + c + ' - ' + ((catalog.categories || {})[c] || '?') + ' (' + list.length + ')\n');
    for (const s of list) {
      console.log('  [' + s.category + '] ' + s.name);
      console.log('    keywords: ' + ((s.keywords || []).slice(0, 8).join(', ') || '(none)'));
      console.log('    location: ' + (s.locations || []).map((l) => l.source + ':' + l.dir).join(', '));
      console.log('    about:    ' + (s.description || '').slice(0, 140));
      console.log();
    }
    return;
  }

  const flagFiltered = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--catalog'));
  let task = flagFiltered.join(' ').trim();
  if (!task && !process.stdin.isTTY) {
    try { task = readFileSync(0, 'utf8').trim(); } catch { task = ''; }
  }
  if (!task) {
    console.log('usage: node skill-router.mjs "<task>"  |  --all  |  --category <name>  |  --catalog <path>');
    process.exit(1);
  }

  const results = topMatch(index, task);
  if (!results.length) {
    console.log('No skill matched. Either nothing in this catalogue covers the task, or it needs a');
    console.log('tool rather than a skill. Try: node skill-router.mjs --all');
    return;
  }
  console.log('task: ' + task);
  console.log(results.length + ' match(es), most relevant first:\n');
  results.forEach((r, i) => {
    console.log('  #' + (i + 1) + ' (score ' + r.score + ') [' + r.skill.category + '] ' + r.skill.name);
    if (r.hits.length) console.log('     hit: ' + [...new Set(r.hits)].slice(0, 10).join(', '));
    const loc = (r.skill.locations || [])[0];
    if (loc) console.log('     path: ' + (isAbsolute(loc.dir) ? loc.dir : loc.source + ':' + loc.dir) + '/SKILL.md');
    console.log();
  });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
