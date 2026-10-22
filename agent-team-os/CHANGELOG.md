# Changelog

## 0.1.2

Security fix round driven by an independent security review of
0.1.1. The operating pattern is unchanged; the shipped templates
and the checker now enforce the properties the docs already
claimed.

- **Doorbell wake execution (critical).** The reference doorbell no
  longer builds a command string and evaluates it. A wake
  specification is a JSON array of arguments (executable first),
  invoked directly — no shell, no `Invoke-Expression`. Only
  `{prompt_file}` and `{id}` may be substituted into the array; the
  event id is validated numeric before use, and event data (sender,
  subject) is written only into the prompt file's text, never into
  a command. The doorbell reference and the placeholder registry
  state this as a security invariant.
- **Doorbell token exposure.** The watcher process no longer holds
  the bearer token. Each events read spawns the mailbox CLI as a
  child process, reads the token file fresh, and places the token
  only in that child's environment.
- **Transport scheme is a setting.** New `{{MAIL_SCHEME}}`
  placeholder used by the mail helper and the interface contract:
  `https` wherever the server offers it; plaintext `http` is a
  documented deployment precondition restricted to trusted
  networks, because the bearer token travels in the header.
- **Denylist loading is fail-closed.** A configured list (via
  `AGENT_TEAM_OS_DENYLIST` or a present `denylist.local.txt`) that
  is missing, unreadable, undecodable, or empty aborts the run
  with `E_DENYLIST_CONFIG` instead of silently falling back to the
  example list. Lists are read as utf-8-sig (a BOM cannot poison
  the first term), the scan exclusion matches denylist files by
  resolved path wherever they live, and a hit's mask leaks neither
  the term's first character nor its exact length.
- **Scratch copies are deleted.** The ERROR and REPRO suites remove
  their temporary directories when they finish (a fixture copy can
  contain the active denylist and a verbatim banned term); a
  leftover directory is itself a finding
  (`E_ERROR_TEMP_RESIDUE` / `E_REPRO_TEMP_RESIDUE`).
- **License appendix.** The Apache appendix in `LICENSE` is back to
  its bracketed template form, consistent with `NOTICE`.
- **CI hardening.** Workflow actions are pinned to commit SHAs and
  the workflow declares minimal `permissions: contents: read`.

## 0.1.1

Fix round driven by an external review of 0.1.0. No behaviour of the
operating pattern changed; the package now documents and proves what
it previously only claimed.

- **External dependency made explicit.** QUICKSTART gains a Step 0:
  the mailbox server is not shipped in this package. New
  `references/mail-server-interface.md` specifies the full server
  contract (tool surface, HTTP JSON-RPC endpoint, bearer-token auth,
  project keys, receipts, delivery-event stream, conformance
  checklist) precisely enough to choose or implement a compatible
  server. QUICKSTART Step 4, README, bootstrap Phase 1, and
  comms-mail now point at it.
- **License.** Added `LICENSE` (Apache License 2.0, full text) and
  `NOTICE`, matching the sibling project.
- **Checker correctness.** Argument parsing rewritten: options and
  the positional ROOT may appear in any order, and
  `check.py --category COMPAT` without a ROOT now runs against the
  package root instead of mistaking the category value for a path.
- **Error behaviour is a real suite.** The new ERROR suite (fifth
  suite) builds a clean control copy plus three single-defect
  poisoned copies — banned term, broken reference, declared-name
  mismatch — and asserts each is rejected with the expected named
  error. `--self-test` remains as an alias for running only this
  suite. Full runs now end with an ALL CHECKS PASSED line.
- **Claimed checks implemented.** Declared SKILL.md name must equal
  the package name; REPRO verifies required sections in instantiated
  templates and that two instantiations with the same sample values
  produce identical trees; COMPAT verifies seat roles are the five
  defined roles. verification.md was audited line by line against
  the code; claims without an implementation were removed.
- **Numbers fixed and guarded.** Placeholder count corrected from a
  stale partial list to the real count everywhere, and the hygiene
  suite now cross-checks numbers stated in the docs (placeholder
  count, suite count) against reality (claims check).
- **Denylist moved out of the package.** The checker no longer
  contains any real deployment terms, in any form. It loads its list
  at runtime from the `AGENT_TEAM_OS_DENYLIST` environment variable
  or a git-ignored `denylist.local.txt`; the package ships only
  `denylist.example.txt` with deliberately fake terms.
- **Negative triggers.** SKILL.md's frontmatter description now
  states the non-goals directly: adversarial or multi-tenant
  environments, and flows where a single message alone authorizes
  payment, deployment, or credential release.
- **CI.** `.github/workflows/check.yml` runs the checker on push and
  pull requests, using the bundled example list.

## 0.1.0

Initial release of the agent-team-os skill package: four-layer
operating pattern (layered memory, governance, identity mailbox,
event-driven doorbell), templates, compatibility matrix for five
agent types, single-agent multi-session mode, and the package checker
with hygiene, compatibility, usability, and reproducibility suites
plus a poisoned-fixture self-test.
