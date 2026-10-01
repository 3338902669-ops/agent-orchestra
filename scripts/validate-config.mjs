import fs from 'node:fs';
import process from 'node:process';
const file = process.argv[2] || 'config/agents.example.yaml';
const text = fs.readFileSync(file, 'utf8');
const errors = [];
for (const section of ['minimum_agents_for_auto_routing', 'activation:', 'intake_gate:', 'risk:', 'roles:', 'ownership:', 'queue:', 'approval:', 'evidence:', 'cost:']) if (!text.includes(section)) errors.push('missing section: ' + section);
if (!/minimum_agents_for_auto_routing:\s*([3-9]|[1-9][0-9]+)/.test(text)) errors.push('minimum_agents_for_auto_routing must be >= 3');
if (!/one_primary_writer_per_resource:\s*true/.test(text)) errors.push('single-writer ownership must be true');
if (!/require_explicit_user_confirmation:\s*true/.test(text)) errors.push('external actions must require explicit confirmation');
if (!/activation:\s*$/.test(text) && !/activation:\s*[a-z]/.test(text)) errors.push('activation section is required');
if (!/mode:\s*(global|keyword|manual)/.test(text)) errors.push('activation.mode must be global, keyword, or manual');
if (/mode:\s*keyword/.test(text) && !/keywords:/.test(text)) errors.push('activation.mode=keyword requires a keywords list');
if (!/independent:\s*true/.test(text)) errors.push('the verifier role must be marked independent: true');
if (!/one_primary_writer_per_resource:\s*true/.test(text)) errors.push('single-writer ownership must stay true');
if (!/dispatch_mode:\s*dry_run/.test(text)) errors.push('queue.dispatch_mode must be dry_run (never auto-launch agents)');
if (!/verification_does_not_authorize_shipping:\s*true/.test(text)) errors.push('approval must state that verification does not authorize shipping');
if (!/require_grade_label:\s*true/.test(text)) errors.push('evidence.require_grade_label must be true');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('valid orchestration config: ' + file);