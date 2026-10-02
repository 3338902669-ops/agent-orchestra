#!/usr/bin/env node
/**
 * rebuild-skill-catalog.mjs - scan skill directories and write the catalogue the router reads.
 *
 *   node rebuild-skill-catalog.mjs --source mine=~/.claude/skills --source team=./team-skills
 *   node rebuild-skill-catalog.mjs --config skill-catalog.config.json
 *   node rebuild-skill-catalog.mjs --config ... --out ./generated
 *
 * Nothing here is hard-coded to a machine: every source directory, the output location, the
 * category labels and the per-skill category/keyword map are supplied by you. Run it, commit the
 * catalogue if you want one, or regenerate it on demand.
 *
 * Config file shape (all keys optional):
 *
 *   {
 *     "sources":    { "mine": "~/.claude/skills", "team": "./team-skills" },
 *     "out":        ".",
 *     "categories": { "coding": "Coding and debugging", "writing": "Writing" },
 *     "map":        "./category-map.mjs"
 *   }
 *
 * Zero dependencies. Node 18+.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_CATEGORIES = {
  coding: 'Coding and debugging',
  testing: 'Testing and verification',
  docs: 'Documents and writing',
  research: 'Research and browsing',
  workflow: 'Coordination and workflow',
  memory: 'Memory and context',
};

export function expandHome(p) {
  if (!p) return p;
  const s = String(p);
  if (s === '~') return homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) return join(homedir(), s.slice(2));
  return isAbsolute(s) ? s : resolve(s);
}

/**
 * Parse SKILL.md frontmatter.
 *
 * The block-scalar branch is the whole reason this function has a paragraph. A naive
 * line-by-line `key: value` regex reads `description: >-` and stores the indicator itself, so
 * every skill written with the recommended multi-line form gets a description of ">-" - and,
 * worse, any indented line inside that block containing a colon is read as a NEW key, letting
 * prose leak into the metadata. Both defects were observed on a real catalogue: 14 entries had
 * a description of ">-", ">", or "|".
 *
 * Handles `>`, `>-`, `|`, `|-`: folded styles join continuation lines with a space, literal
 * styles keep newlines, and a trailing `-` strips the final newline.
 */
export function parseFrontmatter(text) {
  const clean = String(text).replace(/\r\n/g, '\n');
  if (!clean.startsWith('---')) return null;
  const end = clean.indexOf('\n---', 3);
  if (end < 0) return null;
  const lines = clean.slice(3, end).split('\n');
  const out = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue; // indented continuation: consumed by the block branch, never its own key
    const key = m[1];
    const raw = m[2].trim();
    const block = raw.match(/^([>|])([+-]?)\d*$/);
    if (!block) {
      out[key] = raw.replace(/^["']|["']$/g, '').trim();
      continue;
    }
    const folded = block[1] === '>';
    const collected = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const next = lines[j];
      if (next.trim() === '') { collected.push(''); continue; }
      if (!/^\s/.test(next)) break; // a flush-left line ends the block
      collected.push(next.replace(/^\s+/, ''));
    }
    i = j - 1;
    while (collected.length && collected[collected.length - 1] === '') collected.pop();
    let value = folded ? collected.join(' ').replace(/\s+/g, ' ').trim() : collected.join('\n');
    if (block[2] === '-') value = value.replace(/\n+$/, '');
    out[key] = value;
  }
  return out;
}

export function buildCatalog({ sources, categories = DEFAULT_CATEGORIES, meta = {} }) {
  const all = {};
  for (const [source, rawDir] of Object.entries(sources)) {
    const dir = expandHome(rawDir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true }).filter((i) => i.isDirectory())) {
      const skillFile = join(dir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const fm = parseFrontmatter(readFileSync(skillFile, 'utf8')) || {};
      const name = fm.name || entry.name;
      if (!all[name]) all[name] = { name, locations: [], description: '', whenToUse: '' };
      all[name].locations.push({ source, dir: entry.name });
      if (!all[name].description && fm.description) all[name].description = fm.description;
      if (!all[name].whenToUse && fm.whenToUse) all[name].whenToUse = fm.whenToUse;
    }
  }
  const skills = Object.keys(all).sort().map((name) => {
    const entry = meta[name];
    return {
      name,
      category: entry ? entry[0] : 'unmapped',
      keywords: entry ? entry[1] : [],
      description: (all[name].description || '').replace(/\s+/g, ' ').slice(0, 500),
      whenToUse: (all[name].whenToUse || '').replace(/\s+/g, ' ').slice(0, 300),
      locations: all[name].locations,
    };
  });
  return { categories, total: skills.length, skills };
}

export function renderMarkdown(catalog) {
  const lines = ['# Skill catalogue', ''];
  const byCat = new Map();
  for (const s of catalog.skills) {
    if (!byCat.has(s.category)) byCat.set(s.category, []);
    byCat.get(s.category).push(s);
  }
  for (const [cat, label] of Object.entries(catalog.categories)) {
    const list = byCat.get(cat) || [];
    lines.push('## ' + cat + ' - ' + label + ' (' + list.length + ')', '');
    lines.push('| Skill | Keywords | About |', '|---|---|---|');
    for (const s of list) {
      const desc = s.description.length > 90 ? s.description.slice(0, 90) + '...' : s.description;
      lines.push('| `' + s.name + '` | ' + (s.keywords || []).slice(0, 6).join(', ') + ' | ' + desc + ' |');
    }
    lines.push('');
  }
  // Uncategorised skills get their own section. A table headed "N skills" that lists only the
  // mapped ones states a number it does not honour.
  const unmapped = byCat.get('unmapped') || [];
  if (unmapped.length) {
    lines.push('## unmapped (' + unmapped.length + ')', '');
    lines.push('| Skill | About |', '|---|---|');
    for (const s of unmapped) {
      const desc = s.description.length > 90 ? s.description.slice(0, 90) + '...' : s.description;
      lines.push('| `' + s.name + '` | ' + desc + ' |');
    }
    lines.push('');
  }
  lines.unshift('> ' + catalog.total + ' skills: ' +
    (catalog.total - unmapped.length) + ' categorised, ' + unmapped.length + ' uncategorised.', '');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const sources = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--source' && args[i + 1]) {
      const [name, ...rest] = args[i + 1].split('=');
      if (name && rest.length) sources[name] = rest.join('=');
    }
  }
  let categories = DEFAULT_CATEGORIES;
  let meta = {};
  let out = resolve(flag('--out') || '.');

  const configPath = flag('--config');
  if (configPath) {
    const cfg = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
    Object.assign(sources, cfg.sources || {});
    if (cfg.categories) categories = cfg.categories;
    if (cfg.out) out = resolve(cfg.out);
    if (cfg.map) {
      const mapPath = resolve(cfg.map);
      if (existsSync(mapPath)) {
        const mod = await import(pathToFileURL(mapPath).href);
        meta = mod.META || {};
        if (mod.CATEGORIES) categories = mod.CATEGORIES;
      }
    }
  }
  const mapFlag = flag('--map');
  if (mapFlag && existsSync(resolve(mapFlag))) {
    const mod = await import(pathToFileURL(resolve(mapFlag)).href);
    meta = mod.META || {};
    if (mod.CATEGORIES) categories = mod.CATEGORIES;
  }

  if (!Object.keys(sources).length) {
    console.error('No sources given. Use --source <name>=<dir> (repeatable) or --config <file>.');
    console.error('See the header of this file for the config shape.');
    process.exit(2);
  }

  const catalog = buildCatalog({ sources, categories, meta });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'skills-catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');
  writeFileSync(join(out, 'SKILL-CATALOG.md'), renderMarkdown(catalog), 'utf8');
  const unmapped = catalog.skills.filter((s) => s.category === 'unmapped').length;
  console.log('wrote ' + catalog.total + ' skills to ' + out);
  console.log('  categorised: ' + (catalog.total - unmapped) + '   uncategorised: ' + unmapped);
  if (unmapped) console.log('  tip: add entries to your category map to classify the uncategorised ones.');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
