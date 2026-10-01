# Changelog

All notable changes to this project are documented here. Format follows Keep a Changelog; versioning follows SemVer.

## [2.3.0] - 2026-10-01

### Added
- **A verification standard the repository is held to** (`references/verification-standard.md`):
  ten requirements distilled from IEEE 1012, ISO/IEC/IEEE 29119, DO-178C/DO-330, NIST SSDF and
  ISO 19011, each naming where it is enforced, plus rigor levels L1-L3, an independence matrix,
  and the limits of what the gate can prove.
- **`scripts/gate.mjs`**: one command that CI and a local machine both run, so the checks can no
  longer drift between the two. It emits `evidence/latest.json` bound to the git revision and
  the SHA-256 of the key artifacts, and every step carries its exit criterion.
- **The gate tests itself.** Known-bad configurations are injected before a PASS is reported,
  and a gate that accepts any of them fails. A gate that has never been observed to fail is not
  evidence (ISO 19011 / DO-330 tool qualification).
- **`KNOWN-FINDINGS.md`**: accepted defects with severity, owner, disposition and a review date,
  checked by the gate so a waiver cannot live forever.

### Fixed
- **Activation matched terminology instead of intent.** The keyword list fired on `帮我写个 k8s 编排文件`,
  `这个函数加个 verifier 校验入参`, `项目验收报告`, `成本优化` and `团队分工`, while missing
  `两个 AI 改同一个文件`, `几个 agent 同时改代码冲突了`, `换个助手继续` and every other way a
  person actually asks for this. Generic words were removed and intent/spoken-variant regex
  patterns added; both directions are now covered by an acceptance table in CI.
- **The config lied.** `intake_gate` documented `security_scan: [yes, no]` while the engine only
  accepts `planned | skip`, so following the shipped config produced an immediate error. The
  config validator now imports the engine's enums and compares every value instead of checking
  that some text appeared somewhere.

## [2.2.1] - 2026-10-01

### Fixed
- **Concurrent queue writes could lose a task.** Every command read the queue, computed,
  then wrote it back with a plain writeFileSync: two processes running at the same time
  both read the same revision and the later write silently discarded the earlier one. The
  queue is now written through a temp file plus rename() - atomic, so a reader never sees
  a half-written queue - and every command holds an exclusive `<queue>.lock` across
  read-modify-write, so concurrent invocations serialise. A second writer waits briefly
  and then fails loudly with `locked by another process` instead of overwriting; a lock
  left by a crashed process is taken over once it is stale (10s), so a crash cannot wedge
  the queue. ORCHESTRATOR_LOCK_WAIT_MS tunes the wait. An optimistic revision check stays
  as a second line of defence.
- Tests: four processes creating tasks at once must all survive; a fresh lock must refuse
  the write; a stale lock must be recovered; and no temp or lock files may be left behind
  (65 tests at that release; the suite has grown since).

## [2.2.0] - 2026-10-01

Merged into a single skill. The cross-session handoff discipline that shipped as the
companion skill `agent-team-handoff/` is folded into the root skill, which is renamed
`agent-orchestra`; the repository no longer publishes two skills.

### Added
- `references/handoff.md`: the authoritative handoff detail - the four shared records and when each is updated, the five iron rules with executable checks, the task state machine (queued / in-progress / handoff-wait / done, plus blocked only after three unresolved rounds) and its mapping to the queue stage machine, single-writer ownership and conflict resolution, memory-sync rules, a minimal closed loop, and the cross-session/cross-tool checklist with a handoff entry template.
- The shared record and the five iron rules are now first-class clauses in `SKILL.md`, not a companion document: a "Handoff: the shared record" section states the four files, the iron rules, and the rule that the record outranks the queue.

### Changed
- Skill renamed `multi-agent-orchestration` -> `agent-orchestra`: one skill now covers both in-task coordination and cross-session/cross-tool handoff.
- The non-negotiables grew from six to seven: "read before acting, resume instead of redoing, and write progress down before switching" is now its own clause, and "the human-readable shared record outranks the queue" is stated as a numbered rule rather than a footnote.
- `agent-team-handoff/` is removed as a separate subdirectory; its content lives in `references/handoff.md` and the root `SKILL.md`.

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
