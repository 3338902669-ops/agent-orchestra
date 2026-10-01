# Multi-Agent Orchestration Skill

A portable, capability-first protocol for coordinating three or more AI agents with explicit ownership, independent verification, graded evidence, deterministic dispatch, and token-aware routing.

<p align="center"><img src="og-image.png" alt="Multi-Agent Orchestration Skill" width="600"></p>

## What's in this repository

| Path | What it is | Install it when |
|---|---|---|
| `SKILL.md` (root) | Orchestration protocol: roles, ownership, verification, queue, evidence, cost | three or more agents must coordinate |
| `agent-team-handoff/SKILL.md` | Handoff discipline: shared task record, five rules, state machine, anti-patterns | work is relayed across sessions or tools |
| `references/` | Detail: routing-and-roles, evidence-grading, task-queue, important-task-intake, protocol, anti-patterns, token-efficiency | you need the full rule, not the summary |
| `config/agents.example.yaml` | Activation, risk, roles, ownership, intake gate, queue, approval, evidence, cost | you are wiring the skill to your agents |
| `scripts/detect-trigger.mjs` | Keyword activation detector (exit 0 engaged / 1 not engaged) | keyword activation mode |
| `scripts/orchestrator/` | Task queue CLI + library + tests (zero dependencies, Node 18+) | you want deterministic dispatch and claim locks |
| `scripts/install.ps1`, `scripts/install.sh` | One-click installers that auto-detect common skill directories | first install |

## Features

- discovers capabilities instead of assuming an agent's name implies a role
- assigns coordinator, implementer, verifier, environment, and domain roles by capability score
- enforces one primary writer per file or resource, with reviewers limited to isolated artifacts
- requires a verifier that is not the implementer: an author's self-check is never a verification result
- picks that verifier by **capability score from your roster**, excluding the implementer, and fails closed when nobody is scored for verification
- works with **any roster size and any agent names**: 3 agents, 8 agents or 12; routing comes from roster data, so adding an agent is a data edit, not a code change
- enforces a **verification gate**: a failed verify sends the task back to implement and it can neither reach done nor be dispatched to evidence until a verify passes or a human records an override with approver, scope and reason
- grades every claim E1 (reproducible) through E4 (planned), so self-assertion cannot pose as evidence
- asks the user three questions before an important task starts (solo vs collaborative, security scan, independent verification) and never defaults them
- adds a stronger pipeline for important and critical work: independent verification, domain review, and explicit approval for external actions
- runs a deterministic queue: `specify -> implement -> verify -> evidence -> done`, claim locks, dry-run dispatch, per-scope `approve` for deploy/publish/send/upload/delete
- refuses to disguise an undispatchable task as success (non-zero exit code)
- keeps a human-readable shared task record as the authority when the queue and intent disagree
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

## The six non-negotiables

1. One primary writer per file or resource at a time.
2. Verifier != implementer - and the verifier is the best-suited eligible agent by capability score, never a fixed name.
3. The verification gate cannot be walked past: no `done` and no `evidence` dispatch after a failure until a verify passes or an override with approver, scope and reason is recorded.
4. No completion claim without criterion-linked evidence.
5. Irreversible and external actions need separate, explicit user approval (`approve`), which passing verification does not grant.
6. The human-readable shared record outranks the queue.

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

Option A - one-click installer (auto-detects common skill dirs).

Windows PowerShell:

    powershell -ExecutionPolicy Bypass -File scripts/install.ps1

Linux/macOS shell:

    ./scripts/install.sh

Option B - clone and copy `SKILL.md`, `references/`, `config/` (and `scripts/` if you want the queue) into the skill directory your host supports. To install the handoff companion as its own skill, copy the `agent-team-handoff/` folder.

Validate your config locally:

    node scripts/validate-config.mjs

## Host adapter

Implement these five primitives: `discover_agents`, `dispatch`, `lock`, `record`, and `approve`. If a primitive is unavailable, use a documented manual fallback and record the limitation.

## Usage

This is important. Three agents are available. Assign the best implementation agent, have another independently test it, and do not deploy.

Expected: capability inventory, role assignment, task packet, intake-gate answers, ownership lock, implementation evidence, independent verification with graded evidence, acceptance report, and `awaiting_user_approval` for deployment.

## License

MIT.
