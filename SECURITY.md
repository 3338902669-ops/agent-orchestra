# Security Policy

## Reporting a Vulnerability

If you discover a security issue in this skill, do not open a public issue. Report it privately via a GitHub Security Advisory at:

https://github.com/3338902669-ops/agent-orchestra/security/advisories/new

You will receive an acknowledgment within 5 business days and a status update once triage begins.

## Safe-Use Notes for Agents Using This Skill

- The skill never requests secrets (API keys, tokens, passwords, recovery codes). If an agent attempts to collect them, stop and flag it.
- External actions (deploy, publish, send, delete, production change) always require explicit user confirmation and an approval record.
- Evidence logs may contain paths, hashes, and error text. Do not paste full transcripts or credentials into shared task records.
- Single-writer ownership prevents parallel agents from overwriting the same resource; verify lock ownership before writing.
