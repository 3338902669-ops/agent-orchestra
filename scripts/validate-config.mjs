import fs from 'node:fs';
import process from 'node:process';
const file = process.argv[2] || 'config/agents.example.yaml';
const text = fs.readFileSync(file, 'utf8');
const errors = [];
for (const section of ['minimum_agents_for_auto_routing', 'risk:', 'roles:', 'ownership:', 'approval:', 'cost:']) if (!text.includes(section)) errors.push('missing section: ' + section);
if (!/minimum_agents_for_auto_routing:\s*([3-9]|[1-9][0-9]+)/.test(text)) errors.push('minimum_agents_for_auto_routing must be >= 3');
if (!/one_primary_writer_per_resource:\s*true/.test(text)) errors.push('single-writer ownership must be true');
if (!/require_explicit_user_confirmation:\s*true/.test(text)) errors.push('external actions must require explicit confirmation');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('valid orchestration config: ' + file);
