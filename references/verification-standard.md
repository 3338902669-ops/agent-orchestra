# Verification standard

This file is the contract the repository's own gate is held to. It exists because of a
specific failure: the shipped configuration contained values the engine rejects
(`security_scan: [yes, no]` against `planned | skip`), and the activation keyword list fired
on `k8s 编排` while missing `两个 AI 改同一个文件` - and every check was green through all of
it. The checks were not wrong about what they measured; they measured the wrong things,
and no check had ever been shown to fail.

The requirements below are distilled from published engineering standards rather than
invented here. Each one names where this repository enforces it, so a claim of compliance
can be re-run instead of believed.

## 1. The ten requirements

| # | Requirement | Source standard | Enforced by |
|---|---|---|---|
| R1 | Rigor is selected by impact, not by habit | IEEE 1012 integrity levels; IEC 61508 SIL; ISO 26262 ASIL; ASVS L1-L3; SLSA levels | `references/verification-standard.md` section 2, applied per task in `references/important-task-intake.md` |
| R2 | The verifier is not the producer, and independence rises with impact | DO-178C independence objectives (Tables A-1..A-10) | `verification_gate.implementer_excluded`, `unscored_verifier: fail_closed` in `config/agents.example.yaml`; `selectVerifier()` in `scripts/orchestrator/lib.mjs` |
| R3 | Each stage declares its work products | ISO/IEC/IEEE 29119-3 (test documentation) | task packet + evidence records in `references/task-queue.md` |
| R4 | Evidence names the revision it applies to | IEEE 1012 V&V reporting; configuration management | `scripts/gate.mjs` records `revision` plus per-artifact SHA-256 in `evidence/latest.json` |
| R5 | Entry and exit criteria are explicit, and "ran" is not "passed" | ISO/IEC/IEEE 29119-2 test processes | every step in `scripts/gate.mjs` carries a `criterion` string in the evidence record |
| R6 | Verification includes negative and boundary cases | 29119-4 test design techniques | `MUST_NOT_ENGAGE` table in `scripts/acceptance.test.mjs` |
| R7 | A tool that produces verification evidence is itself verified | DO-330 tool qualification | `--self-test` in `scripts/gate.mjs`; the config gate imports the engine enums instead of trusting text (`scripts/validate-config.mjs`) |
| R8 | Known defects are registered with an owner and a review date | NIST SP 800-53 CA-5/CA-7; anomaly disposition | `KNOWN-FINDINGS.md` |
| R9 | The gate must be shown able to fail | ISO 19011 assessment evidence; IIA assurance independence | `scripts/gate.mjs --self-test` injects known-bad input and requires rejection before reporting PASS |
| R10 | Evidence is machine-readable and regenerable | ISO 9000 objective evidence | `evidence/latest.json` (`agent-orchestra/gate-evidence@1`) |

## 2. Rigor levels

Rigor is chosen from the blast radius of the change, not from how interesting it is. The
level decides which activities are mandatory - the same way an integrity level decides which
V&V tasks apply.

| Level | Applies when | Mandatory |
|---|---|---|
| **L1 - local** | one file, no shared interface, reversible | tests for the changed unit; evidence may be self-produced (E3 at worst, E1 preferred) |
| **L2 - shared** | multiple files, shared config, or user-visible behaviour | verifier must differ from the implementer; positive **and** negative acceptance cases; evidence graded E1 or E2 |
| **L3 - consequential** | irreversible, published, deployed, or touching credentials/permissions | independent verification plus a machine-produced artifact (scan report, gate evidence); an explicit approval record naming approver, scope and reason; failure record kept even when overridden |

## 3. Independence

| Level | Who may verify |
|---|---|
| L1 | the implementer, or anyone else |
| L2 | any agent except the implementer, selected by capability score |
| L3 | an agent that took no part in the work, plus a tool that produces the raw evidence |

Self-verification is never independent, and "another agent looked at it" is not independence
unless that agent neither wrote nor decided the work.

## 4. What evidence must carry

An evidence record is not a sentence. At minimum it names the criterion, the command, the
exit code, the key output, the revision, and who produced it. `E1` means someone else can
re-run it and get the same result; `E3` means only the producer checked. A bare string is
recorded as `E3` and labelled as such - it never borrows `E1`'s voice.

## 5. Honest limits

- The gate covers what can be checked mechanically in this repository. It does not prove the
  skill is useful, only that it is internally consistent and that its checks work.
- The self-test injects four known-bad configurations. It demonstrates the gate can fail; it
  does not prove the mutation list is exhaustive.
- Independence for L3 assumes the second agent is not sharing the first agent's context or
  model route. Same-model, same-context review is weaker than the label suggests, and must
  be reported as such.
