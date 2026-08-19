---
name: multi-agent-orchestration
description: Use when three or more AI agents are available and a task needs coordinated execution, role assignment, independent verification, risk controls, or lower token/API cost.
---

# Multi-Agent Orchestration

A capability-first coordination protocol with explicit ownership, evidence, stop conditions, and token-aware routing. It reduces error risk but cannot promise absolute infallibility.

## Fast Path

1. Discover each agent's tools, model, workspace, permissions, specialties, cost tier, and availability.
2. Map capabilities to roles; never infer from names alone.
3. Classify the task as routine, important, or critical using user configuration.
4. Create a compact task packet: objective, non-goals, ownership, risks, and acceptance tests.
5. Enforce one primary writer per file or resource.
6. For important work use specify -> implement -> verify -> accept.
7. For critical work add domain review and human approval for external or irreversible actions.
8. Stop on failed gates, ownership conflicts, missing evidence, or unapproved external actions.

## Roles

Coordinator decomposes work, maintains state, resolves conflicts, and accepts evidence. Implementer edits assigned resources. Verifier independently tests behavior and regressions. Environment specialist diagnoses runtime, MCP, build, and toolchain problems. Domain reviewer checks UX, content, security, legal, or other domain criteria.

One agent may hold multiple roles for routine work only. Important work requires an independent verifier.

## Token Policy

Load only the reference section needed. Use one coordinator summary instead of full transcripts. Send bounded structured packets. Parallelize independent read-only checks; serialize dependent work and writes. Use cheap models for discovery and mechanical checks; reserve strong models for ambiguity, architecture, adversarial review, and acceptance. Never compress requirements, code, paths, URLs, hashes, errors, permissions, or evidence.

See references/token-efficiency.md.

## Completion Gate

Do not claim done, verified, or deployed without criterion-linked evidence. User-facing work should test actual runtime, target environments, core interactions, errors, keyboard/accessibility where relevant, resource loading, and fallback or reduced-motion behavior where relevant. A failed gate returns the task to its responsible stage.

See references/protocol.md, references/roles.md, and config/agents.example.yaml.
