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
  }
  return args;
}

function readYamlSection(file) {
  // minimal YAML reader for the activation block only
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  const out = {
    mode: 'keyword', match: 'any', case_sensitive: false,
    keywords: [], patterns: [], exclude_keywords: [],
    comparison_veto: { comparison_words: [], collaboration_words: [] },
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
      patterns: 'patterns',
      exclude_keywords: 'exclude_keywords',
      comparison_words: 'comparison_veto.comparison_words',
      collaboration_words: 'comparison_veto.collaboration_words',
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

  // Sentence-level veto: comparing or choosing between models is a different job from running
  // several of them, and no amount of agent vocabulary changes that. The escape hatch keeps
  // real work that merely mentions a comparison ("...各自改完再对比") engagable.
  const veto = cfg.comparison_veto ?? {};
  const comparisons = (veto.comparison_words ?? []).filter((w) => hay.includes(norm(w)));
  const collaborations = (veto.collaboration_words ?? []).filter((w) => hay.includes(norm(w)));
  if (comparisons.length > 0 && collaborations.length === 0) {
    return {
      engaged: false,
      reason: 'comparison/evaluation request, not orchestration (' + comparisons.join(', ') + ')',
    };
  }

  const hits = (cfg.keywords ?? []).filter((k) => hay.includes(norm(k)));
  const patternHits = compilePatterns(cfg).filter((p) => p.re.test(text)).map((p) => p.source);

  if (cfg.match === 'all') {
    const missingKeywords = (cfg.keywords ?? []).filter((k) => !hay.includes(norm(k)));
    const missingPatterns = compilePatterns(cfg).filter((p) => !p.re.test(text)).map((p) => p.source);
    const all = missingKeywords.length === 0 && missingPatterns.length === 0;
    return all
      ? { engaged: true, reason: 'all keywords and patterns matched', hits, patternHits }
      : { engaged: false, reason: 'match=all but not every signal matched', hits, patternHits };
  }

  if (hits.length === 0 && patternHits.length === 0) {
    return { engaged: false, reason: 'no keyword or pattern matched' };
  }
  return {
    engaged: true,
    reason: hits.length && patternHits.length ? 'keyword and pattern matched' : (hits.length ? 'keyword matched' : 'pattern matched'),
    hits,
    patternHits,
  };
}

const args = parseArgs(process.argv);
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
console.log(result.engaged ? 'ENGAGED' : 'NOT_ENGAGED', '|', detail);
process.exit(result.engaged ? 0 : 1);
