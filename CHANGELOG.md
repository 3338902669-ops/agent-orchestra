# Changelog

All notable changes to this project are documented here. Format follows Keep a Changelog; versioning follows SemVer.

## [2.1.0] - 2026-10-01

The verifier is now chosen by capability score, verification is a real gate, and the
roster is data of any size - three agents, twelve agents, any names.

### Added
- **Capability-scored verifier selection.** The verifier is the highest-scoring eligible agent for `verify`, with the implementer always excluded; ties break on a capability match, then lower cost, then agent id order. If nobody is scored above 0 the run fails closed instead of pretending an unscored agent can verify.
- **Verification gate.** `fail --criteria/--findings` records the failure and returns the task to `implement`; the task can then neither reach `done` nor be dispatched to `evidence` until a verify passes. A deliberate `override --by --scope --reason` is the only way past it (all three required), and the failed result is kept next to the override.
- `task.verification` record: status, attempts, blocked, lastResult, criteria, findings, who and when, override.
- Dispatch records now carry `verificationStatus`, `verificationBlocked` and `verificationOverride`.
- `DEFAULT_ROSTER` and `validateRoster()`: the roster is data (`agents` + optional `routes`), validated on load, any number of agents.
- `selectAgent()`, `ownerFor()`, `selectVerifier()`, `implementerForType(type, roster)`; `init --roster <file.json>`; `fail` and `override` CLI commands.
- `DEFAULT_COMMAND_TEMPLATE`: any agent id a roster declares is dispatchable, so teams whose agents are not called generalist/frontend/specialist work unchanged.

### Changed
- Stage owners are resolved from the roster instead of a hardcoded routing table: a roster that names no usable agent for a stage is rejected loudly rather than mis-routed.
- `verifierFor('frontend')` is now `specialist` (score 3) rather than a fixed toggle - verification selection is scored, not alternating.
- State schema is version 4. Older state files without a roster fall back to the default.

## [2.0.0] - 2026-10-01

Coordinated operation hardened end to end: the protocol now carries a deterministic queue, an intake gate, graded evidence, and an explicit "verification is not authorization" boundary.

### Added
- Evidence grading E1-E4 (reproducible / peer-checked / self-asserted / planned) with required labels and re-verification after context compaction.
- Important-task intake gate: before the first write, dispatch or verification, the user is asked for execution mode (solo vs collaborative), security scan (yes/no) and independent verification (yes/no). Never defaulted.
- Verifier != implementer as a hard constraint; an author's self-check is E3 and cannot certify the work.
- Machine-readable task queue: `scripts/orchestrator/orchestrator.mjs` (init / status / create / claim / complete / dispatch / approve / recover) with a `specify -> implement -> verify -> evidence -> done` stage machine, per-task claim locks, capability routing, and recovery.
- Dry-run-only dispatch: the queue prints the command and never launches an agent; a non-dispatchable task fails with a non-zero exit code instead of exit 0.
- Per-task, per-scope `approve` records as the only path for external and irreversible actions.
- New references: routing-and-roles, evidence-grading, task-queue, important-task-intake, anti-patterns.
- Companion skill `agent-team-handoff/` documented in the root SKILL.md (cross-session handoff discipline).
- Conflict rule: the human-readable shared task record outranks the queue; on disagreement, stop and follow the record.

### Changed
- `config/agents.example.yaml` (v2) adds intake_gate, queue, evidence and approval blocks; keyword list extended with handoff / task queue / verifier terms.
- SKILL.md restructured around five non-negotiables, the pipeline, evidence grading, stop conditions and the anti-pattern table.
- External-action wording tightened: a passed verification gate is explicitly not a shipping authorization.

## [1.2.0] - 2026-08-23
### Added
- Companion skill `agent-team-handoff/`: shared handoff record, five handoff rules, state machine, single-writer boundaries, memory sync, and the eight coordination anti-patterns.

## [1.1.0] - 2026-08-20
### Added
- Configurable activation: global / keyword-triggered / manual modes.
- Keyword trigger detector script (scripts/detect-trigger.mjs) with exclude-keyword veto.
- Validation now requires a valid activation block.

## [1.0.0] - 2026-08-20
### Added
- Initial public release of the Multi-Agent Orchestration Skill.
- Capability-first agent discovery and role routing (coordinator, implementer, verifier, environment specialist, domain reviewer).
- Single primary writer per file/resource with explicit ownership lock.
- Risk classification: routine / important / critical with configurable pipelines.
- Independent verification stage with evidence-gated completion.
- Explicit user approval for external actions (deploy, publish, send, delete, production change).
- Token efficiency policy: compact task packets, model tiering, parallel read-only checks, caching, bounded outputs.
- Configuration template, agent manifest JSON schema, and local validation script.
