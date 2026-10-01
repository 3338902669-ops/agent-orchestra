# Portable orchestrator runtime (`scripts/orchestrator/`)

A dependency-free Node ESM port of a local agent-orchestrator runtime. It stores a
machine-readable task queue next to these files and moves each task through a fixed
stage machine, so a coordinating agent can hand work between roles without guessing.

It does **not** replace handoff notes: those stay the human-readable record. This tool
only tracks stages, the single-writer lock, routing, capability labels, start choices
and external-action approvals.

| File | Purpose |
|---|---|
| `lib.mjs` | Pure state machine. No I/O, no dependencies, no process spawning. |
| `orchestrator.mjs` | CLI over the queue file. Dry-run dispatch only. |
| `lib.test.mjs` | `node:test` suite (`node --test scripts/orchestrator/lib.test.mjs`). |

Requires Node 18+ (uses `structuredClone` and `node:test`). No npm install is needed.

## Stage machine

    specify -> [triage] -> implement -> verify -> evidence -> done

`triage` is only used by `environment` tasks.

| type | flow |
|---|---|
| `build` (default) | generalist specify -> generalist implement -> specialist verify -> generalist evidence -> done |
| `web` | generalist specify -> frontend implement -> generalist verify -> generalist evidence -> done |
| `complex` | generalist specify -> specialist implement -> generalist verify -> generalist evidence -> done |
| `verify` | generalist specify -> specialist implement/independent review -> generalist verify -> generalist evidence -> done |
| `environment` | generalist specify -> frontend triage -> frontend implement -> generalist verify -> generalist evidence -> done |

The verify owner is always derived so that **verifier != implementer**. Completing a
stage releases the lock and re-queues the task for the next owner.

## Commands

Run from the repository root (`node scripts/orchestrator/orchestrator.mjs ...`) or from
inside `scripts/orchestrator/` (`node orchestrator.mjs ...`). The queue file is resolved
relative to `orchestrator.mjs`, so the working directory does not matter.

    node orchestrator.mjs init
    node orchestrator.mjs status
    node orchestrator.mjs create --title "<objective>" --type build --workspace "<workspace>/client"
    node orchestrator.mjs create --title "<objective>" --type web --capability web --workspace "<workspace>/site"
    node orchestrator.mjs claim    --task task-0001 --agent generalist
    node orchestrator.mjs complete --task task-0001 --agent generalist --evidence "spec written to the task packet"
    node orchestrator.mjs dispatch --task task-0001
    node orchestrator.mjs approve  --task task-0002 --by user --scope "deploy staging"
    node orchestrator.mjs recover  --task task-0001 --reason "worker process ended during probe"

Create flags: `--title` (required), `--type`, `--capability`, `--workspace`,
`--external-action <kind>`, `--important`, `--execution-mode single|collaborative`,
`--security planned|skip`, `--independent-verify planned|skip`.

## Output fields

`create` prints the task record: `id`, `title`, `type`, `capability`, `workspace`,
`phase`, `assignedAgent`, `status`, `important`, `startChoices`, `lock`,
`externalAction`, `evidence`, timestamps.

`dispatch` prints a dry-run record and nothing else:

| field | meaning |
|---|---|
| `taskId` | task being dispatched |
| `agent` / `phase` / `capability` | who should act, at which stage, with which label |
| `execute` | always `false` in this port |
| `command` | dry-run command text built from `COMMAND_TEMPLATES` (placeholder runner) |
| `requiresCoordinatorCoordination` | `true` when the owner is the `generalist` role |
| `requiresHumanCoordination` | always `false`; a constant kept for callers |
| `externalActionApproved` | `null` when the task has no external action, else the approval state |

## Safety boundary

- **No process is ever started.** `lib.mjs` and `orchestrator.mjs` import no
  `child_process`; `dispatch` only renders text. The suite asserts this.
- **Non-dispatchable tasks fail closed.** `done`, `blocked`, locked, agent-less or
  command-less tasks make `dispatch` throw and the CLI exit **1** — it never exits 0 to
  pretend the dispatch succeeded.
- **One writer per task.** `claim` takes an exclusive lock; a second agent is rejected
  until the stage completes or `recover` clears a stranded lock.
- **External actions need an explicit approval record.** A task created with
  `--external-action <kind>` starts with `approved: false`; only `approve --by <who>
  --scope <what>` unblocks it. The command templates carry the same rule into the prompt.
- **Important tasks must state all three start choices** (`--execution-mode`,
  `--security`, `--independent-verify`). `create` rejects the task if any is missing, so
  an important task cannot enter the queue with an implied scan or collaboration mode.
- **`init` never silently resets.** A non-empty queue requires `--force`, and the
  previous contents are first written to a timestamped `*.pre-init-<stamp>.bak`.

Exit codes: `0` success; `1` the command failed (unknown command, validation error, or a
non-dispatchable task) and the reason is printed on stderr as `orchestrator: <message>`.

## Configuration

- `COMMAND_TEMPLATES` in `lib.mjs` holds the per-agent dry-run command templates. They
  use a placeholder `agent-run` binary on purpose — replace them with your own runner.
  The orchestrator renders the text and stops there.
- `AGENTS` in `lib.mjs` is the default roster (`generalist`, `frontend`, `specialist`).
- The queue file defaults to `TASK-QUEUE.json` next to these files. Set
  `ORCHESTRATOR_STATE` to an explicit path (used by smoke tests so they do not write into
  the repository).
- The module contains no machine paths, personal or product names, or credentials.

## Tests

    node --test scripts/orchestrator/lib.test.mjs

The suite covers the stage machine for every type, the verifier-independence invariant,
lock conflicts, capability derivation and validation, important-task start choices, the
approval gate, recover semantics, dry-run dispatch and the fail-closed guards, plus
source-level checks that no absolute machine path and no process spawn exists.
