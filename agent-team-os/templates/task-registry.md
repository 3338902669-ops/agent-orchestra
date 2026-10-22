# Task Registry

<!--
  One entry per non-trivial task, created before work starts.
  Only the task owner (or the coordinator) updates a row.
  The verifier adds the verdict to the Evidence anchor / notes, or a linked review.
  A task is `done` only with an evidence anchor attached.
  Work directory for this deployment: {{WORK_DIR}}
-->

| ID | Task | Owner | Verifier | Status | Evidence anchor |
|---|---|---|---|---|---|
| T-001 | <short imperative description> | {{BUILDER_NAME}} | {{VERIFIER_NAME}} | planned | — |
| T-002 | <short imperative description> | {{OPERATOR_NAME}} | {{VERIFIER_NAME}} | in-progress | ~/work/artifacts/<name> (hash: <short-hash>) |

## Status Vocabulary

Use exactly one of these values in the Status column:

- `planned` — registered, not started.
- `in-progress` — owner is actively working on it.
- `blocked` — cannot proceed; the blocker and who can unblock it must be noted with the entry.
- `in-review` — artifact delivered, awaiting verifier verdict.
- `done` — verifier verdict PASS or PASS_WITH_NOTES, evidence anchor attached.
- `cancelled` — withdrawn by the coordinator or human; note the reason and date.

## Notes

<!-- Per-task notes that do not fit the table: blockers, verdicts, approval records.
     Format: - T-001 (2026-01-15): <note, with evidence anchor where relevant> -->
