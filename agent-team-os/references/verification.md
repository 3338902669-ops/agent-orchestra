# Verification

Five verification suites, HYGIENE, COMPAT, USABILITY, ERROR, and
REPRO, are implemented by `scripts/check.py`. A suite passes only when
all of its criteria hold; any failure is reported as a named error,
all findings from all suites are listed in one run, and the exit code
is non-zero — see [error-handling.md](error-handling.md).

Run from the package root (options and the positional ROOT argument
may appear in any order; with no ROOT, the package root is used):

```bash
python3 scripts/check.py                  # all 5 suites
python3 scripts/check.py --category HYGIENE
python3 scripts/check.py --category COMPAT
python3 scripts/check.py --category USABILITY
python3 scripts/check.py --category ERROR
python3 scripts/check.py --category REPRO
python3 scripts/check.py --self-test      # alias: run only the ERROR suite
```

An unknown category or option is rejected with a named `E_USAGE`
error and exit code 2.

## HYGIENE — identifiers and claims

**Purpose:** the package contains nothing from a real deployment,
and the numbers the docs state are the numbers that are true.

Pass criteria:

- A banned-term scan over every file in the package finds zero hits
  (`E_HYGIENE_BANNED_TERM`). The term list is loaded at runtime from
  outside the shipped package: the file named by the
  `AGENT_TEAM_OS_DENYLIST` environment variable, or `denylist.local.txt`
  in the package root (git-ignored). Loading is fail-closed: a
  configured list that is missing, unreadable, undecodable, or empty
  aborts the run with `E_DENYLIST_CONFIG` and a non-zero exit — it
  never silently falls back. Only when nothing is configured at all
  is the bundled `denylist.example.txt` — deliberately fake terms —
  used, and the run prints a NOTE line saying so. If that bundled
  file is present but cannot be read, the run aborts with
  `E_DENYLIST_CONFIG` as well, under the same error discipline as
  a configured list. Lists are read as
  UTF-8 with an optional BOM (utf-8-sig). The one list file the
  loader actually loaded is excluded from the scan by its resolved
  path (wherever it lives — the env-configured file, a root
  `denylist.local.txt` the loader fell back to, or the bundled
  example list when nothing is configured), so the list never
  introduces the terms it bans. No file is excluded for its name
  alone: a
  root file that merely carries a conventional list name
  (`denylist.local.txt`, `denylist.example.txt`) but different
  terms is ordinary content and is scanned at full strength. A
  leftover copy of the active list in the package root under
  another name is excluded too, recognized by content — its
  parsed term set is identical to the active list's; files below
  the package root are always scanned. The NOTE line a run prints
  and any `E_DENYLIST_CONFIG` error name the list file by basename
  only, and a read failure is described by errno/strerror, never
  by the OS error string (which embeds the full path). No
  directory segment of the list file's path is echoed into logs;
  the file's own basename is printed, for operability, in the
  NOTE line and in the error line.
  A hit is reported with a mask that leaks neither the term's
  first character nor its exact length, only a coarse length
  bucket.
- Claims cross-check (`E_CLAIMS_PLACEHOLDER_COUNT`,
  `E_CLAIMS_SUITE_COUNT`): every numeric claim of the form
  "N placeholders" or "N suites" in the package's Markdown must equal
  the real values — the number of placeholders documented in
  [../templates/PLACEHOLDERS.md](../templates/PLACEHOLDERS.md) (21 placeholders)
  and the number of suites the checker runs (5 suites).

Any hygiene hit is a hard failure of the whole check run, regardless
of the other suites.

The rule the scan enforces: no real personal names, company names,
hostnames, network addresses, file paths from a real deployment,
tokens, or internal system names. Example content uses only role
names (coordinator, builder, verifier, operator, dispatcher), the
domain `example.com`, and generic paths such as `~/` or
`%USERPROFILE%\`.

## COMPAT — compatibility

**Purpose:** the compatibility matrix and the rest of the package
agree with each other.

Pass criteria:

- [adapters-compatibility.md](adapters-compatibility.md) exists and
  has a Compatibility matrix section (`E_STRUCTURE_MISSING`,
  `E_COMPAT_TYPE_UNCOVERED`).
- Every one of the five agent types — MCP-native, CLI, GUI desktop,
  API, File-only — has at least one matrix row.
- Every path-like reference in a matched row exists in the package
  (`E_COMPAT_MISSING_FILE`), and each type's rows reference at least
  two existing files (`E_COMPAT_TYPE_UNCOVERED`).
- Every seat role in use is one of coordinator, builder, verifier,
  operator, dispatcher (`E_COMPAT_ROLE_UNKNOWN`). This is checked in
  two places: the "Seat roles used with these adapters" declaration
  in the compatibility document, and the Role column of
  [../templates/roster.md](../templates/roster.md), the roster
  template the matrix wires every agent type to.

Failure examples: a row references a template that was renamed; a
roster row names a role outside the five.

## USABILITY — usability

**Purpose:** a new operator can follow the docs literally and every
pointer resolves.

Pass criteria:

- Every root-relative path referenced by [../README.md](../README.md)
  and [../QUICKSTART.md](../QUICKSTART.md) exists
  (`E_USABILITY_DEAD_PATH`).
- Every relative Markdown link in the package resolves to an existing
  file (`E_USABILITY_DEAD_PATH`).
- `SKILL.md` frontmatter is present and valid: it opens with `---`
  and contains non-empty `name:` and `description:` fields
  (`E_USABILITY_FRONTMATTER`), and the declared name equals the
  package name, `agent-team-os` (`E_USABILITY_NAME_MISMATCH`).
- All template placeholders follow exactly one format — `{{NAME}}`
  (`E_PLACEHOLDER_MALFORMED`) — and every placeholder used in
  `templates/` is documented in
  [../templates/PLACEHOLDERS.md](../templates/PLACEHOLDERS.md)
  (`E_PLACEHOLDER_UNDOCUMENTED`, `E_STRUCTURE_MISSING`).

Failure examples: QUICKSTART references a template that does not
exist; a template uses a single-brace placeholder; a placeholder
appears that PLACEHOLDERS.md does not document; the declared name
drifts from the package name.

## ERROR — error behaviour

**Purpose:** the checker itself obeys the reporting discipline it
enforces. This suite runs the checker, as a subprocess, against
scratch copies of the package (fixture runs disable the ERROR suite
inside themselves through an environment guard, so it does not
recurse).

Pass criteria:

- Clean control: a full run against an unmodified copy exits zero.
  If it does not, the suite reports `E_ERROR_CLEAN_CONTROL`.
- Three single-defect poisoned copies are each rejected with a
  non-zero exit and the expected named error
  (`E_ERROR_FIXTURE_MISS` if either fails):
  - one banned term (the first term of the active denylist) appended
    to a reference doc — must be caught as `E_HYGIENE_BANNED_TERM`;
  - one broken reference appended to QUICKSTART.md — must be caught
    as `E_USABILITY_DEAD_PATH`;
  - the declared name in SKILL.md replaced with a wrong name — must
    be caught as `E_USABILITY_NAME_MISMATCH`.
- A locked-list regression probe: a copy of the active list is
  placed in a directory named by the list's first term and held
  unreadable (an exclusive lock on Windows, mode 000 on POSIX).
  A run configured with that list must abort with
  `E_DENYLIST_CONFIG`, and the term must not appear in the
  output: no directory segment of the list's path is echoed (the
  locked file's own basename, `locked-list.txt`, is printed and
  carries no term). Where the current user cannot make a file
  unreadable, the probe reports itself skipped instead of passing
  vacuously.
- A locked-example regression probe: a scratch copy of the
  package with nothing configured (no environment variable, no
  `denylist.local.txt`) whose bundled `denylist.example.txt` is
  held unreadable the same way, staged under a directory named
  by the example list's first term. The run must abort with
  exit 2 and `E_DENYLIST_CONFIG` — the fallback read obeys the
  same error discipline as a configured list, with no raw
  traceback — and neither a term nor the example file's full
  path may appear in the output. Where the current user cannot
  make a file unreadable, the probe reports itself skipped
  instead of passing vacuously.
- Scratch copies are deleted when the suite finishes. A fixture
  copy can contain a verbatim banned term (the poison fixture), so
  a leftover scratch directory is itself a finding
  (`E_ERROR_TEMP_RESIDUE`). The active denylist is never copied
  into a fixture when it lives inside the package root: at a new
  path it would escape the resolved-path scan exclusion and be
  flagged by its own terms, so the copy step omits that one file —
  identified by the path the loader actually used, not by name.
  Root-level copies of the list under other names are omitted as
  well, recognized by their identical term set. The fixture runs
  load the list from a staged copy in the suite scratch directory
  (deleted with it), so they still check against the real terms
  rather than the bundled example list. Every other file is copied
  and scanned at full strength.
- In any run, a finding means a non-zero exit, each error is named,
  and all findings are listed rather than stopping at the first. A
  clean full run ends with the line ALL CHECKS PASSED (see PASS
  output below); a failing full run ends with CHECKS FAILED.

`--self-test` runs only this suite.

## REPRO — reproducibility

**Purpose:** the templates actually instantiate into a working
skeleton.

Pass criteria:

- Templates are instantiated with the checker's sample values for all
  documented placeholders into a scratch directory; the package
  itself is not modified. The scratch directory is deleted when the
  suite finishes — a leftover is itself a finding
  (`E_REPRO_TEMP_RESIDUE`).
- No leftover placeholders remain anywhere in the instantiated tree:
  any `{{...}}` still present is reported as
  `E_REPRO_LEFTOVER_PLACEHOLDER` (a documented placeholder that
  survived substitution) or `E_REPRO_NO_SAMPLE` (a placeholder with
  no sample value).
- The required instantiated files exist (`E_STRUCTURE_MISSING`):
  MEMORY.md, daily-log.md, person.md, group.md, roster.md,
  task-registry.md, PLACEHOLDERS.md, scripts/mail-helper.ps1,
  scripts/doorbell.ps1 — and at least three commons fragments.
- Required sections are present in the instantiated templates
  (`E_REPRO_SECTION_MISSING`): MEMORY.md has Facts, Preferences, and
  Commitments; daily-log.md has Events, Decisions, State Changes,
  and Open Threads; person.md has Identity, Relationship, Facts, and
  Open Threads; group.md has Purpose, Members, Dynamics, and Open
  Threads; roster.md has Rules of Engagement; task-registry.md has
  Status Vocabulary and Notes.
- Substitution spot checks: the instantiated roster contains the
  sample coordinator identity, and the instantiated doorbell script
  contains the sample mail host (both reported as
  `E_REPRO_LEFTOVER_PLACEHOLDER` when absent).
- Determinism: a second instantiation with the same sample values
  produces a byte-identical tree (`E_REPRO_NONDETERMINISTIC`).

## PASS output

A successful full run looks like this (verbatim from a real run; the
denylist NOTE varies by configuration):

```text
NOTE: no external denylist configured; hygiene uses the bundled example list (denylist.example.txt). Set AGENT_TEAM_OS_DENYLIST or add denylist.local.txt for a real deployment list.
ERROR suite: clean control + 3 poisoned fixtures exercised
REPRO instantiated 13 template files (scratch directory removed after the run)
HYGIENE: PASS
COMPAT: PASS
USABILITY: PASS
ERROR: PASS
REPRO: PASS
ALL CHECKS PASSED
```

A failing run prints FAIL with a finding count per affected suite,
each finding as an indented named error, and a final summary line,
for example:

```text
USABILITY: FAIL (1 findings)
  [E_USABILITY_DEAD_PATH] README.md: referenced path does not exist: CHANGELOG.md
CHECKS FAILED: 2 findings
```

with a non-zero exit code. Treat any deviation from this shape —
missing suite line, unnamed error, exit zero on failure — as a
failure of the ERROR suite.

See also: [bootstrap-from-zero.md](bootstrap-from-zero.md), [error-handling.md](error-handling.md), [../README.md](../README.md).
