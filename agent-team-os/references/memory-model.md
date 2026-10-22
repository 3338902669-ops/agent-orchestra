# Memory Model

Layered memory for a hub-coordinated agent team. Each layer has one job. Do not duplicate a fact across layers without a promotion reason; link instead.

See also: [governance.md](governance.md), [MEMORY template](../templates/MEMORY.md), [daily log template](../templates/daily-log.md), [person template](../templates/person.md), [group template](../templates/group.md).

## 1. Curated Long-Term Memory

**What belongs:** Durable facts that will still matter in 30+ days: stable preferences, standing commitments, confirmed identities and roles, long-lived decisions, hard rules.

**What does NOT belong:** Transient task state, timestamps of routine events, speculation, unverified claims, secrets or credentials, raw logs.

**When to write:** Only on promotion from a daily log, or when a human confirms a durable fact directly. Never during a task just to "save progress" — that goes in the daily log.

**Write format:** Short bullet, dated, with a source note. One fact per bullet. Group under Facts / Preferences / Commitments.

**Retrieval:** Read at session start. Search by keyword before answering anything about prior work, decisions, or people.

**Promotion rules:** See section 8.

Template: [../templates/MEMORY.md](../templates/MEMORY.md)

## 2. Daily Logs

**What belongs:** What happened today: events, decisions made, state changes, errors, open threads, handoffs. The raw chronological record.

**What does NOT belong:** Polished summaries for external readers, durable facts stated as final (mark them as candidates for promotion), credentials.

**When to write:** Append during the day as events occur, and once at end of day to close open threads or carry them forward.

**Write format:** One file per day, date in the filename. Sections: Events, Decisions, State Changes, Open Threads. Each entry: time (optional), fact, evidence anchor if it came from another agent.

**Retrieval:** By date, then by keyword search across the log directory. Recent logs (last 7 days) are the first place to check "what happened".

**Promotion rules:** At a periodic review (daily or weekly), scan for facts that meet the promotion test in section 8 and move them up. Do not copy the whole log.

Template: [../templates/daily-log.md](../templates/daily-log.md)

## 3. Person Profiles

**What belongs:** One file per person the team interacts with repeatedly: identity, relationship to the operator, confirmed facts about them, communication preferences, open threads involving them.

**What does NOT belong:** Inferred sensitive attributes, gossip, facts about people with no ongoing relationship to the work, credentials or private identifiers beyond what is needed to disambiguate.

**When to write:** Create on first recurring interaction. Update when a confirmed fact changes or a thread opens/closes. Attribute every fact to a source and date.

**Write format:** See template. Facts as dated bullets with source notes. Keep a separate Open Threads section.

**Retrieval:** Read the profile before acting on or writing about that person. Check the index file for the canonical list; do not invent a profile that is not indexed.

**Promotion rules:** A daily-log mention becomes a profile fact only after confirmation or repeated consistent evidence. Superseded facts are struck through or moved to a history note, not silently deleted on first correction.

Template: [../templates/person.md](../templates/person.md)

## 4. Group Profiles

**What belongs:** One file per group, team, or community: purpose, members (by role or profile link), dynamics and norms, recurring decisions, open threads.

**What does NOT belong:** Private facts about individual members (those live in person profiles), transient chat content.

**When to write:** Create when a group becomes a recurring work context. Update on membership, purpose, or norm changes.

**Write format:** See template.

**Retrieval:** Read before planning work that involves the group. Resolve member references via person profiles.

**Promotion rules:** Same as person profiles: confirmed, recurring, and relevant — otherwise it stays in the daily log.

Template: [../templates/group.md](../templates/group.md)

## 5. Temporal Knowledge Graph

**What belongs:** Time-scoped facts as structured triples/edges: subject, relation, object, valid-from, valid-to (if known), source, confidence. Especially facts that change: roles, ownership, status, locations, versions.

**What does NOT belong:** Unstructured narrative, preferences better kept as prose, anything with no time dimension or no foreseeable query need.

**When to write:** When a fact is asserted, corrected, or expires. Write a new edge/version; do not overwrite history.

**Write format:** One fact per record with timestamps and a source/evidence anchor. Mark superseded records explicitly.

**Retrieval:** Query by entity, relation, and point in time. "Current" means: latest valid record not yet superseded — always check the valid-to / superseded-by fields.

**Promotion / supersession rules:**

- A newer confirmed fact supersedes the older one: close the old record (`valid_to = <date>`, `superseded_by = <id>`), add the new one.
- Never delete a superseded record; history is the point of this layer.
- Conflicting facts with no resolution stay both present, flagged as conflicted, until a verifier or human resolves them.
- Facts expire: if a record's expected lifetime passes with no reconfirmation, lower its confidence rather than treating it as current.

## 6. Shared Commons Fragments

**What belongs:** Short, versioned rule fragments distributed verbatim into every agent's instruction file: approval gates, evidence anchors, single-writer rule, verifier independence, failure-reporting honesty. See [governance.md](governance.md).

**What does NOT belong:** Role-specific procedures, project details, anything only one agent needs. Commons is the common denominator only.

**When to write:** When a rule must apply to every seat identically. Changes are governance changes: coordinator proposes, human approves, then redistribute to all seats and verify each copy.

**Write format:** Self-contained Markdown fragment, under ~40 lines, imperative voice, no references to seat-specific paths. Include a fragment ID and version comment.

**Retrieval:** Agents do not retrieve commons at runtime; it is already in their instruction file. The coordinator retrieves the source fragments to audit drift between copies.

**Promotion rules:** A lesson learned by one agent becomes commons only after it recurs or a human directs it. One-off fixes stay in that agent's local instructions.

## 7. Digests and Alignment Synthesis

**What belongs:** Periodic compressions: memory digests (per-agent or per-topic summaries of recent logs and graph changes) and an alignment synthesis (how the team currently understands the operator's goals, preferences, boundaries, and open frictions).

**What does NOT belong:** New primary facts. A digest never introduces a fact that is not traceable to a log, profile, or graph record.

**When to write:** On a fixed cadence (e.g. nightly / weekly) by the coordinator or dispatcher, not ad hoc mid-task.

**Write format:** Summaries with pointers back to source dates/paths. Synthesis states confidence plainly and lists unresolved frictions, not just agreements.

**Retrieval:** Read the synthesis at planning time to calibrate tone and priorities. Always drill down to the source layer before acting on a digest claim that has consequences.

**Promotion rules:** Digests are derived and disposable: regenerate them, do not promote text from a digest into long-term memory. Promote only the underlying source fact, citing the source, not the digest.

## 8. Promotion: Daily Log -> Long-Term

Promote a fact only if all are true:

1. Durable: likely to matter in 30+ days.
2. Confirmed: stated by the human, or verified with an evidence anchor.
3. Non-duplicative: not already in long-term memory in equivalent form.
4. In scope: about the operator, the team, a recurring person/group, or a standing rule.

On promotion: rewrite as a concise long-term bullet, add date and source, remove or annotate the log candidate if your workflow tracks candidates. If a promoted fact later changes, edit long-term memory and record the change in that day's log and, where applicable, supersede it in the graph.

## Write Discipline Checklist

- [ ] Right layer? Could this be a daily-log entry instead of a long-term fact?
- [ ] One fact per bullet/record, dated, with a source.
- [ ] No secrets, tokens, passwords, or private identifiers.
- [ ] No invented numbers, names, or identifiers — copy exactly from a source or omit.
- [ ] Cross-agent claim? Attach an evidence anchor (path / hash / raw output).
- [ ] Superseding an old fact? Close/supersede the old record, do not silently overwrite history in the graph.
- [ ] Person/group fact? Put it in that profile, not scattered across logs.
- [ ] Rule for everyone? Propose it as a commons fragment via governance, do not just edit your own instructions.
- [ ] After writing, re-read the file to confirm the write landed as intended.
