# Portable orchestrator runtime (`scripts/orchestrator/`)

A dependency-free Node ESM port of a local agent-orchestrator runtime. It stores a
machine-readable task queue next to these files and moves each task through a fixed
stage machine, so a coordinating agent can hand work between roles without guessing.

It does **not** replace handoff notes: those stay the human-readable record. This tool
only tracks stages, the single-writer lock, routing, capability labels, start choices,
the verification gate and external-action approvals.

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
| `web` | generalist specify -> frontend implement -> specialist verify -> generalist evidence -> done |
| `complex` | generalist specify -> specialist implement -> generalist verify -> generalist evidence -> done |
| `verify` | generalist specify -> specialist implement/independent review -> generalist verify -> generalist evidence -> done |
| `environment` | generalist specify -> frontend triage -> frontend implement -> specialist verify -> generalist evidence -> done |

The verify owner is always derived so that **verifier != implementer**: it is the
highest-scoring eligible agent for `verify`, with the implementer excluded. If the best
eligible candidate has a `verify` score of 0 the run fails closed instead of pretending an
unscored agent can verify. Completing a stage releases the lock and re-queues the task for
the next owner.

The names above are the **default** roster. A roster is data - any size, any agent names,
no code change (see Configuration) - and `init --roster <file.json>` installs one.

## Commands

Run from the repository root (`node scripts/orchestrator/orchestrator.mjs ...`) or from
inside `scripts/orchestrator/` (`node orchestrator.mjs ...`). The queue file is resolved
relative to `orchestrator.mjs`, so the working directory does not matter.

    node orchestrator.mjs init
    node orchestrator.mjs init --roster my-team.json     # any roster size, any agent names
    node orchestrator.mjs status
    node orchestrator.mjs create --title "<objective>" --type build --workspace "<workspace>/client"
    node orchestrator.mjs create --title "<objective>" --type web --capability web --workspace "<workspace>/site"
    node orchestrator.mjs claim    --task task-0001 --agent generalist
    node orchestrator.mjs complete --task task-0001 --agent generalist --evidence "spec written to the task packet"
    node orchestrator.mjs dispatch --task task-0001
    node orchestrator.mjs approve  --task task-0002 --by user --scope "deploy staging"
    node orchestrator.mjs fail     --task task-0001 --agent specialist --criteria "acceptance test X fails"
    node orchestrator.mjs override --task task-0001 --by user --scope "release 2.1" --reason "pre-existing flake"
    node orchestrator.mjs recover  --task task-0001 --reason "worker process ended during probe"

Create flags: `--title` (required), `--type`, `--capability`, `--workspace`,
`--external-action <kind>`, `--important`, `--execution-mode single|collaborative`,
`--security planned|skip`, `--independent-verify planned|skip`.

`complete` records the PASS when it completes the `verify` stage. `fail` records a failed
verification and sends the task back to `implement`. `override` is the only way past a
failed gate, and it needs `--by`, `--scope` **and** `--reason`.

## Output fields

`create` prints the task record: `id`, `title`, `type`, `capability`, `workspace`,
`phase`, `assignedAgent`, `status`, `important`, `startChoices`, `lock`,
`externalAction`, `evidence`, `verification`, timestamps.

`dispatch` prints a dry-run record and nothing else:

| field | meaning |
|---|---|
| `taskId` | task being dispatched |
| `agent` / `phase` / `capability` | who should act, at which stage, with which label |
| `execute` | always `false` in this port |
| `command` | dry-run command text built from `COMMAND_TEMPLATES`, rendered with POSIX single-quote escaping |
| `argv` | the same command as an argument array — hand this to a process API instead of pasting `command` into a shell |
| `requiresCoordinatorCoordination` | `true` when the owner is the `generalist` role |
| `requiresHumanCoordination` | always `false`; a constant kept for callers |
| `externalActionApproved` | `null` when the task has no external action, else the approval state |
| `verificationStatus` | `pending` / `passed` / `failed` - where the verification gate stands |
| `verificationBlocked` | `true` while a failed verification still holds the gate shut |
| `verificationOverride` | `null`, or the recorded `approvedBy` / `scope` / `reason` and timestamp of an override |

## Safety boundary

- **No process is ever started.** `lib.mjs` and `orchestrator.mjs` import no
  `child_process`; `dispatch` only renders text. The suite asserts this.
- **Free-form task text is never interpolated into a live shell string.** Titles and
  workspaces reach the prompt as raw text, the record carries an `argv` array, and the
  printable `command` is built with POSIX single-quote escaping (`shlex.quote` rule),
  not `JSON.stringify` — a JSON encoder leaves `$(...)`, backticks, `${...}` and `!`
  executable when the line is pasted. The suite has a regression test for this.
- **Non-dispatchable tasks fail closed.** `done`, `blocked`, locked, agent-less or
  command-less tasks make `dispatch` throw and the CLI exit **1** — it never exits 0 to
  pretend the dispatch succeeded.
- **The verification gate fails closed.** Completing `evidence` without a passed
  verification throws (`verification has not passed`), and a task at `evidence` whose
  verification is blocked with no override is not dispatchable (`is gated`). The only way
  past a failed gate is `override --by <who> --scope <what> --reason <why>` - all three
  required - and the override is recorded **next to** the failure: `status` stays `failed`,
  so the failure is never erased.
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
- `DEFAULT_ROSTER` / `AGENTS` in `lib.mjs` hold the default roster
  (`generalist`, `frontend`, `specialist`). A roster is data: `init --roster <file.json>`
  installs one of any size with any agent names, and `validateRoster` rejects a malformed
  one loudly (unknown role, score outside 0-3, non-numeric `cost`, non-array
  `specialties`, zero agents).
- `DEFAULT_COMMAND_TEMPLATE` provides a dry-run argv for **any** agent id a roster
  declares, so a team that is not called `generalist`/`frontend`/`specialist` is still
  dispatchable.
- The queue file defaults to `TASK-QUEUE.json` next to these files. Set
  `ORCHESTRATOR_STATE` to an explicit path (used by smoke tests so they do not write into
  the repository).
- The module contains no machine paths, personal or product names, or credentials.

## Tests

    node --test scripts/orchestrator/lib.test.mjs

The suite covers the stage machine for every type, the verifier-independence invariant,
lock conflicts, capability derivation and validation, roster genericity (any size, any
agent names), important-task start choices, the approval gate, the verification gate
(fail, override, fail-closed verifier selection), recover semantics, dry-run dispatch and
the fail-closed guards, plus
source-level checks that no absolute machine path and no process spawn exists.
