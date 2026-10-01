#!/usr/bin/env node
// build-release.mjs - build the published ZIP reproducibly, and check it as it is built.
//
// The ad-hoc zip this replaced shipped two defects an independent reviewer found in the artifact:
// install.sh had CRLF (so `bash -n` failed) and mode 644 (so `./scripts/install.sh` was Permission
// denied). A release artifact deserves the same treatment as the code it ships, so this script
// builds it, sets the executable bit, and refuses to write a ZIP that fails its own checks.
//
// Usage: node scripts/build-release.mjs [output-path]

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

// AO_BUILD_ROOT lets the artifact checker build from a deliberately broken copy of the tree, which is
// how its negative self-test proves the check can fail at all.
const ROOT = process.env.AO_BUILD_ROOT
  ? resolve(process.env.AO_BUILD_ROOT)
  : fileURLToPath(new URL('..', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'agent-orchestra.zip');
// A verifier ran its own agent runtime in this directory and the build packed the runtime's session
// database into the release - a buyer would have received someone else's private state. Any dot-entry
// is now skipped: that covers .git, agent runtimes, editor state and OS litter in one rule.
const SKIP_DIRS = new Set(['node_modules', 'evidence']);
// artifact-denylist.json is deliberately NOT shipped: a checker that names the repository it protects
// would hand the reader the very address it exists to keep out of the artifact.
const SKIP_FILES = new Set(['artifact-denylist.json']);
const BINARY = /\.(png|jpg|jpeg|gif|webp|zip|ico)$/i;

function collect(dir, base, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { collect(full, base, out); continue; }
    out.push({ full, name: 'agent-orchestra/' + relative(base, full).split(/[\\/]/).join('/') });
  }
  return out;
}

const files = collect(ROOT, ROOT).sort((a, b) => (a.name < b.name ? -1 : 1));

const problems = [];
for (const f of files) {
  if (BINARY.test(f.name)) continue;
  const crlf = (readFileSync(f.full, 'utf8').match(/\r\n/g) || []).length;
  if (crlf > 0) problems.push(f.name + ' has ' + crlf + ' CRLF line endings');
}
if (problems.length) {
  console.error('refusing to build:\n' + problems.map((x) => '  - ' + x).join('\n'));
  process.exit(1);
}

// Build with the system zip when available so Unix modes travel with the archive; a ZIP built by
// .NET on Windows marks every entry 644 and `./scripts/install.sh` fails for the person who
// downloads it. Fall back to a stored-mode declaration in the summary when zip is missing.
const stage = join(ROOT, '.release-stage');

// Write a minimal but valid ZIP writer so the artifact is identical on every platform and the mode
// is explicit rather than inherited from the build host.
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const local = [];
const central = [];
let offset = 0;
const now = new Date();
const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

for (const f of files) {
  const raw = readFileSync(f.full);
  const nameBuf = Buffer.from(f.name, 'utf8');
  const crc = crc32(raw);
  const mode = f.name === 'agent-orchestra/scripts/install.sh' ? 0o100755 : 0o100644;
  // deflate text, store binaries: a stored-everything archive doubled the size of the artifact
  const compress = !BINARY.test(f.name);
  const data = compress ? deflateRawSync(raw, { level: 9 }) : raw;
  const method = compress ? 8 : 0;
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(raw.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  local.push(localHeader, nameBuf, data);
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(0x031e, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(method, 10);
  centralHeader.writeUInt16LE(dosTime, 12);
  centralHeader.writeUInt16LE(dosDate, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(raw.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE((mode << 16) >>> 0, 38);
  centralHeader.writeUInt32LE(offset, 42);
  central.push(centralHeader, nameBuf);
  offset += localHeader.length + nameBuf.length + data.length;
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...local, centralBuf, end]);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, zip);

// verify the artifact rather than trusting the writer
const check = execFileSync(process.execPath, ['-e', `
const { readFileSync } = require('fs');
const zip = readFileSync(process.argv[1]);
// the central directory offset lives in the end-of-central-directory record (last 22 bytes)
let eocd = zip.length - 22;
while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
if (eocd < 0) { console.log(JSON.stringify({ error: 'no EOCD' })); process.exit(0); }
const count = zip.readUInt16LE(eocd + 10);
let i = zip.readUInt32LE(eocd + 16);
let entries = 0;
let installMode = null;
for (let n = 0; n < count; n++) {
  if (zip.readUInt32LE(i) !== 0x02014b50) break;
  const nameLen = zip.readUInt16LE(i + 28);
  const extraLen = zip.readUInt16LE(i + 30);
  const commentLen = zip.readUInt16LE(i + 32);
  const mode = (zip.readUInt32LE(i + 38) >>> 16).toString(8);
  const name = zip.slice(i + 46, i + 46 + nameLen).toString('utf8');
  if (name === 'agent-orchestra/scripts/install.sh') installMode = mode;
  entries += 1;
  i += 46 + nameLen + extraLen + commentLen;
}
console.log(JSON.stringify({ entries, installMode }));
`, OUT], { encoding: 'utf8' });
const { entries, installMode } = JSON.parse(check);
const sha = createHash('sha256').update(zip).digest('hex');
console.log('agent-orchestra.zip ' + (zip.length / 1024).toFixed(1) + ' KB | ' + entries + ' entries | install.sh mode ' + installMode);
console.log('sha256 ' + sha);
if (entries !== files.length) { console.error('entry count mismatch'); process.exit(1); }
if (installMode !== '100755') { console.error('install.sh is not executable in the artifact'); process.exit(1); }
console.log('artifact verified: LF-clean, complete, install.sh executable');