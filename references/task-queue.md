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
specify -> implement -> verify -> evidence -> done
             ^                        |
             |                        +-- done is terminal
             +-- verification FAIL returns here via a recorded decision

side states:  blocked   (any stage, exits only by a recorded resolution)
              recovery  (stale lock on an in_progress/blocked task -> queued)
```

- `environment` tasks insert a `triage` phase between `specify` and `implement`, owned by the environment specialist.
- The task status is one of `queued`, `in_progress`, `blocked`, `done`. A phase is not a status: a task can be `queued` at `verify`.
- `done` is terminal. It is reached only from `evidence` with the evidence entry written.
- Some configurations model an explicit `accept` checkpoint between `evidence` and `done`. It is the same gate — the coordinator's criterion-by-criterion mapping. It adds a checkpoint, not another writer or another stage owner.
- A stage transition releases the lock and requeues the task for the next role.

## 3. Stage contracts

| Stage | Owner | Exit criteria | Artifact required |
|---|---|---|---|
| `specify` | Coordinator | task packet complete (section 1) | task packet |
| `triage` (environment only) | Environment Specialist | fault isolated, root cause or explicit "undetermined" | diagnostic transcript |
| `implement` | Implementation Worker (capability-routed) | change complete, baseline preserved, self-check run | changed-file list, commands, exit codes |
| `verify` | Verification Worker (never the implementer) | each acceptance criterion judged PASS/FAIL by reproduction | findings list with severity, repro, expected, actual, resource, owner |
| `evidence` | Coordinator | every criterion mapped to an entry; residual risk stated | evidence entry + grade per `references/evidence-grading.md` |
| `done` | — | terminal | — |

Entry rules:

- `implement` requires the lock and a recorded baseline revision. Risky edits without a recoverable baseline do not start.
- `verify` receives the acceptance criteria and the changed-resource list — **not** an unfiltered transcript of the implementation chat.
- A release-blocking finding means `verify` does **not** complete as PASS. The task is returned to `implement` (section 8).

## 4. Claim (lock) semantics

1. Only the **assigned** agent may claim. A claim by anyone else fails.
2. A task already locked by a different agent cannot be claimed. Stop; this is an ownership conflict.
3. A lock held by the claiming agent is idempotent — claiming twice is not a second ownership.
4. A `blocked` task cannot be claimed, completed, approved, or dispatched.
5. Claiming sets the task to `in_progress` and records the owner and claim time.
6. **Every write requires the lock.** Reviewers write only isolated artifacts (tests, reports) outside the implementation scope.
7. The lock is released when a stage completes, or when the coordinator runs a recorded recovery.
8. Never edit a resource whose lock is held by another agent, including "small fixes" and formatting.

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

## 6. Dispatch is dry-run only

`dispatch` **prints** the command for the next assigned role. It never launches an agent, and it never takes the lock.

Returned fields: task id, assigned agent, phase, capability, `execute: false`, the command text, whether coordination is required, and whether an external action is approved.

Rules:

- **Non-dispatchable tasks fail with a non-zero exit code**: `done`, `blocked`, no assigned agent, or no command for the assigned agent. Exit 0 must never disguise an undispatchable task.
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

**Verification FAIL** is not recovery. The reference queue has no automatic reopen verb, so the coordinator must make the return explicit: create a follow-up task pinned to the failing criteria and the baseline revision, or reassign the implement stage in the record and reconcile the queue. Either way, write it down before anyone edits.

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
| verify FAIL | return to `implement` with failing criteria attached | advance to `evidence` |
| lock stale, owner gone | `recovery` with a reason | delete the lock file or edit directly |
| queue and record disagree | record wins; reconcile | let the queue overrule the user's intent |
| approval missing for an external action | keep the task open at the gate | execute the action and "record it later" |

## 11. Command sketch (illustrative)

```bash
node scripts/orchestrator/orchestrator.mjs create --title "<objective>" --type build --workspace "<workspace>"
node scripts/orchestrator/orchestrator.mjs create --title "<objective>" --type build --important \
  --execution-mode collaborative --security planned --independent-verify planned
node scripts/orchestrator/orchestrator.mjs claim    --task task-0001 --agent implementer-a
node scripts/orchestrator/orchestrator.mjs dispatch --task task-0001          # dry-run text only
node scripts/orchestrator/orchestrator.mjs complete --task task-0001 --agent implementer-a --evidence "<changed files + commands + exit codes>"
node scripts/orchestrator/orchestrator.mjs approve  --task task-0002 --by user --scope "<action on target>"
```

Flag names vary by implementation; the semantics in sections 1-10 do not.