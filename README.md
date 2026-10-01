# Agent Orchestra

One portable, capability-first protocol for multi-agent work along **two axes**: coordinating a team inside one batch of tasks, and handing that work across sessions, tools and days without losing state. It ships explicit ownership, independent verification, graded evidence, deterministic dispatch, a shared handoff record and token-aware routing.

<p align="center"><img src="og-image.png" alt="Agent Orchestra" width="600"></p>

## What's in this repository

| Path | What it is | Read it when |
|---|---|---|
| `SKILL.md` (root) | The protocol: roles, ownership, verification gate, handoff record, queue, evidence, cost | you want the short form |
| `references/handoff.md` | Handoff discipline: the four shared records, the five iron rules, the task state machine, single-writer conflicts, memory sync, the cross-tool checklist | work is relayed across sessions or tools |
| `references/` | Detail: routing-and-roles, evidence-grading, task-queue, important-task-intake, protocol, anti-patterns, token-efficiency | you need the full rule, not the summary |
| `config/agents.example.yaml` | Activation, risk, roles, ownership, intake gate, roster, queue, verification gate, approval, evidence, cost | you are wiring the skill to your agents |
| `scripts/detect-trigger.mjs` | Keyword activation detector (exit 0 engaged / 1 not engaged) | keyword activation mode |
| `scripts/orchestrator/` | Task queue CLI + library + tests (zero dependencies, Node 18+) | you want deterministic dispatch and claim locks |
| `scripts/install.ps1`, `scripts/install.sh` | One-click installers that copy this single skill into a detected skills directory | first install |

## Features

- covers both axes in one skill: in-task coordination, and handoff across sessions and tools
- keeps a human-readable shared record - handoff entry, rules, memory snapshot, role table - as the authority when the queue and intent disagree
- five iron rules with executable checks: read before acting, resume instead of redoing, write progress down, hand off before switching, completion carries graded evidence
- a task state machine - `queued` / `in-progress` / `handoff-wait` / `done`, plus `blocked` only after three unresolved rounds - mapped to the queue's stage machine
- discovers capabilities instead of assuming an agent's name implies a role
- assigns coordinator, implementer, verifier, environment and domain roles by capability score
- enforces one primary writer per file or resource, with reviewers limited to isolated artifacts
- requires a verifier that is not the implementer: an author's self-check is never a verification result
- picks that verifier by **capability score from your roster**, excluding the implementer, and fails closed when nobody is scored for verification
- works with **any roster size and any agent names**: 3 agents, 8 or 12; routing comes from roster data, so adding an agent is a data edit, not a code change
- enforces a **verification gate**: a failed verify sends the task back to implement and it can neither reach done nor be dispatched to evidence until a verify passes or a human records an override with approver, scope and reason
- grades every claim E1 (reproducible) through E4 (planned), so self-assertion cannot pose as evidence
- asks the user three questions before an important task starts (solo vs collaborative, security scan, independent verification) and never defaults them
- adds a stronger pipeline for important and critical work: independent verification, domain review, and explicit approval for external actions
- runs a deterministic queue: `specify -> implement -> verify -> evidence -> done`, claim locks, dry-run dispatch, per-scope `approve` for deploy/publish/send/upload/delete
- refuses to disguise an undispatchable task as success (non-zero exit code)
- reduces token and API cost with compact packets, bounded outputs, model tiering, parallel read-only checks, and escalation only where ambiguity lives

It does not provide an absolute guarantee; it makes failures visible, recoverable, and less likely.

## Activation (when to use)

The skill engages in one of three modes, configured under `activation:` in `config/agents.example.yaml`:

- **global** - engages for every task
- **keyword** - engages only when the task text matches configured keywords (default; token-saving)
- **manual** - engages only when the user explicitly invokes it

For keyword mode, run the trigger detector before starting:

    node scripts/detect-trigger.mjs --text "<task text>" --config config/agents.example.yaml

Exit code 0 means ENGAGED (use the skill); 1 means NOT_ENGAGED. Exclude keywords veto engagement even when a trigger matched.

## The seven non-negotiables

1. One primary writer per file or resource at a time.
2. Verifier != implementer - and the verifier is the best-suited eligible agent by capability score, never a fixed name.
3. The verification gate cannot be walked past: no `done` and no `evidence` dispatch after a failure until a verify passes or an override with approver, scope and reason is recorded.
4. Read before acting, resume instead of redoing, and write progress down before switching.
5. No completion claim without criterion-linked evidence.
6. Irreversible and external actions need separate, explicit user approval (`approve`), which passing verification does not grant.
7. The human-readable shared record outranks the queue.

## Roster (any size)

Roles are assigned from a **roster**, which is data, not code. Three agents work; so do five, eight or twelve, and the agents can be called anything at all - nothing depends on an agent being named `coordinator` or `verifier`:

```yaml
agents:
  planner: { cost: 2, specialties: [],       scores: { specify: 3, implement: 1, verify: 1, evidence: 3 } }
  builder: { cost: 4, specialties: [full],   scores: { specify: 1, implement: 3, verify: 1, evidence: 1 } }
  webhand: { cost: 5, specialties: [web],    scores: { specify: 1, implement: 2, verify: 1, evidence: 1 } }
  auditor: { cost: 6, specialties: [verify], scores: { specify: 1, implement: 1, verify: 3, evidence: 2 } }
  scribe:  { cost: 1, specialties: [],       scores: { specify: 1, implement: 1, verify: 0, evidence: 3 } }
routes:                      # optional: anything omitted is resolved by score
  specify: planner
  evidence: scribe
  implement: { build: builder, web: webhand }
```

- Scores are 0-3 per role. Selection is deterministic and reproducible: **highest score -> capability match in `specialties` -> lower `cost` -> agent id order**. Setting `available: false` parks an agent without deleting it.
- Stage owners come from `routes` when the roster names one, otherwise from the score. A roster that can fill no agent for a stage is rejected loudly, never routed by accident.
- Install a roster of your own with `orchestrator.mjs init --roster <file.json>`. Adding an agent is a data edit: declare it, score it, it joins selection.

Full rules: `references/routing-and-roles.md`.

## Verification gate

Verification is a gate run by **an agent from your own team, chosen for the job** - no external tool and no particular vendor is required:

- the verifier is the highest-scoring eligible agent for `verify`, and the implementer is never eligible; if nobody is scored above 0, the run fails closed instead of pretending;
- completing the `verify` stage is a PASS; `fail` records the failing criteria and sends the task back to `implement`, and the verifier never fixes the work itself;
- the gate blocks two things: reaching `done` from `evidence`, and being dispatched to `evidence` at all;
- a human may override deliberately with `override --by <who> --scope <what> --reason <why>` - all three are required, and the failed result is kept beside the override rather than erased;
- a passed verification is not a shipping authorization.

Full rules: `references/task-queue.md`.

## Handoff record

When the work moves - another session, another tool, another day - the state moves through a shared record, not through chat history:

| File | Holds | Updated |
|---|---|---|
| `CURRENT-TASK.md` | the live handoff entry: status, owner, progress, next step, evidence | on every substantial step |
| `HANDOFF-RULES.md` | the team's rules of engagement | when rules change |
| `MEMORY-SNAPSHOT.md` | shared decisions, preferences, lessons | periodically / on big decisions |
| `AGENT-ROLES.md` | who can do what | when the roster changes |

The five iron rules, in order: **read before acting**, **resume instead of redoing**, **write progress down**, **hand off before switching**, **completion carries graded evidence**. A task waiting to be picked up is `handoff-wait`; a task stuck on a condition names that condition and is marked `blocked` only after three rounds.

Detail, including the cross-tool checklist and the memory sync routine: `references/handoff.md`.

## Task queue

    node scripts/orchestrator/orchestrator.mjs init --roster my-team.json          # any roster size, any names
    node scripts/orchestrator/orchestrator.mjs create   --title "Fix checkout" --type build --workspace "<workspace>"
    node scripts/orchestrator/orchestrator.mjs claim    --task task-0001 --agent implementer-a
    node scripts/orchestrator/orchestrator.mjs complete --task task-0001 --agent implementer-a --evidence "tests pass, exit 0"
    node scripts/orchestrator/orchestrator.mjs dispatch --task task-0001
    node scripts/orchestrator/orchestrator.mjs fail     --task task-0001 --agent verifier-b --criteria "test X fails"
    node scripts/orchestrator/orchestrator.mjs override --task task-0001 --by user --scope "release 2.1" --reason "pre-existing flake"
    node scripts/orchestrator/orchestrator.mjs approve  --task task-0002 --by user --scope "deploy to production"
    node scripts/orchestrator/orchestrator.mjs status

`dispatch` prints a dry-run command; it never starts an agent. `fail` closes the verification gate; `override` is the only way past it and needs approver, scope and reason. Run the tests with:

    node --test scripts/orchestrator/lib.test.mjs

## Install

**One repository, one skill.** Copy the contents of this repository into the skill directory your host supports - `SKILL.md`, `references/`, `config/`, and `scripts/` if you want the queue. There is no companion package and no second skill to install.

Optionally, the one-click installers perform the same single-skill copy into common skill directories.

Windows PowerShell:

    powershell -ExecutionPolicy Bypass -File scripts/install.ps1

Linux/macOS shell:

    ./scripts/install.sh

Validate your config locally:

    node scripts/validate-config.mjs

## Host adapter

Implement these five primitives: `discover_agents`, `dispatch`, `lock`, `record`, and `approve`. If a primitive is unavailable, use a documented manual fallback and record the limitation.

## Usage

This is important. Three agents are available. Assign the best implementation agent, have another independently test it, and do not deploy.

Expected: capability inventory, role assignment, task packet, intake-gate answers, ownership lock, implementation evidence, independent verification with graded evidence, acceptance report, and `awaiting_user_approval` for deployment.

## Checking this repository

One command, and it is the same command CI runs:

```bash
node scripts/gate.mjs            # evidence lands in evidence/latest.json
node scripts/gate.mjs --no-self-test   # skip the gate's own failure test (not recommended)
```

The runner checks that the shipped config is usable by the engine, that activation engages on
intent and stays silent on lookalikes, that the queue engine and the CLI I/O behave, and that
no private path, secret or host-specific name ships. It writes a machine-readable record
bound to the git revision and to the SHA-256 of the key artifacts.

It also **proves it can fail**: before reporting PASS it injects known-bad configurations and
requires every one to be rejected. A gate that has quietly stopped checking anything therefore
fails instead of reporting green - see [`references/verification-standard.md`](references/verification-standard.md)
for the requirements it is held to, and [`KNOWN-FINDINGS.md`](KNOWN-FINDINGS.md) for accepted
defects and their review dates.

## License

MIT.
