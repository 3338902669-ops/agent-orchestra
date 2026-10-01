#!/usr/bin/env node
// check-frontmatter.mjs - parse SKILL.md's YAML frontmatter instead of pattern-matching it.
//
// Why this file exists: the gate used to check /name:\s*\S+/ and /description:\s*\S+/ with a regex.
// A regex knows the KEYS are present; it cannot know the VALUE is valid YAML. A description written
// as a plain scalar with a colon inside it ("... rather than advice: one writer per resource")
// is a YAML error - GitHub rendered "mapping values are not allowed in this context" while the gate
// reported PASS. This parses the subset of YAML a frontmatter may use, and rejects the rest.
//
// Usage: node scripts/check-frontmatter.mjs [path-to-SKILL.md]

import { readFileSync } from 'node:fs';
import process from 'node:process';

const BLOCK = /^[>|][+-]?$/;

/** Parse the frontmatter block. Throws with a line number on anything YAML would reject. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) throw new Error('no frontmatter: the file must start with --- on its own line and close with ---');
  const lines = m[1].split(/\r?\n/);
  const data = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i += 1; continue; }
    if (/^\s/.test(line)) throw new Error(`line ${i + 1}: unexpected indentation at the top level`);
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!kv) throw new Error(`line ${i + 1}: expected "key: value", got ${JSON.stringify(line)}`);
    const key = kv[1];
    const rest = kv[2];
    if (Object.hasOwn(data, key)) throw new Error(`line ${i + 1}: duplicate key "${key}"`);
    const value = rest.trim();
    // block scalar: every following line must be indented, and the value is their join
    if (BLOCK.test(value)) {
      const folded = value.startsWith('>');
      const block = [];
      i += 1;
      while (i < lines.length && (/^\s/.test(lines[i]) || lines[i].trim() === '')) {
        block.push(lines[i]);
        i += 1;
      }
      while (block.length && block[block.length - 1].trim() === '') block.pop();
      if (block.length === 0) throw new Error(`key "${key}": a block scalar with no content`);
      const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
      const stripped = block.map((l) => l.slice(indent));
      data[key] = folded
        ? stripped.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ').trim()
        : stripped.join('\n').trim();
      continue;
    }
    // quoted scalar
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      data[key] = value.slice(1, -1);
      i += 1;
      continue;
    }
    // inline list
    if (value.startsWith('[')) {
      if (!value.endsWith(']')) throw new Error(`line ${i + 1}: unterminated inline list`);
      data[key] = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    // plain scalar: this is where the real bug lived. YAML reads ': ' inside a plain scalar as the
    // start of a nested mapping and refuses the document.
    if (/: /.test(value) || value.endsWith(':')) {
      throw new Error(
        `key \"${key}\": a plain scalar contains \": \" (line ${i + 1}). YAML reads that as a nested ` +
          'mapping and refuses the document - which is exactly what GitHub reported. Use a block ' +
          'scalar ("desc: >-" with an indented paragraph), or quote the value.',
      );
    }
    if (value === '') {
      // block list or nested map follows; collect "- item" entries
      const items = [];
      i += 1;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s+-\s+/, '')); i += 1; }
      data[key] = items;
      continue;
    }
    data[key] = value;
    i += 1;
  }
  return data;
}

/** The checks a skill's frontmatter has to pass to be loadable by a host. */
export function checkSkillFrontmatter(text) {
  const problems = [];
  let data = null;
  try { data = parseFrontmatter(text); }
  catch (e) { problems.push(e.message); return { ok: false, problems, data: null }; }
  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) problems.push('name is missing or empty');
  if (data.name && !/^[a-z0-9][a-z0-9-]*$/.test(data.name)) problems.push(`name \"${data.name}\" is not a lowercase slug`);
  if (!data.description || typeof data.description !== 'string' || data.description.trim().length < 40) {
    problems.push('description is missing, empty, or too short to route on');
  }
  return { ok: problems.length === 0, problems, data };
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-frontmatter.mjs');
if (isMain) {
  const path = process.argv[2] || 'SKILL.md';
  const result = checkSkillFrontmatter(readFileSync(path, 'utf8'));
  if (result.ok) {
    console.log(`frontmatter parses: name=${result.data.name} description=${result.data.description.length} chars`);
    process.exit(0);
  }
  console.error(result.problems.map((x) => '  - ' + x).join('\n'));
  process.exit(1);
}
