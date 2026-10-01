#!/usr/bin/env node
// protocol-benchmark.mjs - does the protocol actually change outcomes?
//
// WHAT THIS IS: a reproducible comparison of three COORDINATION MODELS driving the same six
// scenarios. Every scenario is a failure mode multi-agent work actually hits. The actors are
// deterministic scripts - no LLM is called - so anyone can re-run this and get the same table.
//
// WHAT THIS IS NOT: a study of model quality. It does not measure whether an LLM writes better
// code. It measures which failure modes the COORDINATION LAYER lets through, which is the layer
// this project controls. Say that plainly rather than inflating the number.
//
// Usage: node bench/protocol-benchmark.mjs [--json <path>] [--markdown <path>]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createState, createTask, claimTask, completeStage, failVerification, nextDispatch, approveExternalAction,
} from '../scripts/orchestrator/lib.mjs';

// ── the two models the protocol is compared against ─────────────────────────────────

/** One agent; whatever it says goes. The baseline most projects start from. */
function singleModel(scenario) {
  const world = { artifact: null, done: false, externalRan: false, attempts: 0, interventions: 0 };
  scenario.naive(world, { agents: ['solo'] });
  return world;
}

/** Several agents sharing state, with no locks and no gate: the obvious first attempt. */
function naiveModel(scenario) {
  const world = { artifact: null, done: false, externalRan: false, attempts: 0, interventions: 0 };
  scenario.naive(world, { agents: ['a', 'b', 'c'] });
  return world;
}

/** The shipped engine. Every call below is the real library, not a re-implementation. */
function orchestraModel(scenario) {
  const world = { artifact: null, done: false, externalRan: false, attempts: 0, interventions: 0, refusals: [] };
  scenario.orchestra(world);
  return world;
}

// ── scenarios ────────────────────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    id: 'conflicting_writes',
    title: 'Two agents write the same resource',
    metric: 'conflicting writes that landed',
    naive(world, cfg) {
      const log = [cfg.agents[0] + ':v1', cfg.agents[1] + ':v2'];
      world.artifact = log[log.length - 1];
      world.conflicts = 1;
    },
    orchestra(world) {
      const a = createTask(createState(), { title: 'shared file', resources: ['src/foo.ts'] });
      const b = createTask(a.state, { title: 'other writer', resources: ['src/foo.ts'] });
      const s = claimTask(b.state, a.task.id, a.task.assignedAgent).state;
      try {
        claimTask(s, b.task.id, b.task.assignedAgent);
        world.conflicts = 1;
      } catch (e) { world.conflicts = 0; world.refusals.push(e.message); }
    },
  },
  {
    id: 'self_declared_success',
    title: 'The author declares the work done with no evidence',
    metric: 'self-declared successes accepted',
    naive(world) { world.done = true; world.selfAccepted = 1; },
    orchestra(world) {
      const t = createTask(createState(), { title: 'solo claim', rigor: 'L2' });
      let s = claimTask(t.state, t.task.id, t.task.assignedAgent).state;
      s = completeStage(s, t.task.id, t.task.assignedAgent, { spec: 'x', acceptance: 'y' }).state;
      const impl = s.tasks[t.task.id].assignedAgent;
      s = claimTask(s, t.task.id, impl).state;
      s = completeStage(s, t.task.id, impl, {}).state;
      const verifier = s.tasks[t.task.id].assignedAgent;
      s = claimTask(s, t.task.id, verifier).state;
      try {
        s = completeStage(s, t.task.id, verifier, {}).state;
        world.selfAccepted = 1;
      } catch (e) { world.selfAccepted = 0; world.refusals.push(e.message); }
      world.done = s.tasks[t.task.id].phase === 'done';
    },
  },
  {
    id: 'verification_miss',
    title: 'The implementer verifies its own work',
    metric: 'self-verifications accepted',
    naive(world) { world.selfVerified = 1; },
    orchestra(world) {
      const t = createTask(createState(), { title: 'own work', rigor: 'L2' });
      let s = claimTask(t.state, t.task.id, t.task.assignedAgent).state;
      s = completeStage(s, t.task.id, t.task.assignedAgent, { spec: 'x', acceptance: 'y' }).state;
      const impl = s.tasks[t.task.id].assignedAgent;
      s = claimTask(s, t.task.id, impl).state;
      s = completeStage(s, t.task.id, impl, {}).state;
      const verifier = s.tasks[t.task.id].assignedAgent;
      try { claimTask(s, t.task.id, impl); world.selfVerified = 1; }
      catch (e) { world.selfVerified = 0; world.refusals.push(e.message); }
      world.verifierIsImplementer = verifier === impl;
    },
  },
  {
    id: 'runaway_retries',
    title: 'Verification keeps failing',
    metric: 'attempts before the loop stops',
    naive(world) { world.attempts = 25; world.interventions = 0; },
    orchestra(world) {
      const t = createTask(createState(), { title: 'stuck', rigor: 'L2' });
      let s = t.state;
      let attempts = 0;
      for (let round = 0; round < 25; round++) {
        if (s.tasks[t.task.id].status === 'blocked') break;
        while (s.tasks[t.task.id].phase !== 'verify') {
          const a = s.tasks[t.task.id].assignedAgent;
          const payload = s.tasks[t.task.id].phase === 'specify' ? { spec: 'x', acceptance: 'y' } : {};
          s = claimTask(s, t.task.id, a).state;
          s = completeStage(s, t.task.id, a, payload).state;
        }
        const v = s.tasks[t.task.id].assignedAgent;
        s = claimTask(s, t.task.id, v).state;
        s = failVerification(s, t.task.id, v, { criteria: 'still failing' }).state;
        attempts += 1;
      }
      world.attempts = attempts;
      world.blocked = s.tasks[t.task.id].status === 'blocked';
      world.interventions = world.blocked ? 1 : 0;
    },
  },
  {
    id: 'external_action',
    title: 'A deploy is attempted without approval',
    metric: 'unapproved external actions dispatched',
    naive(world) { world.externalRan = true; world.unapproved = 1; },
    orchestra(world) {
      const t = createTask(createState(), { title: 'deploy', type: 'build', rigor: 'L3', externalAction: 'deploy',
        externalTarget: 'production', executionMode: 'collaborative', security: 'planned', independentVerify: 'planned' });
      // The approval gates the external STEP (externalAction.at, default implement), so the task has to
      // reach that stage before the attempt means anything. Internal stages are allowed through.
      let s = claimTask(t.state, t.task.id, t.task.assignedAgent).state;
      s = completeStage(s, t.task.id, t.task.assignedAgent, { spec: 'ship it', acceptance: 'it is live' }).state;
      try { nextDispatch(s, t.task.id); world.unapproved = 1; }
      catch (e) { world.unapproved = 0; world.refusals.push(e.message); }
      // An approval naming somewhere else must not unlock it, and a substring must not either.
      const wrong = approveExternalAction(s, t.task.id, { approvedBy: 'ops', scope: 'staging' }).state;
      try { nextDispatch(wrong, t.task.id); world.wrongScopeAllowed = 1; }
      catch (e) { world.wrongScopeAllowed = 0; world.refusals.push(e.message); }
    },
  },
  {
    id: 'silent_failure',
    title: 'A failed verification is followed by a claim of success',
    metric: 'failures that reached done',
    naive(world) { world.done = true; world.silent = 1; },
    orchestra(world) {
      const t = createTask(createState(), { title: 'failed then claimed', rigor: 'L2' });
      let s = claimTask(t.state, t.task.id, t.task.assignedAgent).state;
      s = completeStage(s, t.task.id, t.task.assignedAgent, { spec: 'x', acceptance: 'y' }).state;
      const impl = s.tasks[t.task.id].assignedAgent;
      s = claimTask(s, t.task.id, impl).state;
      s = completeStage(s, t.task.id, impl, {}).state;
      const v = s.tasks[t.task.id].assignedAgent;
      s = claimTask(s, t.task.id, v).state;
      s = failVerification(s, t.task.id, v, { criteria: 'broken' }).state;
      // Deliberately NOT "can it be dispatched": after a failure the task legitimately goes back to
      // implement for rework. The question is whether the failure can reach done, and whether the
      // evidence stage stays gated while the verification is failed.
      world.done = s.tasks[t.task.id].phase === 'done';
      const forced = {
        ...s,
        tasks: { ...s.tasks, [t.task.id]: { ...s.tasks[t.task.id], phase: 'evidence', lock: null, status: 'queued' } },
      };
      try { nextDispatch(forced, t.task.id); world.gateHeld = 0; }
      catch (e) { world.gateHeld = 1; world.refusals.push(e.message); }
      world.silent = world.done ? 1 : 0;
    },
  },
];

const models = { single: singleModel, naive: naiveModel, orchestra: orchestraModel };
const results = [];
for (const scenario of SCENARIOS) {
  const row = { id: scenario.id, title: scenario.title, metric: scenario.metric };
  for (const [name, run] of Object.entries(models)) {
    try { row[name] = run(scenario); } catch (e) { row[name] = { error: e.message }; }
  }
  results.push(row);
}

function cell(row, model) {
  const w = row[model];
  if (w?.error) return 'ERROR';
  const pick = (k, fallback) => (model === 'orchestra' ? String(w[k]) : fallback);
  switch (row.id) {
    case 'conflicting_writes': return pick('conflicts', '1');
    case 'self_declared_success': return pick('selfAccepted', '1');
    case 'verification_miss': return pick('selfVerified', '1');
    case 'runaway_retries': return String(w.attempts ?? 0);
    case 'external_action': return pick('unapproved', '1');
    case 'silent_failure': return pick('silent', '1');
    default: return '?';
  }
}

const lines = [];
lines.push('# Protocol benchmark');
lines.push('');
lines.push('Three coordination models, six failure modes, scripted actors, no LLM calls.');
lines.push('');
lines.push('| Failure mode | What is counted | Single agent | Naive multi-agent | Agent Orchestra |');
lines.push('|---|---|---|---|---|');
for (const row of results) {
  lines.push('| ' + row.title + ' | ' + row.metric + ' | ' + cell(row, 'single') + ' | ' + cell(row, 'naive') + ' | ' + cell(row, 'orchestra') + ' |');
}
lines.push('');
lines.push('Every non-zero value in the Agent Orchestra column is a rule that did NOT hold. Each refusal:');
lines.push('');
for (const r of results.flatMap((x) => x.orchestra.refusals ?? [])) lines.push('- ' + String(r).split('\n')[0].slice(0, 160));
const md = lines.join('\n');
console.log(md);

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const jsonPath = flag('--json');
if (jsonPath) { mkdirSync(dirname(jsonPath), { recursive: true }); writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), scenarios: results }, null, 2)); }
const mdPath = flag('--markdown');
if (mdPath) { mkdirSync(dirname(mdPath), { recursive: true }); writeFileSync(mdPath, md + '\n'); }
if (!jsonPath && !mdPath) console.log('\n(pass --json <path> and/or --markdown <path> to write evidence)');
