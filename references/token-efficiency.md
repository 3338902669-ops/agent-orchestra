# Token and Cost Efficiency

Lower cost without lowering correctness. Cost control never justifies skipping a gate: the independence of the verifier, the evidence grade, and the approval requirement are not tradeable.

## Tiers

`micro`: coordinator plus one focused check. `standard`: coordinator, implementation worker, verification worker, acceptance. `high-assurance`: standard plus independent or domain review and failed-gate replay. Map risk labels to tiers in configuration, and never silently downgrade an important task: the intake-gate answers (see `references/important-task-intake.md`) set the floor, not the ceiling.

## Rules

1. Keep **one canonical task packet**; do not copy full history into every prompt.
2. Summarize completed stages as facts, decisions, files, and evidence — not as narrative.
3. Reference paths and sections instead of pasting large files.
4. Require bounded JSON or short reports.
5. Parallelize independent read-only checks; do not duplicate purpose.
6. Cache stable discovery and tests by revision or hash.
7. Stop exploration once all criteria have fresh evidence.
8. Escalate model strength only for ambiguity, architecture, failed gates, or acceptance.
9. **Dispatch once per task.** The same task dispatched to two workers is duplicated spend and two writers. Routing is deterministic (see `references/anti-patterns.md`, pitfall 7).
10. **One primary writer per resource.** Concurrent editors of the same file waste tokens twice: on the duplicate edit and on resolving the conflict.
11. **Send the verifier criteria and the changed-resource list**, not the implementation transcript. The verifier needs to reproduce, not to re-read.
12. **Cheap discovery, expensive judgement.** Cheap models for inventory, extraction, formatting, and mechanical checks; strong models for ambiguity, architecture, adversarial review, and acceptance.

## What must never be compressed

Requirements, definition of done, non-goals, permissions and write scopes, forbidden actions, secret-handling rules, exact error text, code, paths, URLs, hashes, changed-resource lists, acceptance criteria, evidence entries and their **grades**, verifier identity, approval scope, and unresolved risk.

Compressing any of these converts a verification into a guess.

## Cost of a bad report

A claim without a grade (E1-E4) is repaid later with interest: re-discovery, re-verification, and re-work by an agent that trusted it. Budget for evidence once, at the moment it is produced; see `references/evidence-grading.md`.

## Reporting

When telemetry exists, report calls, retries, cache hits, model tiers, and escalation reasons. When it does not, say that telemetry is unavailable instead of estimating. Never present an estimate as a measurement.