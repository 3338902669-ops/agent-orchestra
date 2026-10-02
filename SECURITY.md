# Security Policy

## Reporting a Vulnerability

If you discover a security issue in this skill, do not open a public issue. Report it privately through
the security-advisory channel of the repository, listing the task id, the command, and the observed
behaviour.

You will receive an acknowledgment within 5 business days and a status update once triage begins.

## This repository is also a website

GitHub Pages publishes the **repository root** of this project (branch `main`, path `/`). Everything
committed here is therefore served at a public URL the moment it lands - including dot-directories, which
are easy to assume are private.

That is not hypothetical: during the landing of the orchestration engine, a dispatched verifier's
transcript was committed into `.verify-0019/` by a `git add -A`, and was publicly served at
`/.verify-0019/raw.txt` until the commit was rewritten. It held this machine's queue with real client
task titles and absolute user paths.

Two consequences, both enforced rather than requested:

- **Scratch files do not belong in this repository.** Verification artefacts, transcripts and machine
  state go outside it, or into a path listed in `.gitignore`.
- **The gate checks what git would commit, not what the package would ship.** Those sets differ, and the
  hygiene step uses `git ls-files -co --exclude-standard` so an ignored path cannot blind it. Run
  `git status` before `git add -A` anyway; the gate is the backstop, not the first line.

## Safe-Use Notes for Agents Using This Skill

- The skill never requests secrets (API keys, tokens, passwords, recovery codes). If an agent attempts to collect them, stop and flag it.
- External and irreversible actions (deploy, publish, send, upload, delete, production or account change) always require explicit user confirmation plus a recorded `approve` entry scoped to that task. A passed verification gate is not a shipping authorization.
- The task queue only produces dry-run dispatch commands. It must never launch an agent by itself; a non-dispatchable task must fail with a non-zero exit code rather than report success.
- Task titles and workspaces are free-form text. The dispatch record carries them as an `argv` array; the printable `command` is rendered with POSIX single-quote escaping (never `JSON.stringify`, which leaves `$(...)`, backticks, `${...}` and `!` live). Prefer `argv` over pasting the command line into a shell.
- Evidence logs may contain paths, hashes, and error text. Do not paste full transcripts or credentials into shared task records.
- Single-writer ownership prevents parallel agents from overwriting the same resource; verify lock ownership before writing.
- The task queue serialises writers across processes: an exclusive lock file, a temp-file-and-rename write, and a stale-lock takeover so a crashed run cannot wedge it.
- Never let an implementer certify its own work: the verification worker must be a different agent than the author.

## Scope

This repository contains instructions, a configuration template, and local Node scripts. It performs no network calls of its own. If your host wires it to MCP servers or external APIs, that wiring — and its credentials — is yours to review.
