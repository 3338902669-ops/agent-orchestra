#!/usr/bin/env node
// check-config-usage.mjs - a config key that no script reads is documentation pretending to be
// automation. That is how `security_scan: [yes, no]` sat in the shipped config while the engine
// rejected it, and how cost tiers, risk triggers and a routing threshold ended up looking like
// behaviour nothing implemented.
//
// Every key in the config must be EITHER referenced by the scripts, OR listed here as advisory
// with a reason. A new key that is neither fails the gate, so dead config cannot accumulate.
//
// Usage: node scripts/check-config-usage.mjs [config-path]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/** Keys that are deliberately documentation only, with the reason they are not enforced. */
export const ADVISORY = {
  tiers: 'cost tiers are labels for humans; the engine only reads an agent\'s numeric cost',
  default_tier: 'same: a label, not a decision the engine makes',
  cheap_model_for: 'routing advice for the operator; the engine never chooses a model',
  strong_model_for: 'routing advice for the operator; the engine never chooses a model',
  require_cost_report: 'a reporting convention; no machine artifact is produced or checked',
  max_retries_per_stage: 'a policy for the human coordinator; the engine has no retry loop',
  important_triggers: 'the caller asserts importance via --important; the engine cannot see whether a change touches user-facing behaviour',
  risk: 'the risk vocabulary is a human label; only the important flag and externalAction are machine-read',
  role_assignment: 'names the five roles for the reader; the engine derives roles from scores and routes',
  record_to: 'a documentation convention for where the answers are written',
  tiers_note: 'free-text guidance',
  // The queue and handoff sections describe behaviour the engine implements in code rather than by
  // reading these keys. They are kept because a reader needs the settings written down; the gate
  // below is what keeps a *behavioural* claim from hiding among them.
  enabled: 'the queue CLI exists whether or not it is switched on here; this flag is for the operator',
  state_file: 'the CLI takes the state path from ORCHESTRATOR_STATE or its own default',
  lock_path: 'locks are derived from the state file path (<state>.lock), not configured',
  record_dir: 'the handoff directory is chosen per project; no script can assume one',
  record_in: 'same: where the record lives is an operator decision',
  iron_rules: 'the five rules are stated for the reader; the machine checks the ones it can (packet, evidence, precedence)',
  memory_sync: 'a routine for the human coordinator; nothing schedules it',
  record_to: 'a documentation convention for where the answers are written',
  required_for: 'the intake gate is enforced through the important flag and externalAction',
  external_actions: 'the approval record is implemented; the key names the concept for the reader',
  blocked_effects: 'the engine blocks exactly these two transitions in code',
  soft_override: 'the override exists and requires three fields; the flag documents that it is allowed',
  override_available_when: 'the engine refuses an override when nothing is blocked, matching this value',
  override_is_not_evidence: 'the engine keeps status=failed next to the override, which is the same statement in code',
  failure_requires: 'enforced: a FAIL must carry criteria or findings',
  non_dispatchable_exit_code: 'the CLI exits non-zero for non-dispatchable tasks; the number itself is not read',
  on_conflict: 'a precedence rule for the human; the engine has no conflict resolver',
  forbidden_phrasings: 'a writing rule for agents, checked by review rather than by a parser',
  re_verify_after_context_compaction: 'a discipline for the agent; the machine cannot see a context compaction',
  reviewers_may_write_isolated_artifacts: 'a boundary for the team; the engine only enforces the single-writer lock',
  reviewers_may_write_shared_resources: 'same boundary, stated for the reader',
  important_pipeline: 'the stage list is descriptive; the engine uses STAGES',
  critical_pipeline: 'same',
  critical_triggers: 'the caller asserts criticality; the engine has no risk detector',
  domain_reviewer: 'a role name for the reader; roles are derived from scores',
  environment_specialist: 'a role name for the reader; roles are derived from scores',
  webhand: 'an example agent id inside the example roster, not a config key',
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(mjs|cjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Keys at any indentation in the config, deduplicated. */
export function configKeys(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/(^|\s)#.*$/, '');
    const m = clean.match(/^\s+(?:-\s+)?([a-z_][a-z0-9_]*):/);
    if (m) keys.add(m[1]);
  }
  return [...keys].sort();
}

export function checkConfigUsage(configPath, scriptsDir) {
  const config = readFileSync(configPath, 'utf8');
  const sources = walk(scriptsDir).map((f) => readFileSync(f, 'utf8')).join('\n');
  const problems = [];
  for (const key of configKeys(config)) {
    const referenced = new RegExp('\\b' + key + '\\b').test(sources);
    if (referenced) continue;
    if (ADVISORY[key]) continue;
    problems.push(key + ': no script reads it and it is not listed as advisory in check-config-usage.mjs');
  }
  return { ok: problems.length === 0, problems };
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-config-usage.mjs');
if (isMain) {
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const configPath = process.argv[2] || join(root, 'config/agents.example.yaml');
  const result = checkConfigUsage(configPath, join(root, 'scripts'));
  if (result.ok) {
    console.log('every config key is either read by a script or declared advisory: ' + configPath);
    process.exit(0);
  }
  console.error(result.problems.map((x) => '  - ' + x).join('\n'));
  process.exit(1);
}
