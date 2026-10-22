# Team Roster

<!--
  Single source of truth for seats, ownership, invocation, and mail identity.
  Only the coordinator writes this file (single-writer rule).
  Work directory for this deployment: {{WORK_DIR}}
  Example domain for documentation examples: example.com
-->

| Seat | Role | Owns (resources) | Invocation | Mail identity |
|---|---|---|---|---|
| {{COORDINATOR_NAME}} | coordinator | Roster, task registry, human interface, final reporting | Direct session with the human | {{COORDINATOR_NAME}} |
| {{BUILDER_NAME}} | builder | Build artifacts under `~/work/artifacts/` | Coordinator dispatch via mailbox thread | {{BUILDER_NAME}} |
| {{VERIFIER_NAME}} | verifier | Verification reports under `~/work/reviews/` | Coordinator dispatch via mailbox thread | {{VERIFIER_NAME}} |
| {{OPERATOR_NAME}} | operator | Recurring jobs, monitoring state under `~/work/ops/` | Scheduled trigger or coordinator dispatch | {{OPERATOR_NAME}} |
| {{DISPATCHER_NAME}} | dispatcher | Mail routing, doorbell state, digests under `~/work/dispatch/` | Mailbox / doorbell event | {{DISPATCHER_NAME}} |

## Rules of Engagement

- The coordinator is the single human-facing entry point. Other seats do not report to the human separately.
- One owner per resource. Non-owners propose changes; the owner writes.
- Cross-seat requests go through the mailbox with a thread ID, not ad hoc side channels.
- Every handoff carries an evidence anchor: source path, content hash, or raw output. No artifact = no conclusion.
- The verifier is never the implementer of the artifact it reviews, and does not fix artifacts under review.
- Outward or irreversible actions (send, publish, delete, deploy, pay, change settings) need per-item human approval. Review-passed is not delivery.
- Ownership changes take effect only when recorded here with a date in the daily log.
- Vacant seats are marked `vacant` in the Seat column — never silently omitted.
