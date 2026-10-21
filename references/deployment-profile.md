# Deployment profile — Morphos team (live record, as of 2026-10-21)

The concrete instantiation behind SKILL.md's "Deployment profile" section: one user's
team of eight seats across a cloud VM and one Windows machine. Paths are the box's
(`C:\Users\33389\...`) unless marked cloud. This file is a living record; update it
when a channel, seat or mechanism changes, and re-probe after any change.

## Seats

| Seat id | Agent | Pinned duty |
|---|---|---|
| `zaodianshui` | cloud coordinator (Muse) | the user's only contact point; dispatch, batching of gated decisions, in-loop supervision of in-flight cross-agent work |
| `codex` | OpenAI Codex (standalone) | implementation: web, code, local files, deploys |
| `dsh` | DeepSeek Harness (standalone) | local lead: outreach-radar watch, scheduled guardianship, system watch; **single writer** of the shared record |
| `tianshu` | tianshu-tui (rivet) | **verification only** — never implements what it verifies |
| `xiaoyu` | Grok Bot principal | coordinator of the Grok Bot line; owns the site-check continuation line |
| `yunying` | Grok Bot native | MOSI content operations |
| `jiaoxue` | Grok Bot native | teaching line; speaks when addressed |
| `openclaw` | retired platform | workspace and skills library host only; not an agent |

Three further personas appear in the team group chat: they are codex, dsh and
tianshu mirrored inside Grok Bot, not separate agents.

## Channel matrix (all pairs PONG-verified 2026-10-21; protocol: box `.shared\muse-bridge\LINK-PROTOCOL.md` v2)

- **cloud → codex**: SSH `codex exec --skip-git-repo-check "<prompt>"` (~20 s/round).
  The command must run as a CRLF `.cmd` with stdin from NUL or it hangs waiting for
  stdin. `codex exec resume <session_id>` continues with full memory. Model:
  deepseek-flash (switched back 2026-10-21 00:59 after a relay-balance 403).
- **cloud → dsh**: questions via SSH `dsh --profile headless "<prompt>"` (~13 s).
  Command execution goes **only** through the `MuseDshRun` bridge: a scheduled
  task running with an interactive token; request file `.shared\muse-bridge\dsh-req.txt`
  (line 1 TAG, line 2 CWD — default `.dsh\work` — rest is the prompt), result in
  `dsh-res.txt`. Root cause, found the hard way: dsh's ACL sandbox refuses when
  TEMP resolves inside the workspace, and restricted tokens must be created in
  the interactive session — SSH plus a home-directory cwd always fails. Long
  prompts travel as base64 `powershell -EncodedCommand` (UTF-16LE).
- **cloud → tianshu**: SSH `rivet -p` (tianshu-tui v3.17.0, ~15 s round trip).
  Every dispatch carries a task card: seat address, object path, sha16,
  requirement verbatim, acceptance invariants. Wording work is verified
  character-for-character.
- **anyone → Grok Bot seats**: write UTF-8 text to `.shared\muse-bridge\wake-msg.txt`,
  then run the scheduled task `MuseWakeGrok`: it activates the Grok Bot main
  window in the desktop session, verifies the foreground title, and pastes.
  Log: `wake-log.txt`. Grok Bot has no listening port and no CLI; the desktop
  session is unreachable from SSH sessions, which is why the wake task exists.
- **Fallback**: file inbox/outbox (`.shared\cloud-inbox`, `.shared\cloud-outbox`);
  a cloud cron polls the outbox every 15 minutes. Slower, but it has never
  failed when everything else did.
- Pairwise directions codex→dsh, codex→tianshu, codex→xiaoyu, xiaoyu→dsh,
  xiaoyu→tianshu, xiaoyu→codex, dsh→codex (via bridge), dsh→tianshu (via
  bridge) were each probe-verified, not inferred from the reverse direction.

## Transport

All cloud↔box traffic rides Tailscale: box `yffffff` at 100.96.4.48, cloud VM
joined as device `muse`, TCP through the runtime proxy (port 3130) or the
`ssh-yf` wrapper. Read-only pull service `muse-pull` on the box (port 18080,
six whitelisted files, tailnet + loopback only).

**Lesson, 2026-10-21**: for ~3.5 hours every port returned empty replies while
`tailscale status` reported Connected and the box showed a green dot in the
admin console. The cloud VM's data plane was wedged; the box was never down.
Fix: `tailscale down` / `up` on the cloud side and a fresh owner approval of
the rejoined device. Rule: "Connected" plus a green dot is not reachability —
only a TCP probe through the tunnel is.

## Shared record and rules

- Live record: box `.shared\CURRENT-TASK.md`, `.shared\TASK-STATE.md` (single
  writer: dsh). Cloud mirrors what it needs under `~/workspace/team-memory/`.
- Rules: fragments in `.shared\rules\` (`index.json`, fragments, `sync-rules.mjs`,
  backups). The team fragment is **cloud-commons**: v1 (2026-10-21 01:36,
  commons + memory digests) → v2 (member onboarding via JOIN-PROTOCOL, graph
  memory layer) → v3 (internal communication form). Each version is synced into
  codex / dsh / grokbot / openclaw AGENTS.md and verified per member after
  sync. codex's AGENTS.md did not exist before v1; the distribution created it
  and backfilled all eight fragments.
- Onboarding: `.shared\JOIN-PROTOCOL.md` (JOIN in six steps, REPLACE, LEAVE);
  credentials never travel through the onboarding flow. Manifest:
  `.shared\TEAM-MANIFEST.json`. Roster (fact source): `.shared\agent-orchestrator\roster.json`;
  human-readable: `.shared\TEAM-ROSTER.md`. Memory digests: `.shared\memory-digests\`
  per seat; cloud index `~/workspace/team-memory/INDEX.md`.
- Task inventory: `TASK-REGISTRY-20261021.md` (cloud + box mirror) — ~85 box
  scheduled tasks by domain plus the cloud cron lines.

## Graph memory

- Service on the box: `.shared\graph-memory\`, FastAPI on port 8642 (`/health`,
  `/episodes`, `/search`, `/stats`), allowlist 127.0.0.0/8 + 100.64.0.0/10 only.
  Supervisor scheduled task `MuseGraphMemory`. Backend Neo4j Community
  5.26.3 (portable JRE 21), task `MuseNeo4j`, bound to 127.0.0.1:7687 only.
  The external group id `team` maps to the single internal group `neo4j`
  (Community is one-database). Extraction LLM: deepseek-v4-flash. Embeddings:
  local paraphrase-multilingual-MiniLM-L12-v2 (384-dim). Secrets live only in
  the box's `service.env` — never in chat, memory files or this profile.
- Corpus at 2026-10-21: **203 episodes / 1193 entities / 2257 facts** (box
  corpus 159 + cloud MEMORY 40 + pilot 2). Retrieval smoke test 8/8, including
  a supersession proof: the fact recording codex's previous model carries an
  `invalid_at` of exactly the 2026-10-21 00:59 switch back to deepseek-flash.
- The Kuzu backend was evaluated first and removed after three failed trials;
  the swap happened before any consumer used the service, so no data moved.
- Red line: private per-agent memory is never bulk-copied into the shared
  graph — one seat's home directory holds credential files. Digests and
  coordinator-selected episodes only.

## Skills library

Central library on the box: `.openclaw\skills`, junctioned into the codex, dsh,
grokbot and workspace skill paths (four-way counts verified equal).
Classification pass, 2026-10-21: 232 directories → A core 47 / B useful 87 /
C duplicate 50 / D unused-for-now 46 / X broken 2. With the owner's approval
the 98 C/D/X directories were moved — not deleted — to
`.openclaw\skills-quarantine-20261021\`; the catalogue was rebuilt at 134.
A-class SKILL.md files were read in full by the coordinator (17 key files).

## Operating precedents (recorded, binding on this deployment)

- A passed gate is not a delivery. Sends, publishes, deletes, deploys,
  payments and account changes wait for the user's per-item nod; a blanket
  authorization does not cover them (precedent set and confirmed 2026-10-20,
  applied again 2026-10-21).
- No number is reported without a source; a failure is reported as a failure.
- Cross-agent claims carry evidence anchors (source path, sha16, raw command
  output). No artifact, no conclusion.
- The coordinator reports in two columns: done / blocked-needs-a-decision.
- User-facing deliverables are PDFs; markdown is an inter-agent format.
