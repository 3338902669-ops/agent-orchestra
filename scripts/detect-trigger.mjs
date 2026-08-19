#!/usr/bin/env node
// detect-trigger.mjs - decide whether the multi-agent-orchestration skill should engage
// Usage:
//   node scripts/detect-trigger.mjs --text "...task text..." [--config config/agents.example.yaml]
//   echo "text" | node scripts/detect-trigger.mjs [--config ...]
// Exit code 0 = ENGAGED (skill should be used); exit code 1 = NOT ENGAGED.

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
  const out = { mode: 'keyword', match: 'any', case_sensitive: false, keywords: [], exclude_keywords: [] };
  let inActivation = false, inList = null, modeLine = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'activation:') { inActivation = true; continue; }
    if (inActivation && trimmed !== '' && !trimmed.startsWith('-') && !trimmed.startsWith('#') && !/^\s/.test(line)) { inActivation = false; }
    if (!inActivation) continue;
    if (trimmed.startsWith('- ')) {
      if (inList) out[inList].push(trimmed.slice(2).replace(/^["']|["']$/g, ''));
      continue;
    }
    const m = trimmed.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1], val = m[2].replace(/^["']|["']$/g, '');
    if (key === 'mode') { out.mode = val || 'keyword'; modeLine = true; }
    else if (key === 'match') out.match = val || 'any';
    else if (key === 'case_sensitive') out.case_sensitive = val === 'true';
    else if (key === 'keywords') inList = 'keywords';
    else if (key === 'exclude_keywords') inList = 'exclude_keywords';
    else inList = null;
  }
  return out;
}

function decide(cfg, text) {
  if (cfg.mode === 'global') return { engaged: true, reason: 'mode=global' };
  if (cfg.mode === 'manual') return { engaged: false, reason: 'mode=manual (explicit invocation required)' };
  // keyword mode
  const hay = cfg.case_sensitive ? text : text.toLowerCase();
  const norm = (s) => (cfg.case_sensitive ? s : s.toLowerCase());
  const hits = cfg.keywords.filter((k) => hay.includes(norm(k)));
  const excludes = cfg.exclude_keywords.filter((k) => hay.includes(norm(k)));
  if (excludes.length > 0) return { engaged: false, reason: 'excluded by: ' + excludes.join(',') };
  if (hits.length === 0) return { engaged: false, reason: 'no keyword matched' };
  if (cfg.match === 'all') {
    const all = cfg.keywords.every((k) => hay.includes(norm(k)));
    return all ? { engaged: true, reason: 'all keywords matched', hits } : { engaged: false, reason: 'match=all but not every keyword matched', hits };
  }
  return { engaged: true, reason: 'keyword matched', hits };
}

const args = parseArgs(process.argv);
let text = args.text || '';
if (!text && !process.stdin.isTTY) {
  text = fs.readFileSync(0, 'utf8').trim();
}
if (!text) { console.error('No --text or stdin provided'); process.exit(2); }

let cfg = { mode: args.mode || 'keyword', match: 'any', case_sensitive: false, keywords: [], exclude_keywords: [] };
if (args.config) {
  try { cfg = readYamlSection(args.config); } catch (e) { console.error('Config read failed: ' + e.message); process.exit(2); }
}

const result = decide(cfg, text);
console.log(result.engaged ? 'ENGAGED' : 'NOT_ENGAGED', '|', result.reason, result.hits ? '| hits: ' + result.hits.join(', ') : '');
process.exit(result.engaged ? 0 : 1);
