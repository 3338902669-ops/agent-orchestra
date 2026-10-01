# Handoff Discipline

The full contract for moving work between agents, sessions and tools. `SKILL.md` states the rules in short form; this file is the detail. Evidence grading is defined in `references/evidence-grading.md`, queue mechanics in `references/task-queue.md`, and role plus verifier selection in `references/routing-and-roles.md` - this file links to them rather than repeating them.

## 0. The sentence that ends most arguments

**The human-readable shared record is the authority on intent. The queue is only a scheduler.**

When a queue phase, a lock file or an in-session assumption disagrees with the record, the record wins: stop, follow the recorded owner and next step, reconcile the queue, and write the discrepancy and its cause into the record. A scheduler never overrules intent. A chat message is not a record either - if a decision is not written down, it has not been made (see `references/task-queue.md`, section 9).

## 1. The shared record: four files

Create one shared directory per project (referred to here as `<shared-dir>`), outside the repositories being edited. Every member reads it before acting and writes progress into it.

| File | Holds | Updated |
|---|---|---|
| `CURRENT-TASK.md` | the live handoff entry: status, owner, current step, next step, blockers, evidence pointers | on every substantial step |
| `HANDOFF-RULES.md` | the team's rules of engagement (this skill, localized to the team) | when the rules change |
| `MEMORY-SNAPSHOT.md` | shared memory: decisions, preferences, lessons learned | periodically and on every major decision |
| `AGENT-ROLES.md` | who can do what: the capability and role table | when the roster changes |

An optional fifth file is the machine-readable queue (`TASK-QUEUE.json`, see `references/task-queue.md`). It is a scheduler, not a record.

The record is checkable rather than merely described:

```bash
node scripts/check-handoff.mjs --dir <shared-dir>
```

It requires all four files, a live entry carrying **status, owner, current step, next step and evidence**,
a recognised status value (`进行中` / `等待接续` / `已完成` or the English equivalents), and a **positive**
statement that the record outranks the queue - a negated one ("the record does **not** outrank the queue")
is refused, because it says the opposite while containing the same words.

Rules for the record itself:

- **Keep the live entry short.** Conclusions and state only - owner, status, step, next step, evidence pointers - under roughly 200 lines. Process chat and reasoning stay in the working agent's own session.
- **Chat is not a source of truth.** A decision that exists only in a conversation has not been made.
- **Append and correct with dated entries.** Do not silently rewrite history; the next agent needs to see what changed and why.
- **Every entry carries a timestamp and an author.** Conflict resolution depends on both (section 4).

## 2. The five iron rules

1. **Read before acting.** The first action on any task is reading `CURRENT-TASK.md` and `HANDOFF-RULES.md`. *Executable check:* before your first write you can state the recorded owner, status, current step and next step without asking anyone.
2. **Resume, do not redo.** When the status is in-progress or handoff-wait, continue from the recorded current step. *Executable check:* your first write either continues that step or records why it cannot be continued. Re-running completed work "to be sure" is not resuming - it is a new verification with its own cost, and it must be recorded as one.
3. **Write progress down.** After every substantial step, write back progress, the current step, the next step and an evidence pointer. *Executable check:* a reader who was never present can name the next action and its owner from the record alone.
4. **Hand off before switching.** Before pausing, handing over or ending a session, complete the handoff block: status, owner, exact next step, open questions, baseline revision, evidence pointers. *Executable check:* the next agent needs nothing from your session - no "mental notes", no unwritten context, no local-only files left unlabelled.
5. **Completion carries graded evidence.** Moving to done requires criterion-linked evidence with an explicit grade, E1 through E4. *Executable check:* every acceptance criterion has its own entry, the grade is stated, and an E3 self-check is never written in E1's voice (see `references/evidence-grading.md`).

## 3. Task state machine

```
queued -> in-progress -> handoff-wait -> in-progress -> ... -> done
   |
   +-> blocked   (named condition, only after three consecutive unresolved rounds)
```

- **queued** - recorded, no writer holds it at this moment.
- **in-progress** - one owner holds the write lock and is advancing the recorded step.
- **handoff-wait** - the previous owner stopped deliberately after completing the handoff block. The task is ready to be picked up; it is *not* blocked.
- **blocked** - a specific condition stops progress: missing input, missing permission, ambiguous scope, an unavailable external dependency. Name the condition, who can unblock it, and what was attempted. **Only after three consecutive rounds with no change of condition may the status be set to blocked**; before that, the task stays in-progress or handoff-wait with the obstacle written down.
- **done** - terminal. Reached only with criterion-linked evidence (rule 5) and only after a verification pass or a recorded override.

State changes are written to disk. Verbal, in-session or implied state does not count.

### 3.1 Mapping to the queue stage machine

The record's status and the queue's phase answer different questions. The queue runs `specify -> implement -> verify -> evidence -> done`, plus `blocked` and `recovery` (and a `triage` phase for environment tasks):

| Record status | Typical queue phase | Note |
|---|---|---|
| queued | specify, or implement awaiting a writer | the packet may be complete while the writer is busy |
| in-progress | implement / verify / evidence | the phase names whoever holds the lock now |
| handoff-wait | any phase | the lock is released and the next step is written for the next owner |
| blocked | any phase | the queue task is also blocked: it cannot be claimed, completed, approved or dispatched |
| done | done | terminal in both |

One trap: **a failed verification is not the blocked status.** The queue's `fail` verb shuts the verification gate and returns the task to implement; the task stays workable by its owner, so the record remains in-progress while the gate is closed. Only a later passing verify or a recorded override opens it (see `references/task-queue.md`, sections 3.1 and 8).

## 4. Single writer per resource

- One file or resource has exactly one primary writer at a time. Everyone else is read-only, or writes isolated artifacts (tests, reports, scratch output) that never overwrite the writer's resource.
- Take the lock before the first write, not after the first conflict. If the resource is locked by another member, stop: do not merge carefully and do not edit in parallel.
- Changing a shared configuration file (build script, deploy config, dependency manifest) means reading the current value first and declaring the change in the record.
- **Moving ownership requires a handoff record:** resource, previous owner, new owner, reason, baseline revision, and the next check to run. Ownership without a record is a conflict, not a handoff. Reviewers may promote themselves to writers only through such a record, after the previous owner has released the lock.
- **The verifier is never the implementer.** An author's self-check is E3 and is not a verification result; the verifier is the highest-scoring eligible agent for the role, excluding the implementer (see `references/routing-and-roles.md`, section 5).

**Conflict resolution.** On a conflict: stop writing. The **last timestamped entry in the shared record wins** - it is the team's closest approximation of the user's current intent. Then reconcile the queue and write the discrepancy and its resolution into the record so the next agent does not re-litigate it. Never resolve an ownership conflict by writing faster, and never by discarding the other writer's work. If the record itself is ambiguous, ask the user; do not guess an owner.

## 5. Memory sync

- Each member maintains its own long-term memory. **Shared facts go only into `MEMORY-SNAPSHOT.md`** - otherwise the same fact exists in several versions and nobody knows which one is current.
- Record **decisions, preferences and lessons**, not transcripts. Date every entry and keep the most recent N (the team picks N; 20-50 entries is a workable range).
- **Lessons rank highest.** A mistake, a correction or a hard-won workaround that is missing from the snapshot will be repeated - usually by the next agent, on the next day.
- **Partition the snapshot.** An entry becomes visible to the team once the coordinator marks it verified; unverified content stays quarantined with its source and a confidence note and is never used as an input to a decision. This is the defence against one wrong claim spreading as fact (see `references/anti-patterns.md`, pitfall 2).
- Routine sync: append each member's day summary, de-duplicate, drop the oldest entries beyond the cap, and date the merge. Sync on a schedule **and** on every major decision, so a session that dies mid-task has not taken the decisions with it.

## 6. Minimal closed loop

1. **Intake.** The coordinator reads the record (rule 1), then writes the objective, acceptance criteria and owner into `CURRENT-TASK.md`; status becomes in-progress. If the task is important, the three intake questions are asked and recorded **first**, never defaulted (see `references/important-task-intake.md`).
2. **Implement.** The implementation worker reads the record, takes the lock, finishes one batch, and writes back progress, the current step, the next step and E1 evidence.
3. **Verify independently.** The coordinator dispatches a verifier who did not implement the change, handing over the acceptance criteria and the changed-resource list - not the full transcript.
4. **Fail loudly or pass.** A criterion that does not reproduce goes back through the queue's `fail` verb: the failing criteria are recorded, the gate closes, and the task returns to implement. The verifier never fixes the work itself.
5. **Aggregate.** With the criteria passed, the coordinator maps evidence to every criterion, attaches a grade to each entry, and states residual risk.
6. **Close.** Status becomes done and the key decision goes into `MEMORY-SNAPSHOT.md`. Any external action (deploy, publish, send, upload, delete) still waits for its own scoped approval: a passing verification is not a shipping authorization.
7. **Pause or switch at any point** by completing the handoff block of rule 4 - the loop survives a session ending mid-step, which is the normal case, not the exception.

## 7. Cross-session and cross-tool checklist

**Before picking up work**

- [ ] Read `CURRENT-TASK.md` in full, then `HANDOFF-RULES.md`; skim `MEMORY-SNAPSHOT.md` for decisions and lessons.
- [ ] Read the status: in-progress or handoff-wait means resume; done means do not reopen without a new entry.
- [ ] Confirm the owner and the lock: do not write a resource another owner holds.
- [ ] Confirm the baseline revision the evidence refers to. If the artifact changed after the evidence was captured, that evidence is E4 until re-run (see `references/evidence-grading.md`, section 5).
- [ ] Write down what you are about to do before doing it.

**Confirming "resume, not redo"**

- [ ] You can state the recorded current step and next step without asking anyone.
- [ ] Your first write continues that step, or records why it cannot be continued.
- [ ] You are not re-running completed stages to feel safe; if you do, it is a new verification with its own cost, recorded as such.
- [ ] Your entry continues the same task, not a parallel one, and it keeps the same owner chain.

**Before handing off or ending a session**

- [ ] Status is handoff-wait (or done, with evidence).
- [ ] The owner is named, or explicitly cleared.
- [ ] The next step is one imperative sentence that needs no context from your session.
- [ ] Open questions, blocking conditions and "do not touch" notes are named.
- [ ] Evidence pointers carry their grade and the revision they apply to.
- [ ] Anything that exists only on your machine or only inside your session is called out as such.

**Handoff entry shape**

```
status:    in-progress | handoff-wait | blocked | done
owner:     <agent id>                 updated: <timestamp>
progress:  <what was completed, one or two lines>
current:   <the step being executed now>
next:      <one imperative sentence for the next owner>
lock:      <resource(s) held, or none>
baseline:  <revision / hash the work started from>
evidence:  <criterion -> command, exit code, artifact, grade, revision>
blockers:  <named condition and who can unblock, or none>
```

## 8. Where the detail lives

| Topic | File |
|---|---|
| Evidence grades E1-E4 and what an E1 record must contain | `references/evidence-grading.md` |
| Stage machine, claim locks, dry-run dispatch, verification gate, approval, recovery | `references/task-queue.md` |
| Role definitions, capability scoring, roster of any size, verifier selection, conflict priority | `references/routing-and-roles.md` |
| Intake gate: the three questions and what each answer changes | `references/important-task-intake.md` |
| The eight coordination anti-patterns and their engineering fixes | `references/anti-patterns.md` |
| The end-to-end execution sequence, discover to approve | `references/protocol.md` |
