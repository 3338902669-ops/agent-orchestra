import fs from 'node:fs';
import process from 'node:process';

// Validate the safety invariants of the orchestration config.
//
// Checks run against the file with comments and blank lines stripped, using
// line-anchored patterns, and duplicate keys are rejected first. Checking the raw
// text (includes()/unanchored regex) let a comment or a shadowed duplicate key
// satisfy a gate that is presented as enforcing the invariant.
const file = process.argv[2] || 'config/agents.example.yaml';
const text = fs.readFileSync(file, 'utf8');
const errors = [];

const seen = new Map();
const body = [];
text.split(/\r?\n/).forEach((raw, index) => {
  const line = raw.replace(/(^|\s)#.*$/, '');
  if (!line.trim()) return;
  const key = line.match(/^(\s*)([A-Za-z_][\w.-]*):(?:\s|$)/);
  if (key) {
    const path = key[1].length + ':' + key[2];
    if (seen.has(path)) {
      errors.push(`duplicate key "${key[2]}" at line ${index + 1} (first seen at line ${seen.get(path)})`);
    } else {
      seen.set(path, index + 1);
    }
  }
  body.push(line);
});
const yaml = body.join('\n');

const section = (name) => new RegExp('^' + name + ':', 'm').test(yaml);
for (const name of ['activation', 'intake_gate', 'risk', 'roles', 'ownership', 'roster', 'handoff', 'queue', 'approval', 'verification_gate', 'evidence', 'cost']) {
  if (!section(name)) errors.push('missing section: ' + name);
}
const require = (pattern, message) => { if (!pattern.test(yaml)) errors.push(message); };

require(/^minimum_agents_for_auto_routing:\s*([3-9]|[1-9][0-9]+)\s*$/m, 'minimum_agents_for_auto_routing must be >= 3');
require(/^\s+mode:\s*(global|keyword|manual)\s*$/m, 'activation.mode must be global, keyword, or manual');
if (/^\s+mode:\s*keyword\s*$/m.test(yaml)) {
  require(/^\s+keywords:\s*$/m, 'activation.mode=keyword requires a keywords list');
}
require(/^\s+one_primary_writer_per_resource:\s*true\s*$/m, 'single-writer ownership must be true');
require(/^\s+independent:\s*true\s*$/m, 'the verifier role must be marked independent: true');
require(/^\s+require_explicit_user_confirmation:\s*true\s*$/m, 'external actions must require explicit confirmation');
require(/^\s+verification_does_not_authorize_shipping:\s*true\s*$/m, 'approval must state that verification does not authorize shipping');
require(/^\s+dispatch_mode:\s*dry_run\s*$/m, 'queue.dispatch_mode must be dry_run (never auto-launch agents)');
require(/^\s+require_grade_label:\s*true\s*$/m, 'evidence.require_grade_label must be true');
require(/^\s+stages:\s*\[[^\]]*\btriage\b[^\]]*\]\s*$/m, 'queue.stages must include triage (environment tasks pass through it)');
require(/^\s+required_for:\s*\[\s*important\s*,\s*critical\s*\]\s*$/m, 'intake_gate.required_for must cover important and critical');
// The roster is data of any size; it must actually declare agents.
require(/^roster:\s*$/m, 'missing section: roster');
require(/^\s+agents:\s*$/m, 'roster.agents is required');
// The verification gate is the point of the mechanism: enforce the policy, not just its presence.
require(/^\s+verifier_selection:\s*capability_score\s*$/m, 'verification_gate.verifier_selection must be capability_score');
require(/^\s+implementer_excluded:\s*true\s*$/m, 'verification_gate.implementer_excluded must be true');
require(/^\s+unscored_verifier:\s*fail_closed\s*$/m, 'verification_gate.unscored_verifier must be fail_closed');
require(/^\s+on_failure:\s*return_to_implement\s*$/m, 'verification_gate.on_failure must be return_to_implement');
require(/^\s+blocked_effects:\s*\[[^\]]*complete_to_done[^\]]*\]\s*$/m, 'verification_gate.blocked_effects must include complete_to_done');
require(/^\s+blocked_effects:\s*\[[^\]]*dispatch_to_evidence[^\]]*\]\s*$/m, 'verification_gate.blocked_effects must include dispatch_to_evidence');
require(/^\s+override_requires:\s*\[[^\]]*approvedBy[^\]]*scope[^\]]*reason[^\]]*\]\s*$/m, 'verification_gate.override_requires must list approvedBy, scope and reason');
require(/^\s+override_keeps_failure_record:\s*true\s*$/m, 'verification_gate.override_keeps_failure_record must be true');
require(/^\s+override_is_not_evidence:\s*true\s*$/m, 'verification_gate.override_is_not_evidence must be true');
// The handoff record is what survives a change of agent, session or tool.
require(/^\s+record_outranks_queue:\s*true\s*$/m, 'handoff.record_outranks_queue must be true');
require(/^\s+blocked_after_rounds:\s*3\s*$/m, 'handoff.blocked_after_rounds must be 3');
require(/^\s+files:\s*\[[^\]]*CURRENT-TASK\.md[^\]]*\]\s*$/m, 'handoff.files must include CURRENT-TASK.md');
require(/^\s+iron_rules:\s*$/m, 'handoff.iron_rules is required');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('valid orchestration config: ' + file);
