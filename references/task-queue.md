# Deterministic Task Queue

The queue is a **scheduler**. It holds task state, the single-writer lock, the capability route, the dry-run dispatch command, and the external-action approval record.

The **human-readable shared task record is the authority on intent.** When the two disagree, the record wins and the queue is reconciled to it (section 9).

## 1. Task packet (written at `specify`)

A task may not leave `specify` until it records:

| Field | Purpose |
|---|---|
| title | one line, verbatim from the user's intent |
| objective | the outcome, not the activity |
| definition of done | criterion list; each criterion must be testable |
| write scope | the exact files/directories the implementer may touch |
| prohibited scope | what must not be touched (config, shared records, other owners' files) |
| inputs | paths, revisions, prior evidence |
| baseline revision | commit / hash / snapshot id taken before any edit |
| constraints | platform, budget, deadline, compatibility |
| risks and non-goals | what this task deliberately does not solve |
| owner | the implementation worker |
| verifier | a **different** agent (see `references/routing-and-roles.md`) |
| acceptance tests | the commands that will be run at the verify stage |
| external action | if any, its kind and scope |

Invalid values are rejected at creation (unknown type, unknown capability, or an invalid start choice) — a typo must fail loudly, never silently mis-route a task.

## 2. Stage machine

```
specify -> [triage] -> implement -> verify -> evidence -> done
                          ^           |
                          |           +-- verify completes = PASS (gate opens)
                          +-- fail <--+   verify fails    = gate blocked

side states:  blocked   (any stage, exits only by a recorded resolution)
              recovery  (stale lock on an in_progress/blocked task -> queued)
```

- `environment` tasks insert a `triage` phase between `specify` and `implement`, owned by the environment specialist.
- The task status is one of `queued`, `in_progress`, `blocked`, `done`. A phase is not a status: a task can be `queued` at `verify`.
- `done` is terminal. It is reached only from `evidence`, only with the evidence entry written, and only when verification has **passed** or an explicit **override** is on record (section 3.1). Nothing else opens it.
- **The verification gate is not the `blocked` status.** A failed verification sets the task's `verification.blocked: true` and requeues it as `queued` at `implement`: the task is still workable, but the gate holds until a later `verify` passes or an override is recorded.
- Some configurations model an explicit `accept` checkpoint between `evidence` and `done`. It is the same gate - the coordinator's criterion-by-criterion mapping. It adds a checkpoint, not another writer or another stage owner.
- A stage transition releases the lock and requeues the task for the next role.

## 3. Stage contracts

| Stage | Owner | Exit criteria | Artifact required |
|---|---|---|---|
| `specify` | Coordinator | task packet complete (section 1) | task packet |
| `triage` (environment only) | Environment Specialist | fault isolated, root cause or explicit "undetermined" | diagnostic transcript |
| `implement` | Implementation Worker (capability-routed) | change complete, baseline preserved, self-check run | changed-file list, commands, exit codes |
| `verify` | Verification Worker (never the implementer) | each acceptance criterion judged PASS/FAIL by reproduction | PASS recorded, or a failure naming the failing criteria and findings |
| `evidence` | Coordinator | every criterion mapped to an entry; residual risk stated | evidence entry + grade per `references/evidence-grading.md` |
| `done` | - | terminal | - |

Entry rules:

- `implement` requires the lock and a recorded baseline revision. Risky edits without a recoverable baseline do not start.
- `verify` receives the acceptance criteria and the changed-resource list - **not** an unfiltered transcript of the implementation chat.
- A release-blocking finding means `verify` does **not** complete as PASS. The task is returned to `implement` by the `fail` verb (section 3.1).

### 3.1 Verification gate contract (fail / pass / override)

Completing the `verify` stage **is** the PASS. The verifier records a **failure** instead whenever a criterion does not reproduce:

| Verb | Who / when | Effect | Never |
|---|---|---|---|
| **fail** | only the verifier holding the lock, only in the `verify` stage; must state the failing `criteria` or `findings` | `verification.status = failed`, `blocked = true`, `lastResult = fail`, `attempts + 1`; task returns to `implement` under the roster's implementer, lock released | fix the work itself; fail without saying what failed; fail a stage you do not hold |
| **pass** | the verifier completes the `verify` stage | `status = passed`, `blocked = false`, `lastResult = pass`, `attempts + 1`, verifier and timestamp recorded | claim a pass without criterion-linked evidence |
| **override** | a human or the coordinator, only while the gate is `blocked`; requires `approvedBy`, `scope` **and** `reason` | `blocked = false`; an `override` record is stored **beside** the failure | erase the failure record; act as evidence or as shipping authorization |

The stored record per task is `verification = { status: pending | passed | failed, attempts, blocked, lastResult, criteria, findings, at, by, override }`.

**Two gate interception points - both refuse by default:**

1. **Completion.** Completing `evidence` to `done` is refused unless `status === passed` or an override is on record.
2. **Dispatch.** A task at `evidence` whose verification is blocked and has no override is **not dispatchable**: it throws (`is gated`) and the command exits non-zero.

Neither point is bypassed by status alone: a queue edited by hand into `evidence` still hits both checks. An override is a deliberate, attributable human decision; it never upgrades the verification grade, and it never authorizes an irreversible action.

## 4. Claim (lock) semantics

1. Only the **assigned** agent may claim. A claim by anyone else fails.
2. A task already locked by a different agent cannot be claimed. Stop; this is an ownership conflict.
3. A lock held by the claiming agent is idempotent — claiming twice is not a second ownership.
4. A `blocked` task cannot be claimed, completed, approved, or dispatched.
5. Claiming sets the task to `in_progress` and records the owner and claim time.
6. **Every write requires the lock.** Reviewers write only isolated artifacts (tests, reports) outside the implementation scope.
7. The lock is released when a stage completes, or when the coordinator runs a recorded recovery.
8. Never edit a resource whose lock is held by another agent, including "small fixes" and formatting.
9. The **verification gate** is separate from the `blocked` status: after a failed verification the task is `queued` at `implement` and can be claimed normally, but it cannot be dispatched to `evidence` or completed to `done` until the gate reopens (section 3.1).

The list above is the **claim lock**: one writer per task. A second lock protects the
**state file** itself. Every CLI command takes an exclusive `<queue>.lock` file, writes
through a temp file and renames it over the queue, then releases the lock. Concurrent
invocations therefore serialise instead of racing — without it, two processes read the same
revision and the later write silently discards the earlier one (a lost task, an overwritten
evidence entry). A second writer waits briefly and then fails with `locked by another
process` rather than overwriting, and a lock left behind by a crashed process is taken over
once it is stale (10 seconds), so a crash cannot wedge the queue.

## 5. Capability tags and default routing

A task carries a capability tag that selects the routing chain. The tag is derived from the task type unless given explicitly.

| Capability | Default chain | Evidence expected |
|---|---|---|
| `full` | Coordinator `specify` -> Implementation Worker `implement` -> a different Verification Worker `verify` -> Coordinator `evidence` | commands, exit codes, machine-readable result |
| `web` | Coordinator `specify` -> web Implementation Worker `implement` -> a different Verification Worker `verify` -> Coordinator `evidence` | reproducible UI/runtime evidence (target viewports, console, reduced-motion, real assets) |
| `complex` | Coordinator `specify` -> senior Implementation Worker `implement` -> Verification Worker `verify` -> Coordinator `evidence` | targeted regression, boundary tests, recomputed artifacts |
| `verify` | Coordinator `specify` -> read-only independent review -> Verification Worker `verify` -> Coordinator `evidence` | read-only commands, findings, exit codes |
| `environment` | Coordinator `specify` -> Environment Specialist `triage`/`implement` -> Verification Worker `verify` -> Coordinator `evidence` | versions, config diff, probe output, stated unverified boundary |

Agent identifiers are deployment configuration, not protocol. The queue names the role's configured worker in its command string; the reference file never assumes a particular product name.

### 5.1 Roster initialisation

The routing table is **data**, not code, and it is installed through the CLI, which validates it before writing anything:

```bash
node scripts/orchestrator/orchestrator.mjs init --roster my-team.json
```

- `init` prints the accepted agent ids; `init` without `--roster` installs the default three-agent roster.
- The roster file is JSON: `{ "agents": { "<id>": { cost, available, specialties[], scores{ role: 0..3 } } }, "routes": { ... } }` (shape and ranking: `references/routing-and-roles.md`, section 2).
- Any number of agents and any agent names are accepted. A `routes` name that is absent from `agents`, or parked with `available: false`, is ignored and routing falls back to the scores.
- A malformed roster - unknown role name, score outside 0-3, non-numeric `cost`, non-array `specialties`, or zero agents - is **rejected loudly**, never silently downgraded.
- Roster resets are fail-closed: `init` refuses to wipe a non-empty queue without `--force`, and `--force` writes a timestamped backup first.


## 6. Dispatch is dry-run only

`dispatch` **prints** the command for the next assigned role. It never launches an agent, and it never takes the lock.

Returned fields: task id, assigned agent, phase, capability, `execute: false`, the command text (`command`) and the same command as an argument array (`argv`), whether coordination is required, whether an external action is approved, and the gate visibility fields `verificationStatus`, `verificationBlocked` and `verificationOverride` (section 3.1).

Rules:

- **Non-dispatchable tasks fail with a non-zero exit code**: `done`, `blocked`, no assigned agent, or no command for the assigned agent. Exit 0 must never disguise an undispatchable task.
- **Gate interception point 2.** A task at `evidence` whose verification is blocked with no override is not dispatchable: it throws (`is gated`) and exits non-zero even though it is otherwise eligible. A task whose verification *passed* dispatches normally.
- Run `claim` before editing; a dispatch is a message, not an ownership transfer.
- Do not dispatch the same task to two workers "to be safe". Two dispatch targets are two writes.
- Determinism: the same task state must produce the same dispatch result every time. Routing is board state + fixed rules (capability, assignment, stage) — not a model's improvisation at run time (see `references/anti-patterns.md`, pitfall 7).

## 7. Approval gate for external actions

External actions include at least: `deploy`, `publish`, `send`, `upload`, `delete`, production change, account change.

1. An external action is declared when the task is created, with its kind.
2. It executes only after an approval record exists: **approver identity + scope** (which action, on which target). A blanket "go ahead" without a scope is not an approval.
3. Approval is per task and per scope. Approving task A does not approve task B, and approving "staging" does not approve "production".
4. **Evidence and approval are independent gates.** E1 evidence of a passing verification is not authorization to ship; an approval is not evidence that the change works.
5. The implementer never approves its own external action. A verifier's PASS never substitutes for the user's decision.
6. Internal stages may proceed while approval is pending. The external step must not.
7. Record the approval in the shared task record, scoped and dated, so the next agent can audit it.

## 8. Blocked and recovery

**Blocked** (any stage):

- Set when the stage cannot proceed: missing input, missing permission, ambiguous scope, unavailable external dependency, or a stop condition from `references/routing-and-roles.md`.
- Record the blocking condition, who can unblock it, and what was attempted.
- A blocked task cannot be claimed, completed, approved, or dispatched.
- Exit `blocked` only by a recorded resolution from the coordinator. Re-entering the same stage without a change of condition is not a resolution.

**Recovery** (stale lock):

- Use only for an `in_progress` or `blocked` task whose owner is gone.
- Requires a written reason. A recovery without a reason is refused.
- Effect: clears the lock, keeps the current phase and assigned role, appends a recovery evidence entry, and requeues the task.
- A `done` task is not recoverable. Recovery is not a way to skip or re-run verification; it restores dispatchability.

**Verification FAIL** is not recovery. A failed verification has its own verb - `fail` (section 3.1): it writes the failure into the task's verification record, sets `blocked`, releases the lock and requeues the task at `implement`. It is not the `blocked` status: the task stays workable, but it can be neither dispatched to `evidence` nor completed to `done` until a later `verify` passes or an override is recorded.

**Override** is the deliberate exception:

- `override --task <id> --by <who> --scope <what> --reason <why>` - the CLI spelling of the library call `overrideVerificationGate(state, id, { approvedBy, scope, reason })`; all three are mandatory.
- Only usable while the gate is `blocked`. It clears `blocked`, keeps `status: failed`, and stores the approver, scope, reason and timestamp beside the failure.
- An override is a recorded human decision, not evidence: it does not upgrade the grade and it does not approve an external action (section 7).
- Do not override a criterion that was never run. Fix and re-verify first; override only a failure that is understood and accepted.

## 9. Queue vs. handoff record

The record outranks the queue. On disagreement:

1. **Stop.** Do not let the queue's owner or phase drive a write.
2. Read the shared task record and follow its current owner, step, and next action.
3. Reconcile the queue (reassign, reopen as a follow-up, or recover) and record the discrepancy plus its cause.
4. If the record itself is ambiguous, ask the user; do not guess an owner.

## 10. Failure handling

| Failure | Immediate action | Never |
|---|---|---|
| claim fails: locked by another agent | stop; treat as an ownership conflict; follow the record | retry in a loop or edit without the lock |
| claim fails: not the assigned agent | coordinator reassigns in the record, then the queue | claim anyway "to save time" |
| dispatch exits non-zero | read the task status (done/blocked/unassigned/no command) and fix the state | ignore the code or treat it as success |
| verify FAIL | run `fail` with the failing criteria or findings; the task returns to `implement` and the gate stays blocked | advance to `evidence` or `done` |
| gate blocked but the failure is accepted | record an override with `approvedBy`, `scope` and `reason`; the failure stays on record | override without a reason, or treat the override as a passing verification |
| lock stale, owner gone | `recovery` with a reason | delete the lock file or edit directly |
| queue and record disagree | record wins; reconcile | let the queue overrule the user's intent |
| approval missing for an external action | keep the task open at the gate | execute the action and "record it later" |

## 11. Commands

| Command | Flags | Effect |
|---|---|---|
| `init` | `[--roster <file.json>] [--force]` | install a roster of any size and a fresh queue; prints the accepted agent ids. A non-empty queue requires `--force`, which writes a timestamped backup first |
| `status` | - | print the whole queue state |
| `create` | `--title <text>` (required), `--type`, `--capability`, `--workspace`, `--external-action <kind>`, `--important`, `--execution-mode`, `--security`, `--independent-verify` | create a task; `--important` requires all three start choices |
| `claim` | `--task <id> --agent <id>` | take the single-writer lock; only the assigned agent may |
| `complete` | `--task <id> --agent <id> [--evidence <text>]` | complete the current stage and advance; completing `verify` records the PASS; the hop out of `evidence` is gated |
| `fail` | `--task <id> --agent <id> (--criteria <text> \| --findings <text>)` | record a failed verification: gate blocked, task back to `implement`, lock released |
| `override` | `--task <id> --by <who> --scope <what> --reason <why>` | pass a blocked gate deliberately; all three fields required, the failure kept on record |
| `dispatch` | `--task <id>` | print the dry-run dispatch record; never launches anything |
| `approve` | `--task <id> --by <who> --scope <what>` | record approval for the task's declared external action |
| `recover` | `--task <id> --reason <text>` | clear a stranded lock and requeue an `in_progress` or `blocked` task |

```bash
node scripts/orchestrator/orchestrator.mjs init --roster my-team.json
node scripts/orchestrator/orchestrator.mjs create --title "<objective>" --type build --workspace "<workspace>"
node scripts/orchestrator/orchestrator.mjs create --title "<objective>" --type build --important \
  --execution-mode collaborative --security planned --independent-verify planned
node scripts/orchestrator/orchestrator.mjs claim    --task task-0001 --agent implementer-a
node scripts/orchestrator/orchestrator.mjs dispatch --task task-0001          # dry-run text only
node scripts/orchestrator/orchestrator.mjs complete --task task-0001 --agent implementer-a --evidence "<changed files + commands + exit codes>"
node scripts/orchestrator/orchestrator.mjs fail     --task task-0001 --agent verifier-b --criteria "<acceptance test that failed>"
node scripts/orchestrator/orchestrator.mjs override --task task-0001 --by user --scope "<release>" --reason "<why the failure is accepted>"
node scripts/orchestrator/orchestrator.mjs approve  --task task-0002 --by user --scope "<action on target>"
```

Flag names vary by implementation; the semantics in sections 1-10 do not.
