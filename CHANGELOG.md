# Changelog

All notable changes to this project are documented here. Format follows Keep a Changelog; versioning follows SemVer.

## [Unreleased]
- Placeholder for upcoming changes.

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