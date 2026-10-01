# The Agent Orchestra Protocol

> This document is the normative part of the project. `SKILL.md` teaches an agent how to behave;
> `scripts/orchestrator/lib.mjs` is the reference implementation; this file says what MUST hold.
> Where this document and the code disagree, the code is the defect - file it against the code.

The protocol exists because the interesting failure in multi-agent work is not that an agent cannot
write code. It is that an agent can declare success. Every contract below removes one way for that
to happen silently.

**Keywords.** MUST, MUST NOT and SHOULD are used as in RFC 2119. *Enforcement* names the code that
makes the statement true; *Violation* names what a caller observes. A rule with no enforcement is
marked **advisory** and is listed in `KNOWN-FINDINGS.md` if it matters.

---

## 1. Task Contract

**A unit of work MUST have a declared type, a rigor level, an owning agent at every stage, and a
work product before implementation starts.**

- The task packet (`spec`, `acceptance`, `non_goals`) is recorded state, not prose.
- `specify` MUST NOT end without a spec and an acceptance criterion.
- Rigor is chosen from the blast radius: **L1** local and reversible, **L2** shared or
  user-visible (default), **L3** consequential - irreversible, published, credential-touching.
- A task carrying an external action MUST be **L3** and MUST answer the three intake questions.

| | |
|---|---|
| Enforcement | `createTask`, `completeStage` (specify), `REQUIRES_DOMAIN_REVIEW` |
| Violation | non-zero exit; the stage does not advance |
| Evidence | `L2 cannot reach done without a graded evidence record`, `an L3 task must state the three start choices` |

## 2. Resource Contract

**A task MUST declare the resources it intends to write, and no two live tasks may hold an
overlapping resource.**

- Resources are free-form identifiers (paths, tables, queues) compared case-insensitively.
- A claim that overlaps a resource held by another live task MUST be refused, and the refusal MUST
  name both the resource and its holder.
- A resource lock is held for the duration of a stage, not of the task.

| | |
|---|---|
| Enforcement | `claimTask` (overlap check), `task.resources` |
| Violation | refusal naming the holder; the second writer never starts |
| Evidence | `a resource held by a live task cannot be claimed by another task`, benchmark row 1 |

## 3. Ownership Contract

**Exactly one agent owns a task at any moment, and only the owner may act on it.**

- `claim` MUST be refused if another agent holds the lock, if the task is assigned elsewhere, or if
  the task is `blocked`.
- A lock left by a crashed holder MUST be recoverable once stale, and the recovery MUST be recorded
  as an event.
- Every state change MUST append an event; the event count IS the revision (`revision = events.length`).
- State MUST be written atomically (temp file + rename) under an exclusive lock, so concurrent
  writers cannot lose an update.

| | |
|---|---|
| Enforcement | `claimTask`, `requireOwner`, `acquireLock` (`open(..., 'wx')`), atomic rename |
| Violation | refusal; a stale lock is taken over only after the staleness window |
| Evidence | `concurrent creates do not lose tasks` (4 processes), `a stale lock is taken over` |

## 4. Handoff Contract

**Work that crosses a session, tool or agent boundary MUST pass through a shared record, and that
record MUST outrank the queue.**

- The record is four files: live task entry, rules of engagement, memory snapshot, role table.
- The live entry MUST carry status, owner, current step, next step and an evidence pointer.
- The status vocabulary is closed; an unrecognised value MUST fail the check.
- The precedence statement MUST be positive: "the record does NOT outrank the queue" is refused,
  because it contains the same words and asserts the opposite.

| | |
|---|---|
| Enforcement | `scripts/check-handoff.mjs` |
| Violation | non-zero exit listing every problem found |
| Evidence | `handoff.test.mjs` (8 cases incl. both negation forms) |
| Honest limit | The engine CHECKS the record; it does not reconcile it against the queue. Precedence
  is a rule the agents follow with a timestamped entry, not a state-machine invariant (see
  `references/handoff.md`). |

## 5. Verification Contract

**A verification PASS MUST come from an agent that did not do the work, and MUST carry the
evidence it passed on.**

- The verifier MUST NOT be the implementer at L2 and L3. At L1 the implementer MAY verify, and the
  record MUST say so (`selfVerified: true`). An **important** task MUST NOT self-verify at any level.
- A PASS MUST arrive with criterion-linked evidence. That record is stored as the verifier's
  **witness** on the verification, never as task evidence: storing it as evidence would make the
  verifier an evidence author and contradict the L3 independence rule.
- A FAILURE MUST state the failing criteria or findings, MUST return the task to implementation,
  and MUST block both `done` and dispatch to evidence until a later verify passes or an override is
  recorded.
- An override MUST name an approver, a scope and a reason, and the failed result MUST remain on the
  record beside it.
- **L3 additionally**: the verifier MUST NOT appear among the task's evidence authors, and
  consequential work MUST pass a **domain review** by a third party who neither implemented nor
  verified it.

| | |
|---|---|
| Enforcement | `selectVerifier`, `completeStage` (verify, domain_review), `failVerification`, `overrideVerificationGate`, `selectDomainReviewer` |
| Violation | refusal; the task stays where it is |
| Evidence | `a verification PASS must carry its witness`, `an L3 verifier may not also be an author of the evidence`, benchmark rows 2-3 and 6 |

## 6. Evidence Contract

**Every completion claim MUST carry evidence, and the evidence MUST carry its grade.**

| Grade | Meaning | The engine requires |
|---|---|---|
| E1 | reproducible: someone else can re-run it | `command`, `exitCode`, `revision` |
| E2 | same-system peer check | `checkedBy`, and it MUST differ from the recording agent |
| E3 | self-report | nothing further - this is what a bare sentence becomes, labelled |
| E4 | planned | `plan` or `target` |

- An ungraded sentence MUST be recorded as E3 with a note, so it can never borrow E1's voice.
- L2 and L3 MUST NOT reach `done` without at least one graded record; L3 MUST have an E1.

| | |
|---|---|
| Enforcement | `normalizeEvidence`, `completeStage` (evidence) |
| Violation | refusal; nothing is stored |
| Evidence | `E1 evidence carrying explicit nulls is refused`, `the CLI cannot record an E1 without its fields` |
| Honest limit | E1 is a **structural** check, not provenance: the engine confirms the fields are
  present, not that the command ran (F-012). A runner-generated E1 is the fix and is not built. |

## 7. Approval Contract

**An external action MUST NOT be dispatched until an approval covering it is recorded.**

- Approval is per task and per scope; the scope MUST name the action's declared target (or its kind).
- An approval for one environment MUST NOT unlock another: "approved for staging" does not
  authorise a production deploy.
- Only an explicit approval record unblocks the action. Passing verification does not.

| | |
|---|---|
| Enforcement | `nextDispatch` (approval + scope check), `approveExternalAction` |
| Violation | refusal; no argv is returned at all |
| Evidence | `dispatch refuses an unapproved external action`, `an approval scope must cover the action it unlocks`, benchmark row 5 |
| Honest limit | The approver is an unauthenticated string (F-003), and the queue is a plain JSON
  ledger (F-011). This is a discipline with a record, not an authorisation server. |

## 8. Recovery Contract

**Failure MUST be bounded, visible and recoverable - never an unbounded retry.**

- After **three** failed verifications (policy: `policy.maxVerificationAttempts`, set with
  `init --max-attempts`) the task MUST become `blocked`, and a blocked task MUST refuse
  claims, completions and approvals until a coordinator recovers it.
- Recovery MUST be an explicit, recorded act; a blocked task MUST NOT resume by itself.
- Every refusal MUST exit non-zero. A task that cannot be dispatched MUST NEVER be reported as a
  success.

| | |
|---|---|
| Enforcement | `failVerification`, `recoverTask`, CLI exit codes |
| Violation | `blocked` status; subsequent claims refused |
| Evidence | `three failed verifications block the task instead of retrying forever`, benchmark row 4 |

---

## Conformance

An implementation conforms if, for its own roster and storage, it refuses every operation the
contracts refuse. `bench/protocol-benchmark.mjs` is the conformance pressure test: six failure
modes, three coordination models, and a table that must show zero for the protocol column. Run it
with `node bench/protocol-benchmark.mjs`; it needs no dependencies and calls no model.

This repository is the reference implementation. The contracts are deliberately stated in terms of
**operations and observed behaviour** rather than of this CLI, so another host can implement them
over its own storage and prove conformance with the same benchmark.

---

## Licence

This specification is licensed under Creative Commons Attribution 4.0 International (CC BY 4.0):
implement it, republish it, adapt it, with attribution. The reference implementation in this
repository is licensed under Apache-2.0. See LICENSE, NOTICE and LICENSE-SPEC.
