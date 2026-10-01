# Execution Protocol

The end-to-end sequence. Role definitions live in `references/routing-and-roles.md`; the stage machine and locks live in `references/task-queue.md`; the grade vocabulary lives in `references/evidence-grading.md`.

## Discover

Collect only routing metadata: agent id, model, tools, read/write permissions, specialties, cost tier, and availability. If introspection is unavailable, request a compact capability manifest matching `references/agent-manifest.schema.json`.

For each role, score every agent from 0 to 3 using direct tools, permissions, specialties, availability, and prior evidence. Select the highest score, then prefer lower cost and lower contention. Require at least three distinct available agents before automatic routing; otherwise ask the user for manual assignments.

## Classify

Routine uses a short path. Important requires a plan, ownership lock, independent verification, and acceptance evidence — and the **intake gate** (three recorded user choices) before the first write, dispatch, or verification; see `references/important-task-intake.md`. Critical adds domain review and explicit human approval for external or irreversible actions.

If the boundary is unclear, classify the task as important.

## Specify

Record objective, definition of done, scope, non-goals, inputs, target resources, baseline revision, constraints, risks, forbidden actions, acceptance tests, owner, and verifier. The task enters the queue at `specify` and cannot leave it until the packet is complete.

## Implement

Acquire the per-resource lock before the first write. The implementation worker changes only owned resources. Reviewers may create isolated tests or reports, not overwrite the primary writer. Preserve a recoverable baseline before risky edits. Record the changed-file list, the commands run, and their exit codes.

## Verify

Give the verification worker the acceptance criteria and the changed-resource list — not an unfiltered transcript. The verifier must be a different agent from the implementer. Require reproducible tests, boundary cases, regression checks, and runtime evidence when behavior matters. Findings include severity, reproduction, expected, actual, resource, and owner.

A release-blocking finding returns the task to `implement`; it does not advance.

## Evidence and accept

The coordinator runs the `evidence` stage: map evidence to **every** criterion, attach a grade to each entry, and record residual risk. Acceptance outcomes are `accepted`, `needs_revision`, `blocked`, or `awaiting_user_approval`; the queue moves to `done` only after the evidence entry is written.

A completion claim without criterion-linked evidence is not an acceptance. A passed verification is not a shipping authorization.

## Approve

Deploy, publish, send, upload, delete, and production or account changes always require explicit, scoped user approval, recorded per task and per scope. The intake gate does not grant it, and evidence does not substitute for it. Until approval exists, internal stages may proceed but the external step must not.

## Stop conditions

Stop on ownership conflict, unrecoverable baseline, material ambiguity, release-blocking finding, missing evidence, secret requests, absent external-action approval, or a verifier that was also the implementer.

Stopping is a valid outcome and must be recorded with the condition that caused it.