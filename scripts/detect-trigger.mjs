#!/usr/bin/env node
// detect-trigger.mjs - decide whether the agent-orchestra skill should engage
// Usage:
//   node scripts/detect-trigger.mjs --text "...task text..." [--config config/agents.example.yaml]
//   echo "text" | node scripts/detect-trigger.mjs [--config ...]
// Exit code 0 = ENGAGED (skill should be used); exit code 1 = NOT ENGAGED.
//
// Matching is deliberately two-tiered, because plain substrings match terminology rather
// than intent ("k8s 编排" is not multi-agent work, while "两个 AI 改同一个文件" is):
//   * keywords - unambiguous phrases, matched as substrings;
//   * patterns - regular expressions for intent and spoken variants, so the skill engages
//     on how people actually describe the problem rather than on the vocabulary it uses.
//   * exclude_keywords - a veto that wins over any hit.

import fs from 'node:fs';
import process from 'node:process';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text') { args.text = argv[++i]; }
    else if (a === '--config') { args.config = argv[++i]; }
    else if (a === '--mode') { args.mode = argv[++i]; }
    else if (a === '--dump-config') { args.dumpConfig = true; }
  }
  return args;
}

function readYamlSection(file) {
  // minimal YAML reader for the activation block only
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  const out = {
    mode: 'keyword', match: 'any', case_sensitive: false,
    keywords: [], keywords_requiring_subject: [], patterns: [], exclude_keywords: [], agent_anchors: [], software_objects: [], coordination_acts: [], inquiry_words: [],
    comparison_veto: { comparison_words: [], collaboration_words: [], attribute_nouns: [] },
  };
  let inActivation = false, inList = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'activation:') { inActivation = true; continue; }
    if (inActivation && trimmed !== '' && !trimmed.startsWith('-') && !trimmed.startsWith('#') && !/^\s/.test(line)) { inActivation = false; }
    if (!inActivation) continue;
    if (trimmed.startsWith('- ')) {
      if (inList) {
        const value = trimmed.slice(2).replace(/^["']|["']$/g, '');
        const [head, tail] = inList.split('.');
        if (tail) out[head][tail].push(value);
        else out[inList].push(value);
      }
      continue;
    }
    const m = trimmed.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const raw = m[2];
    // Inline arrays ("key: [a, b]") are as valid as block lists, and silently reading only one
    // of the two is how a veto list ends up empty while the config looks correct.
    const target = {
      keywords: 'keywords',
      keywords_requiring_subject: 'keywords_requiring_subject',
      patterns: 'patterns',
      exclude_keywords: 'exclude_keywords',
      comparison_words: 'comparison_veto.comparison_words',
      collaboration_words: 'comparison_veto.collaboration_words',
      agent_anchors: 'agent_anchors',
      software_objects: 'software_objects',
      attribute_nouns: 'comparison_veto.attribute_nouns',
      coordination_acts: 'coordination_acts',
      inquiry_words: 'inquiry_words',
    }[key];
    if (raw.startsWith('[')) {
      const items = raw.replace(/^\[/, '').replace(/\]\s*$/, '')
        .split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      if (target) {
        const [head, tail] = target.split('.');
        if (tail) out[head][tail].push(...items);
        else out[target].push(...items);
      }
      inList = null;
      continue;
    }
    const val = raw.replace(/^["']|["']$/g, '');
    if (key === 'mode') out.mode = val || 'keyword';
    else if (key === 'match') out.match = val || 'any';
    else if (key === 'case_sensitive') out.case_sensitive = val === 'true';
    else inList = target ?? null;
  }
  return out;
}

/** Compile the configured patterns once; a broken pattern is a config error, not a silent miss. */
function compilePatterns(cfg) {
  return (cfg.patterns ?? []).map((source) => {
    try {
      return { source, re: new RegExp(source, cfg.case_sensitive ? 'u' : 'iu') };
    } catch (error) {
      throw new Error(`Invalid pattern "${source}": ${error.message}`);
    }
  });
}

function decide(cfg, text) {
  if (cfg.mode === 'global') return { engaged: true, reason: 'mode=global' };
  if (cfg.mode === 'manual') return { engaged: false, reason: 'mode=manual (explicit invocation required)' };

  const hay = cfg.case_sensitive ? text : text.toLowerCase();
  const norm = (s) => (cfg.case_sensitive ? s : s.toLowerCase());

  const excludes = (cfg.exclude_keywords ?? []).filter((k) => hay.includes(norm(k)));
  if (excludes.length > 0) return { engaged: false, reason: 'excluded by: ' + excludes.join(',') };

  // Comparison handling is where a deterministic filter must stop pretending. "对比这两个模型分别
  // 负责各自模块开发的能力" and "让两个 agent 协同开发，最后对比哪个版本更好" contain the same
  // words and need opposite answers; no word list or character window can tell them apart, and
  // seven verification rounds proved it by moving the hole each time it was patched. So the
  // ambiguous family is not classified - it is SURFACED to the caller as POSSIBLE, and the host
  // model (which can read the sentence) decides. What the filter still decides on its own is the
  // unambiguous case.
  const veto = cfg.comparison_veto ?? {};
  const comparisons = (veto.comparison_words ?? []).filter((w) => hay.includes(norm(w)));
  const possible = (reason, extra = {}) => ({ engaged: false, possible: true, reason, ...extra });
  const notEngaged = (reason, extra = {}) => ({ engaged: false, possible: false, reason, ...extra });

  const hits = (cfg.keywords ?? []).filter((k) => hay.includes(norm(k)));
  const allPatternHits = compilePatterns(cfg).filter((p) => p.re.test(text)).map((p) => p.source);

  // Conjunction, not a hit: a pattern only engages when the sentence also names an agent-ish
  // subject AND an act of coordinating. "两个同事同时改同一个文件" matches the file-sharing
  // pattern but names no agent, so it stays silent - which is the point.
  const anchors = (cfg.agent_anchors ?? []).filter((w) => hay.includes(norm(w)));
  const objects = (cfg.software_objects ?? []).filter((w) => hay.includes(norm(w)));
  const acts = (cfg.coordination_acts ?? []).filter((w) => hay.includes(norm(w)));
  const gated = (cfg.agent_anchors ?? []).length > 0;
  const subjects = [...anchors, ...objects];
  const patternHits = gated ? (subjects.length && acts.length ? allPatternHits : []) : allPatternHits;

  // A comparison word means the sentence is never ENGAGED, full stop. Earlier versions tried to
  // let a "strong action" release this (各自写完再对比) and to guard against compared attributes
  // with word lists and character windows; eight verification rounds showed that every such escape
  // becomes the next hole, because the metric nouns are unbounded ("速度/延迟/准确率/得分/吞吐量")
  // and the action words are interchangeable. Downgrading is always safe - the worst case is that
  // the caller decides on a sentence it could have decided anyway - whereas a wrong ENGAGED is a
  // wrong decision the filter made on its own.
  if (comparisons.length > 0) {
    // Gated: only a real coordination signal counts as "coordination wording too", so a bare
    // comparison with an unrelated pattern match is silent rather than surfaced.
    if (hits.length || patternHits.length || acts.length) {
      return possible('comparison wording alongside coordination wording (' + comparisons[0] + ')', { comparisons });
    }
    return notEngaged('comparison/evaluation request, not orchestration (' + comparisons.join(', ') + ')', { comparisons });
  }

  if (cfg.match === 'all') {
    const missingKeywords = (cfg.keywords ?? []).filter((k) => !hay.includes(norm(k)));
    const missingPatterns = compilePatterns(cfg).filter((p) => !p.re.test(text)).map((p) => p.source);
    const all = missingKeywords.length === 0 && missingPatterns.length === 0;
    return all
      ? { engaged: true, reason: 'all keywords and patterns matched', anchors, objects, acts, hits, patternHits }
      : { engaged: false, reason: 'match=all but not every signal matched', anchors, objects, acts, hits, patternHits };
  }

  if (hits.length === 0 && allPatternHits.length > 0 && gated && !(subjects.length && acts.length)) {
    return {
      engaged: false,
      possible: false,
      reason: 'a coordination phrase without a subject (agent or artifact) or without an act of coordinating'
        + (subjects.length ? '' : ' (no agent or artifact named)') + (acts.length ? '' : ' (no act of coordinating)'),
      anchors, objects, acts,
    };
  }
  // A pattern never decides engagement on its own. Patterns describe how people phrase things, and
  // any such phrase can also be the subject of a comparison, a headline or an article - nine
  // verification rounds showed that every "pattern engages unless X" rule just moves the hole into
  // the next unlisted X. So patterns SURFACE the sentence (exit 3) and only a curated, self-anchored
  // keyword phrase auto-engages. Downgrading costs the host one decision it is better equipped to
  // make than a word list; a wrong engage is a decision the filter made alone.
  // Knowing the vocabulary is not asking to use it, and a hand-written list of question/evaluation
  // words in two languages proved impossible to keep complete (round 11 walked straight through it:
  // "what is multi-agent", "explain single-writer", "multi-agent 是个啥"). The conjunction is what
  // closes it: a keyword must be accompanied by an ACT of coordinating. Questions about the topic
  // carry the keyword and no act, so they surface in whatever language they are asked.
  if (hits.length > 0 && subjects.length > 0 && acts.length > 0) {
    return { engaged: true, reason: 'keyword matched with an act of coordinating', hits, acts, patternHits };
  }
  // A verb keyword needs a subject; a topic phrase does not.
  //   "k8s 编排文件"      - 编排 (a verb) used as a modifier of an artifact noun: about a file.
  //   "编排这几个 agent"   - the same verb with an agent named: a request.
  //   "benefits of independent verification" - a TOPIC phrase, no verb: still surfaced, because the
  //                          host is better placed to decide what to do with a question about the topic.
  // The two classes are listed explicitly rather than guessed, so this cannot become the next
  // "unlisted X" hole: a keyword that is a verb goes in keywords_requiring_subject.
  if (hits.length > 0 && subjects.length === 0) {
    const subjectRequired = (cfg.keywords_requiring_subject ?? []).map(norm);
    const onlyVerbKeywords = subjectRequired.length > 0
      && hits.every((h) => subjectRequired.some((k) => norm(h).includes(k)));
    if (onlyVerbKeywords) {
      return {
        engaged: false,
        possible: false,
        reason: 'a verb keyword (' + hits.join(', ') + ') with no agent or artifact subject is about the word, not about agents',
        anchors, objects, acts, hits, patternHits,
      };
    }
  }
  if (hits.length > 0) {
    return possible('keyword without an act of coordinating (a question or an evaluation about the topic)', { hits });
  }
  if (patternHits.length > 0) {
    return possible('coordination phrasing without an unambiguous keyword (' + patternHits.length + ' pattern(s))', { patternHits });
  }
  return notEngaged('no keyword or pattern matched');
}

const args = parseArgs(process.argv);

// --dump-config prints exactly what the parser read. A config that looks right but parses empty is
// how the comparison veto silently stopped working once; being able to see the parse is the fix.
if (args.dumpConfig) {
  const path = args.config || (fs.existsSync('config/agents.example.yaml') ? 'config/agents.example.yaml' : null);
  console.log(JSON.stringify(path ? readYamlSection(path) : { error: 'no config found' }, null, 2));
  process.exit(0);
}

let text = args.text || '';
if (!text && !process.stdin.isTTY) {
  text = fs.readFileSync(0, 'utf8').trim();
}
if (!text) { console.error('No --text or stdin provided'); process.exit(2); }

const defaultConfigPath = 'config/agents.example.yaml';
const configPath = args.config || (fs.existsSync(defaultConfigPath) ? defaultConfigPath : null);
let cfg = { mode: args.mode || 'keyword', match: 'any', case_sensitive: false, keywords: [], patterns: [], exclude_keywords: [] };
if (configPath) {
  try { cfg = readYamlSection(configPath); } catch (e) { console.error('Config read failed: ' + e.message); process.exit(2); }
} else if (!args.mode) {
  console.error('No --config given and no default config found at ' + defaultConfigPath + '.');
  console.error('Pass --config <path>, or --mode global|manual.');
  process.exit(2);
}
if (cfg.mode === 'keyword' && cfg.keywords.length === 0 && (cfg.patterns ?? []).length === 0) {
  console.error('Keyword activation mode has an empty keyword and pattern list; it would silently never engage.');
  console.error('Add keywords or patterns to ' + (configPath || 'the config') + ' or use --mode global|manual.');
  process.exit(2);
}

let result;
try {
  result = decide(cfg, text);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const detail = [
  result.reason,
  result.hits?.length ? 'hits: ' + result.hits.join(', ') : null,
  result.patternHits?.length ? 'patterns: ' + result.patternHits.length : null,
].filter(Boolean).join(' | ');
const label = result.engaged ? 'ENGAGED' : (result.possible ? 'POSSIBLE' : 'NOT_ENGAGED');
console.log(label, '|', detail);
// 0 = engage, 3 = ambiguous, surface it to the caller, 1 = stay silent
process.exit(result.engaged ? 0 : (result.possible ? 3 : 1));
