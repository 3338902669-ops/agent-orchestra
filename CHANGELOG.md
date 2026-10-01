# Changelog

All notable changes to this project are documented here. Format follows Keep a Changelog; versioning follows SemVer.

## [2.5.1] - 2026-10-02

A verification pass that compared the specification against the runtime found two release blockers and
three fidelity gaps. Each was reproduced before being fixed.

### Fixed
- **The frontmatter did not parse, and the gate said it did.** `description` was written as a plain
  YAML scalar containing ": ", which YAML reads as a nested mapping - GitHub rendered "mapping values
  are not allowed in this context". The gate checked for the presence of `name:` and `description:`
  with a regex, so it reported PASS on a document no parser would accept. The description is now a
  block scalar, and `scripts/check-frontmatter.mjs` PARSES the subset of YAML a frontmatter may use
  (plain scalars containing ": " are rejected with a line number). The self-test now includes that
  exact mutation, so the false qualification cannot return.
- **The L2 evidence floor was documented but not enforced.** `completeStage` tested only whether the
  evidence list was non-empty, so an L2 task carrying a single E3 self-report reached `done`, while
  the standard promised E1 or E2. The floor is now a table (L1 any grade, L2 E1/E2, L3 E1) with
  tests for the refusal and the two ways through.

### Changed
- **Approval gates the external step, not the task.** Blocking every dispatch of a task that carries
  an external action stopped internal work too; the step is declared by `externalAction.at`
  (default `implement`) and only that step waits for approval.
- **The approval scope is matched structurally.** It must EQUAL the action's target (or kind); a
  substring test let "not production" unlock production.
- **The domain reviewer must be domain-qualified.** `selectDomainReviewer` used to fall back to any
  third-party verifier and record `fallback: true`, which quietly downgraded "reviewed by someone who
  knows this domain" to "reviewed by someone else". It now fails closed.
- **Roster lookups use `Object.hasOwn`.** A route named `constructor` resolved through the prototype
  chain and handed the task to a non-existent agent (F-005).
- **`scripts/install.sh` shipped with CRLF endings**, so `bash -n` failed on the published ZIP. Both
  installers are LF, the gate checks line endings, and CI runs `bash -n` on a fresh checkout.

Gate: 13 steps. 87 engine tests, 8 acceptance, 8 handoff.

## [2.5.0] - 2026-10-02

### Added
- AGENT-ORCHESTRA-PROTOCOL.md: eight contracts (Task, Resource, Ownership, Handoff, Verification,
  Evidence, Approval, Recovery), each naming the code that enforces it, the behaviour on violation,
  the test that pins it, and its honest limit. Stated in terms of operations and observed behaviour
  rather than of this CLI, so another host can implement it and prove conformance with the same
  benchmark.
- bench/protocol-benchmark.mjs: six failure modes through three coordination models (single agent,
  naive multi-agent, this engine) with deterministic actors and no model calls. The protocol column
  is zero for five of them and the policy ceiling for the sixth. The gate now RUNS it and fails if
  any row moves, so the published table cannot drift from reality.

### Changed
- **Licence: MIT to Apache-2.0 for the code, CC BY 4.0 for the specification.** A protocol is meant
  to be implemented by others, which needs an explicit patent grant (Apache-2.0) and a specification
  licence that permits republication with attribution (CC BY 4.0). NOTICE and LICENSE-SPEC added.
- Positioned as a protocol rather than a skill: the README leads with what agents may and may not do,
  and the repository description follows.

## [2.4.3] - 2026-10-02


### Fixed
- **A single character in the comparison veto caused SILENT MISSES.** The veto list held 比, 评, 排,
  选, 谁 and 哪, on the reasoning that "an over-match only costs a downgrade". That reasoning was
  wrong in the direction that matters: single characters live inside ordinary words, so the veto
  fired on 编排 (orchestrate), 安排 (arrange), 比如 (for example), 选一个 (pick one) and 谁来做 (who
  does it). A false veto is not a downgrade - it is a silent miss of a real request, the worst
  outcome this filter can produce. Reported twice by an independent reviewer before it was fixed.
  The markers are now phrases that keep the comparison meaning (比较/对比/评测/排名/选哪个/谁更)
  without swallowing the coordination vocabulary.
- **编排 was a keyword AND a veto match**, so the clearest possible Chinese request ("编排这几个
  agent") never engaged: the veto suppressed it and the keyword could not fire. 编排 was added to
  the coordination acts and the keyword list, and the veto no longer contains 排.
- **A verb keyword with no subject now stays silent instead of surfacing.** "k8s 编排文件" is about
  a file; "编排这几个 agent" is a request. `keywords_requiring_subject` lists the verb keywords that
  need an agent or artifact subject, while topic phrases ("independent verification") still surface
  for the caller to judge. Without this, adding 编排 as a keyword would have made every k8s manifest
  request look like orchestration.
- The config comment that claimed over-matching only costs a downgrade now states the real trade-off.

### Changed
- Activation cases: 78 -> 83 (6 engage / 56 surface / 21 silent). The five sentences this review
  reported are now permanent cases, so the regression cannot come back quietly.

## [2.4.2] - 2026-10-02


A second independent review measured the gap between what the doctrine says and what the engine
enforces, and found five rules that were documentation rather than invariants. All five were
reproduced before being fixed, and each now has a test.

### Fixed
- **An unapproved external action could be dispatched.** `nextDispatch` reported
  `externalActionApproved: false` and still returned a runnable argv, so a host adapter that
  executed the command would have bypassed approval. Dispatch now refuses it, and the approval has
  to name an approver and a scope before anything is handed back.
- **Single-writer was per task, not per resource.** Two tasks could hold the same file. A task now
  declares its resources (`create --resources src/a.ts,src/b.ts`) and a claim is refused while
  another live task holds an overlapping one, naming the holder.
- **A verification PASS needed no evidence.** The verifier could complete the verify stage with
  nothing and the task moved on. A PASS must now arrive with its witness. The witness is stored on
  the verification record, not in the task's evidence list: storing it as evidence made the verifier
  an evidence author, which contradicted the L3 rule that the verifier produced none of it.
- **Three failed verifications retried forever.** `blocked_after_rounds: 3` existed only in the
  config. The third failure now sets the task to `blocked`, which refuses further claims until a
  coordinator recovers it.
- **An important task could self-verify at L1.** "Important work requires an independent verifier"
  and the L1 shortcut contradicted each other; importance now wins, and the record says which
  happened.

### Known limits, newly registered
- F-012: E1 is a structural check, not provenance. The engine verifies that a command, an exit code
  and a revision are present, not that the command ran. Generating E1 from a runner rather than
  accepting it from an agent is the fix, and it is not implemented.
- F-013: `config/agents.example.yaml` documents the roster; the runtime roster comes from
  `init --roster <file.json>`. Editing the YAML does not change routing.

## [2.4.1] - 2026-10-02

### Fixed
- **E1 evidence could be recorded with no command, no exit code and no revision.** The CLI filled
  absent flags with `null` while the validator only rejected `undefined` and the empty string, so
  `--evidence-grade E1 --evidence "tests ok"` was accepted and the task reached `done` carrying an
  "E1" whose three required fields were all null. The library path was fine, which is why the tests
  passed while the CLI did not: the check existed but did not hold on every way in. Both sides fixed
  (`== null` in the engine, no manufactured nulls in the CLI) and the CLI path now has its own test.
- **An L3 task did not trigger the intake gate.** `create --rigor L3` without `--important` silently
  recorded `single / skip / skip`, contradicting "never default these on the user's behalf". L3 is
  consequential, so the three choices are now required for it, and `important` is set accordingly.

## [2.4.0] - 2026-10-01

### Changed
- **Activation is a conservative three-valued filter, not a keyword list.** `exit 0` (engage) requires a
  curated, self-anchored keyword phrase, an act of coordinating in the sentence, and no comparison,
  evaluation or question marker. Everything else that looks like coordination returns `exit 3`
  (POSSIBLE) and the caller decides; a plain comparison returns `exit 1`. Because a pattern can no
  longer engage on its own, an unlisted synonym cannot produce a wrong engage either - it downgrades
  at worst. Thirteen adversarial verification rounds produced 78 cases (4 engage / 53 surface /
  21 silent), every one now permanent in `scripts/activation-cases.json`.

### Added
- `references/verification-standard.md`: ten requirements distilled from IEEE 1012, ISO/IEC/IEEE 29119,
  DO-178C/DO-330, NIST SSDF and ISO 19011, each naming the check that enforces it, plus rigor levels
  L1-L3, an independence matrix and an honest statement of the limits.
- `scripts/gate.mjs`: one command that CI and a local machine both run, so the checks cannot drift.
  Evidence lands in `evidence/latest.json` bound to the git revision and the SHA-256 of key artifacts,
  every step carries its exit criterion, and the runner **injects ten known faults that it must
  reject** before reporting PASS. A gate that has never been observed to fail is not evidence.
- `KNOWN-FINDINGS.md`: accepted defects with severity, owner, disposition and a review date; the gate
  refuses an expired waiver or a finding without an owner.
- `scripts/check-handoff.mjs` and eight tests: the handoff record is checked rather than described -
  four files, a live entry carrying status/owner/current step/next step/evidence, a recognised status
  value, and a positive precedence claim.
- Rigor levels as engine state: `create --rigor L1|L2|L3`. L2 and L3 cannot reach `done` without a
  graded evidence record, L3 additionally requires E1 evidence and a verifier that produced none of
  it, and an external action can never be filed as L1.
- Evidence grading is enforced: a bare string is stored as E3 with a note, and `--evidence-grade E1`
  is refused unless it carries `--evidence-command`, `--evidence-exit-code` and `--evidence-revision`.
- The task packet is real state (`--spec`, `--acceptance`, `--non-goals`); the specify stage cannot
  end without the first two.
- `scripts/activation-cases.json`: one case table shared by the acceptance test and the verifier's
  evidence collector, so the two cannot drift apart.
- `references/zh-contrast.md`: the Chinese one-line summaries moved out of SKILL.md, cutting 732
  characters (3.7%) from what is always loaded.

### Fixed
- **A shipped config that the engine rejects.** `intake_gate` documented `security_scan: [yes, no]`
  while the engine only accepts `planned | skip`. The validator now imports the engine's enums and
  compares every value instead of checking that some text appeared somewhere.
- **The self-test could pass for the wrong reason.** A mutation wrote its result to one file while the
  check read another, so it was rejected because a directory was empty rather than because the change
  was detected. Every mutation now declares the file it mutates and is refused if that file is absent.
- **A negated precedence claim satisfied the handoff check** (`不优先于` matched a substring test for
  `优先于`); only a positive assertion counts now.
- Documents are checked against reality: the changelog and the gate's own criterion string both
  claimed 65 tests while the suites held more. A `claims` step now compares stated test counts with
  the suites.
- Concurrent queue writes lost work: the queue is written through a temp file plus `rename()`, every
  command holds an exclusive `<queue>.lock` across read-modify-write, and a stale lock is taken over.

### Tests
- 76 engine tests, 8 acceptance tests, 8 handoff tests, 78 activation cases; a 10-step gate with ten
  injected faults.

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
