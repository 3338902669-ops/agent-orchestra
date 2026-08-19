# Token and Cost Efficiency

Lower cost without lowering correctness.

## Tiers

micro: coordinator plus one focused check. standard: coordinator, implementer, verifier, acceptance. high-assurance: standard plus independent or domain review and failed-gate replay. User configuration maps risk labels to tiers; never silently downgrade important work.

## Rules

1. Keep one canonical task packet; do not copy full history into every prompt.
2. Summarize completed stages as facts, decisions, files, and evidence.
3. Reference paths and sections instead of pasting large files.
4. Require bounded JSON or short reports.
5. Parallelize independent checks; do not duplicate purpose.
6. Cache stable discovery and tests by revision or hash.
7. Stop exploration once all criteria have fresh evidence.
8. Escalate model strength only for ambiguity, architecture, failed gates, or acceptance.

Never compress requirements, permissions, secrets rules, exact errors, code, URLs, hashes, changed paths, or acceptance evidence. Report calls, retries, cache hits, model tiers, and escalation reasons when telemetry exists; otherwise say telemetry is unavailable.
