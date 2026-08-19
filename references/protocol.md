# Execution Protocol

## Discover
Collect only routing metadata. Minimum fields: agent id, model, tools, read/write permissions, specialties, cost tier, and availability. If introspection is unavailable, request a compact capability manifest matching agent-manifest.schema.json.

For each role, score every agent from 0 to 3 using direct tools, permissions, specialties, availability, and prior evidence. Select the highest score, then prefer lower cost and lower contention. Require at least three distinct available agents before automatic routing; otherwise ask for manual assignments.

## Classify
Routine uses a short path. Important requires a plan, ownership lock, independent verification, and acceptance evidence. Critical additionally requires domain review and human approval for external or irreversible actions.

## Specify
Record objective, definition of done, scope, non-goals, inputs, target resources, baseline revision, constraints, risks, forbidden actions, tests, owner, and verifier.

## Implement
Acquire a per-resource lock. The implementer changes only owned resources. Reviewers may create isolated tests or reports, not overwrite the primary writer. Preserve a recoverable baseline before risky edits.

## Verify
Give the verifier acceptance criteria and changed-resource list, not an unfiltered transcript. Require reproducible tests, boundary cases, regression checks, and runtime evidence when behavior matters. Findings include severity, reproduction, expected, actual, resource, and owner.

## Accept
The coordinator maps evidence to every criterion and records residual risk. States: accepted, needs_revision, blocked, awaiting_user_approval. Deploy, publish, send, delete, and production changes always require explicit user approval.

## Stop Conditions
Stop on ownership conflict, unrecoverable baseline, material ambiguity, release-blocking finding, missing evidence, secret requests, or absent external-action approval.
