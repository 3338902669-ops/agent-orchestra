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
for (const name of ['activation', 'intake_gate', 'risk', 'roles', 'ownership', 'queue', 'approval', 'evidence', 'cost']) {
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

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('valid orchestration config: ' + file);
