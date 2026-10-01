import fs from 'node:fs';
import process from 'node:process';
import {
  CAPABILITIES,
  DEFAULT_ROSTER,
  E1_REQUIRED_FIELDS,
  EVIDENCE_GRADES,
  EXECUTION_MODES,
  PLAN_CHOICES,
  RIGOR_LEVELS,
  ROLES,
  STAGES,
  TYPES,
  validateRoster,
} from './orchestrator/lib.mjs';

// Validate the config against the ENGINE, not against a list of magic strings.
// The previous version only checked that certain text appeared somewhere in the file, so
// it happily accepted a config whose values the engine rejects at runtime - e.g.
// security_scan: [yes, no] while the CLI only accepts planned|skip. Every value checked
// below is compared with the enum the code actually uses, so the config cannot lie.

const file = process.argv[2] || 'config/agents.example.yaml';
const text = fs.readFileSync(file, 'utf8');
const errors = [];

// --- comment stripping, duplicate-key rejection, line-anchored matching ---
const seen = new Map();
const body = [];
// Keys are only duplicates within the same top-level section: "default" under risk and
// "default" under rigor are different keys, and treating them as one was this validator's
// own false positive.
let currentSection = '(root)';
text.split(/\r?\n/).forEach((raw, index) => {
  const line = raw.replace(/(^|\s)#.*$/, '');
  if (!line.trim()) return;
  const top = line.match(/^([A-Za-z_][\w-]*):(?:\s|$)/);
  if (top) currentSection = top[1];
  const key = line.match(/^(\s*)([A-Za-z_][\w.-]*):(?:\s|$)/);
  if (key) {
    const path = currentSection + ' > ' + key[1].length + ':' + key[2];
    if (seen.has(path)) {
      errors.push('duplicate key "' + key[2] + '" in section "' + currentSection + '" at line ' + (index + 1) + ' (first seen at line ' + seen.get(path) + ')');
    } else {
      seen.set(path, index + 1);
    }
  }
  body.push(line);
});
const yaml = body.join('\n');
const lines = yaml.split('\n');

const section = (name) => new RegExp('^' + name + ':', 'm').test(yaml);
for (const name of ['activation', 'intake_gate', 'risk', 'roles', 'ownership', 'roster', 'handoff', 'queue', 'approval', 'verification_gate', 'evidence', 'cost']) {
  if (!section(name)) errors.push('missing section: ' + name);
}
const requireMatch = (pattern, message) => { if (!pattern.test(yaml)) errors.push(message); };
/** The lines of one top-level section, so a lookup cannot match a same-named key elsewhere. */
const sectionLines = (section) => {
  const start = lines.findIndex((l) => new RegExp('^' + section + ':\\s*$').test(l));
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z_]/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
};
const scalar = (key, section) => {
  const scope = section ? sectionLines(section) : lines;
  if (!scope) return null;
  const m = scope.join('\n').match(new RegExp('^\\s+' + key + ':\\s*(\\S+)\\s*$', 'm'));
  return m ? m[1] : null;
};
const inlineList = (key) => {
  // The value may sit on its own line or on a "- " bullet (the intake-gate questions are
  // written as list items).
  const m = yaml.match(new RegExp('^\\s+(?:-\\s+)?' + key + ':\\s*\\[([^\\]]*)\\]\\s*$', 'm'));
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
};
const blockList = (key) => {
  const start = lines.findIndex((l) => new RegExp('^\\s+' + key + ':\\s*$').test(l));
  if (start < 0) return null;
  const indent = lines[start].match(/^\s*/)[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.match(/^\s*/)[0].length <= indent) break;
    const item = line.trim().match(/^-\s*(.+)$/);
    if (item) out.push(item[1].replace(/^["']|["']$/g, '').trim());
  }
  return out;
};
/** Child keys of a YAML mapping block, e.g. the agents under "agents:". */
const mappingKeys = (key) => {
  const start = lines.findIndex((l) => new RegExp('^\\s+' + key + ':\\s*$').test(l));
  if (start < 0) return null;
  const indent = lines[start].match(/^\s*/)[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const lineIndent = line.match(/^\s*/)[0].length;
    if (lineIndent <= indent) break;
    const child = line.trim().match(/^([A-Za-z_][\w.-]*):/);
    if (child && lineIndent === indent + 2) out.push(child[1]);
  }
  return out;
};

const valuesIn = (key, allowed) => {
  const list = inlineList(key) === null ? blockList(key) : inlineList(key);
  if (list === null) return null;
  for (const value of list) {
    if (!allowed.includes(value)) {
      errors.push(key + ' contains "' + value + '", which the engine rejects (allowed: ' + allowed.join(', ') + ')');
    }
  }
  return list;
};

// --- activation ---
requireMatch(/^\s+mode:\s*(global|keyword|manual)\s*$/m, 'activation.mode must be global, keyword, or manual');
if (/^\s+mode:\s*keyword\s*$/m.test(yaml)) {
  const keywords = blockList('keywords') ?? [];
  const patterns = blockList('patterns') ?? [];
  if (keywords.length === 0 && patterns.length === 0) errors.push('activation.mode=keyword needs at least one keyword or pattern');
  for (const pattern of patterns) {
    try { new RegExp(pattern, 'iu'); } catch (error) { errors.push('activation pattern "' + pattern + '" is not a valid regex: ' + error.message); }
  }
  // Pattern engagement is a conjunction of these two: without both, a collaboration phrase with
  // no agent in it ("两个同事同时改同一个文件") would engage again.
  for (const key of ['agent_anchors', 'coordination_acts']) {
    const list = inlineList(key);
    if (!list || list.length === 0) {
      errors.push('activation.' + key + ' must be a non-empty list (pattern engagement requires an agent subject AND an act of coordinating)');
    }
  }
  for (const key of ['comparison_words', 'collaboration_words']) {
    const list = inlineList(key);
    if (!list || list.length === 0) {
      errors.push('activation.comparison_veto.' + key + ' must be a non-empty list, or the veto silently never fires');
    }
  }
}

// --- intake gate: exactly the values the queue stores ---
valuesIn('execution_mode', EXECUTION_MODES);
valuesIn('security_scan', PLAN_CHOICES);
valuesIn('independent_verification', PLAN_CHOICES);
for (const key of ['execution_mode', 'security_scan', 'independent_verification']) {
  if (!new RegExp('^\\s+(?:-\\s+)?' + key + ':\\s*\\[', 'm').test(yaml)) errors.push('intake_gate.questions must cover ' + key);
}

// --- rigor: every engine level must be documented, and the default must be one of them ---
const rigorIds = [...yaml.matchAll(/^\s+- \{ id: (L\d)/gm)].map((m) => m[1]);
for (const id of rigorIds) {
  if (!RIGOR_LEVELS.includes(id)) errors.push('rigor.levels documents "' + id + '", which the engine does not accept (allowed: ' + RIGOR_LEVELS.join(', ') + ')');
}
for (const id of RIGOR_LEVELS) {
  if (!rigorIds.includes(id)) errors.push('rigor.levels must document every engine level; missing ' + id);
}
const defaultRigor = scalar('default', 'rigor');
if (defaultRigor && !RIGOR_LEVELS.includes(defaultRigor)) errors.push('rigor.default must be one of ' + RIGOR_LEVELS.join(', '));

// --- evidence: the engine's grades and the fields E1 actually requires ---
valuesIn('grading', EVIDENCE_GRADES);
valuesIn('e1_requires', E1_REQUIRED_FIELDS);

// --- queue, capabilities, stages ---
valuesIn('capabilities', CAPABILITIES);
valuesIn('stages', STAGES);
valuesIn('extra_states', ['blocked', 'recovery']);
const dispatchMode = scalar('dispatch_mode');
if (dispatchMode && dispatchMode !== 'dry_run') errors.push('queue.dispatch_mode must be dry_run (never auto-launch agents)');

// --- roster: declared agents must be defined, and must satisfy the engine ---
const rosterAgents = mappingKeys('agents');
if (rosterAgents === null || rosterAgents.length === 0) errors.push('roster.agents must declare at least one agent');
const roster = { agents: {} };
for (const agent of rosterAgents ?? []) {
  const line = lines.find((l) => new RegExp('^\\s+' + agent + ':\\s*\\{').test(l));
  if (!line) { errors.push('roster.agents declares "' + agent + '" but no entry defines it'); continue; }
  const scores = {};
  const scoreMatch = line.match(/scores:\s*\{([^}]*)\}/);
  if (scoreMatch) {
    for (const pair of scoreMatch[1].split(',')) {
      const parts = pair.split(':');
      const role = (parts[0] || '').trim();
      if (role) scores[role] = Number((parts[1] || '').trim());
    }
  }
  const specialties = line.match(/specialties:\s*\[([^\]]*)\]/);
  const cost = line.match(/cost:\s*(\d+)/);
  roster.agents[agent] = {
    scores,
    cost: cost ? Number(cost[1]) : undefined,
    specialties: specialties ? specialties[1].split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };
}
try {
  validateRoster(roster);
  for (const [agent, entry] of Object.entries(roster.agents)) {
    for (const role of Object.keys(entry.scores ?? {})) {
      if (!ROLES.includes(role)) errors.push('roster.' + agent + ' scores unknown role "' + role + '" (allowed: ' + ROLES.join(', ') + ')');
    }
  }
} catch (error) {
  errors.push('roster shape rejected by the engine: ' + error.message);
}

// --- invariants that must stay true ---
requireMatch(/^minimum_agents_for_auto_routing:\s*([3-9]|[1-9][0-9]+)\s*$/m, 'minimum_agents_for_auto_routing must be >= 3');
requireMatch(/^\s+one_primary_writer_per_resource:\s*true\s*$/m, 'single-writer ownership must be true');
requireMatch(/^\s+independent:\s*true\s*$/m, 'the verifier role must be marked independent: true');
requireMatch(/^\s+require_explicit_user_confirmation:\s*true\s*$/m, 'external actions must require explicit confirmation');
requireMatch(/^\s+verification_does_not_authorize_shipping:\s*true\s*$/m, 'approval must state that verification does not authorize shipping');
requireMatch(/^\s+require_grade_label:\s*true\s*$/m, 'evidence.require_grade_label must be true');
requireMatch(/^\s+verifier_selection:\s*capability_score\s*$/m, 'verification_gate.verifier_selection must be capability_score');
requireMatch(/^\s+implementer_excluded:\s*true\s*$/m, 'verification_gate.implementer_excluded must be true');
requireMatch(/^\s+unscored_verifier:\s*fail_closed\s*$/m, 'verification_gate.unscored_verifier must be fail_closed');
requireMatch(/^\s+on_failure:\s*return_to_implement\s*$/m, 'verification_gate.on_failure must be return_to_implement');
requireMatch(/^\s+override_requires:\s*\[[^\]]*approvedBy[^\]]*scope[^\]]*reason[^\]]*\]\s*$/m, 'verification_gate.override_requires must list approvedBy, scope and reason');
requireMatch(/^\s+override_keeps_failure_record:\s*true\s*$/m, 'verification_gate.override_keeps_failure_record must be true');
requireMatch(/^\s+record_outranks_queue:\s*true\s*$/m, 'handoff.record_outranks_queue must be true');
requireMatch(/^\s+blocked_after_rounds:\s*3\s*$/m, 'handoff.blocked_after_rounds must be 3');
requireMatch(/^\s+files:\s*\[[^\]]*CURRENT-TASK\.md[^\]]*\]\s*$/m, 'handoff.files must include CURRENT-TASK.md');

// --- shipped files and engine sanity ---
for (const path of ['SKILL.md', 'README.md']) {
  if (!fs.existsSync(path)) errors.push('missing shipped file: ' + path);
}
if (Object.keys(DEFAULT_ROSTER.agents).length < 3) errors.push('the engine default roster must hold at least three agents');
if (TYPES.length === 0) errors.push('the engine must declare task types');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('valid orchestration config (checked against the engine enums): ' + file);
