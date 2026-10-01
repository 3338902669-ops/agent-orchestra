// lib.test.mjs — node:test suite for the portable orchestrator runtime.
//
// Run from the repository root:
//   node --test scripts/orchestrator/lib.test.mjs
//
// Covers: the stage machine for every task type, the verifier-independence invariant,
// single-writer claim locks, capability derivation/validation, important-task start
// choices, the external-action approval gate, recover semantics, dry-run dispatch,
// and the sanitisation/dry-run guards on the runtime sources.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
  AGENTS,
  CAPABILITIES,
  DEFAULT_START_CHOICES,
  EVIDENCE_GRADES,
  RIGOR_LEVELS,
  STAGES,
  STATE_VERSION,
  TYPES,
  approveExternalAction,
  canRunExternalAction,
  capabilityForType,
  claimTask,
  completeStage,
  createState,
  createTask,
  failVerification,
  implementerForType,
  nextDispatch,
  ownerFor,
  overrideVerificationGate,
  recoverTask,
  selectAgent,
  selectVerifier,
  shellQuote,
  validateRoster,
  verifierFor,
} from './lib.mjs';

function createOne(input) {
  // An external action must state its start choices (the intake gate no longer answers for the
  // user), so these approval tests supply them and then test what they are actually about.
  // An external action must state its choices AND be L3 (irreversible), so these approval tests
  // supply both and then test what they are actually about.
  const withChoices = input?.externalAction
    ? { important: true, rigor: 'L3', executionMode: 'collaborative', security: 'planned', independentVerify: 'planned', ...input }
    : input;
  return createTask(createState(), withChoices);
}

function step(state, id, agent, evidence = 'ran the stage: exit 0') {
  // The default carries a graded record because rigor L2 (the default) now requires one to reach
  // done, and the packet because the specify stage cannot end without its work products.
  const claimed = claimTask(state, id, agent).state;
  const task = claimed.tasks[id];
  const packet = task.phase === 'specify'
    ? { spec: 'the change under test', acceptance: 'the suite exits 0' }
    : {};
  return completeStage(claimed, id, agent, { evidence, ...packet }).state;
}

// ── state shape ──────────────────────────────────────────────────────────────

test('createState returns an empty queue carrying a validated roster', () => {
  const state = createState();
  assert.equal(state.version, STATE_VERSION);
  assert.equal(state.version, 4);
  assert.equal(state.nextTaskNumber, 1);
  assert.deepEqual(state.tasks, {});
  assert.deepEqual(state.events, []);
  // The roster is data, so the same mechanism serves 3 agents or 12.
  assert.deepEqual(Object.keys(state.roster.agents).sort(), AGENTS.slice().sort());
});

test('createTask is pure: the input state is not mutated', () => {
  const before = createState();
  const result = createTask(before, { title: 'pure' });
  assert.deepEqual(before.tasks, {});
  assert.equal(before.nextTaskNumber, 1);
  assert.equal(before.events.length, 0);
  assert.equal(Object.keys(result.state.tasks).length, 1);
});

test('createTask assigns zero-padded sequential ids', () => {
  let state = createState();
  const first = createTask(state, { title: 'a' });
  const second = createTask(first.state, { title: 'b' });
  assert.equal(first.task.id, 'task-0001');
  assert.equal(second.task.id, 'task-0002');
});

test('createTask requires a title', () => {
  assert.throws(() => createTask(createState(), { title: '   ' }), /Task title is required/);
  assert.throws(() => createTask(createState(), {}), /Task title is required/);
});

test('createTask rejects an unknown task id on later operations', () => {
  assert.throws(() => claimTask(createState(), 'task-9999', 'generalist'), /Unknown task: task-9999/);
  assert.throws(() => nextDispatch(createState(), 'task-9999'), /Unknown task: task-9999/);
});

test('a new task is queued in specify and owned by the coordinator', () => {
  const r = createOne({ title: 'new-task' });
  assert.equal(r.task.phase, 'specify');
  assert.equal(r.task.assignedAgent, 'generalist');
  assert.equal(r.task.status, 'queued');
  assert.equal(r.task.lock, null);
  assert.deepEqual(r.task.evidence, []);
  assert.equal(r.state.events.at(-1).type, 'created');
});

// ── stage machine ────────────────────────────────────────────────────────────

const FLOWS = {
  build:       { phases: ['specify', 'implement', 'verify', 'evidence', 'done'], actors: ['generalist', 'generalist', 'specialist', 'generalist'] },
  web:         { phases: ['specify', 'implement', 'verify', 'evidence', 'done'], actors: ['generalist', 'frontend', 'specialist', 'generalist'] },
  complex:     { phases: ['specify', 'implement', 'verify', 'evidence', 'done'], actors: ['generalist', 'specialist', 'generalist', 'generalist'] },
  verify:      { phases: ['specify', 'implement', 'verify', 'evidence', 'done'], actors: ['generalist', 'specialist', 'generalist', 'generalist'] },
  environment: { phases: ['specify', 'triage', 'implement', 'verify', 'evidence', 'done'], actors: ['generalist', 'frontend', 'frontend', 'specialist', 'generalist'] },
};

test('STAGES lists the pipeline in order', () => {
  assert.deepEqual(STAGES, ['specify', 'triage', 'implement', 'verify', 'evidence', 'done']);
});

for (const type of TYPES) {
  test('stage machine advances ' + type + ' to done', () => {
    const flow = FLOWS[type];
    const created = createOne({ title: type + '-flow', type });
    const id = created.task.id;
    let state = created.state;
    assert.equal(state.tasks[id].phase, 'specify');
    assert.equal(state.tasks[id].assignedAgent, 'generalist');
    for (let i = 0; i < flow.actors.length; i++) {
      const task = state.tasks[id];
      assert.equal(task.phase, flow.phases[i], 'phase before step ' + i);
      assert.equal(task.assignedAgent, flow.actors[i], 'owner of ' + flow.phases[i]);
      state = step(state, id, flow.actors[i], 'step ' + i);
    }
    const done = state.tasks[id];
    assert.equal(done.phase, 'done');
    assert.equal(done.status, 'done');
    assert.equal(done.assignedAgent, null);
    assert.equal(done.lock, null);
  });
}

test('the verifier is never the implementer (every type)', () => {
  for (const type of TYPES) {
    const flow = FLOWS[type];
    const implIdx = flow.phases.indexOf('implement');
    const verIdx = flow.phases.indexOf('verify');
    assert.notEqual(flow.actors[implIdx], flow.actors[verIdx], type + ' reuses the implementer as verifier');
    assert.equal(verifierFor(flow.actors[implIdx]), flow.actors[verIdx], type + ' verifier mismatch');
  }
  assert.equal(verifierFor('generalist'), 'specialist');
  // frontend scores 1 for verify, specialist scores 3: the scored ranking wins.
  assert.equal(verifierFor('frontend'), 'specialist');
  assert.equal(verifierFor('specialist'), 'generalist');
});

test('completeStage without the claim is rejected', () => {
  const r = createOne({ title: 'unclaimed' });
  assert.throws(() => completeStage(r.state, r.task.id, 'generalist'), /must be claimed by generalist/);
});

test('completeStage records evidence supplied by the owner', () => {
  const r = createOne({ title: 'evidence' });
  const claimed = claimTask(r.state, r.task.id, 'generalist').state;
  const out = completeStage(claimed, r.task.id, 'generalist', { evidence: 'exit code 0', spec: 's', acceptance: 'a' });
  assert.equal(out.task.evidence.length, 1);
  assert.equal(out.task.evidence[0].text, 'exit code 0');
  assert.equal(out.task.evidence[0].agent, 'generalist');
});

test('completeStage rejects a task stuck on an unknown phase', () => {
  const r = createOne({ title: 'weird-phase' });
  const claimed = claimTask(r.state, r.task.id, 'generalist').state;
  claimed.tasks[r.task.id].phase = 'nonsense';
  assert.throws(() => completeStage(claimed, r.task.id, 'generalist'), /cannot complete unknown phase nonsense/);
});

// ── single-writer claim locks ────────────────────────────────────────────────

test('a held lock rejects a second agent', () => {
  const r = createOne({ title: 'lock' });
  const claimed = claimTask(r.state, r.task.id, 'generalist').state;
  assert.equal(claimed.tasks[r.task.id].lock.owner, 'generalist');
  assert.equal(claimed.tasks[r.task.id].status, 'in_progress');
  assert.throws(() => claimTask(claimed, r.task.id, 'specialist'), /already held by generalist/);
});

test('claiming a task assigned to another agent is rejected', () => {
  const r = createOne({ title: 'wrong-agent', type: 'complex' });
  const claimed = step(r.state, r.task.id, 'generalist'); // specify -> implement(specialist)
  assert.equal(claimed.tasks[r.task.id].assignedAgent, 'specialist');
  assert.throws(() => claimTask(claimed, r.task.id, 'generalist'), /is assigned to specialist, not generalist/);
});

test('the same agent may re-claim its own lock (idempotent)', () => {
  const r = createOne({ title: 're-claim' });
  const once = claimTask(r.state, r.task.id, 'generalist').state;
  const twice = claimTask(once, r.task.id, 'generalist').state;
  assert.equal(twice.tasks[r.task.id].lock.owner, 'generalist');
});

test('claim and complete release the lock between stages', () => {
  const r = createOne({ title: 'release' });
  const after = step(r.state, r.task.id, 'generalist');
  assert.equal(after.tasks[r.task.id].lock, null);
  assert.equal(after.tasks[r.task.id].status, 'queued');
});

// ── capability ───────────────────────────────────────────────────────────────

test('CAPABILITIES is exactly the documented set', () => {
  assert.deepEqual(CAPABILITIES, ['full', 'web', 'complex', 'verify', 'environment']);
});

test('capability is derived from the task type', () => {
  const expected = { build: 'full', web: 'web', complex: 'complex', verify: 'verify', environment: 'environment' };
  for (const [type, capability] of Object.entries(expected)) {
    assert.equal(capabilityForType(type), capability);
    assert.equal(createOne({ title: 'cap-' + type, type }).task.capability, capability);
  }
  assert.equal(capabilityForType('unknown-type'), 'full');
  assert.equal(createOne({ title: 'default-cap' }).task.capability, 'full');
});

test('capability may be overridden explicitly', () => {
  const r = createOne({ title: 'override', type: 'build', capability: 'web' });
  assert.equal(r.task.capability, 'web');
});

test('an invalid capability or type is rejected', () => {
  assert.throws(() => createOne({ title: 'x', capability: 'bogus' }), /Invalid capability: bogus/);
  assert.throws(() => createOne({ title: 'x', type: 'bogus' }), /Invalid type: bogus/);
});

test('capability flows into the dispatch record and the dry-run prompt', () => {
  const r = createOne({ title: 'cap-dispatch', type: 'complex' });
  const dispatch = nextDispatch(r.state, r.task.id);
  assert.equal(dispatch.capability, 'complex');
  assert.match(dispatch.command, /Capability: complex/);
});

// ── important task start choices ─────────────────────────────────────────────

test('important tasks record all three start choices', () => {
  const r = createOne({
    title: 'important-task',
    type: 'build',
    important: true,
    executionMode: 'collaborative',
    security: 'planned',
    independentVerify: 'planned',
  });
  assert.equal(r.task.important, true);
  assert.equal(r.task.startChoices.executionMode, 'collaborative');
  assert.equal(r.task.startChoices.security, 'planned');
  assert.equal(r.task.startChoices.independentVerify, 'planned');
});

test('important tasks are rejected when a start choice is missing', () => {
  const base = { title: 'x', important: true };
  assert.throws(() => createOne({ ...base, executionMode: 'single', security: 'skip' }), /Important task requires: --independent-verify/);
  assert.throws(() => createOne({ ...base, security: 'skip', independentVerify: 'skip' }), /Important task requires: --execution-mode/);
  assert.throws(() => createOne({ ...base, executionMode: 'single', independentVerify: 'skip' }), /Important task requires: --security/);
  assert.throws(() => createOne(base), /Important task requires: --execution-mode, --security, --independent-verify/);
});

test('plain tasks fall back to the documented defaults', () => {
  const r = createOne({ title: 'plain' });
  assert.equal(r.task.important, false);
  assert.deepEqual(r.task.startChoices, {
    executionMode: DEFAULT_START_CHOICES.executionMode,
    security: DEFAULT_START_CHOICES.security,
    independentVerify: DEFAULT_START_CHOICES.independentVerify,
  });
  assert.equal(r.task.startChoices.executionMode, 'single');
  assert.equal(r.task.startChoices.security, 'skip');
  assert.equal(r.task.startChoices.independentVerify, 'skip');
});

test('invalid start choice values are rejected even on plain tasks', () => {
  assert.throws(() => createOne({ title: 'x', executionMode: 'parallel' }), /Invalid execution-mode: parallel/);
  assert.throws(() => createOne({ title: 'x', security: 'auto' }), /Invalid security: auto/);
  assert.throws(() => createOne({ title: 'x', independentVerify: 'yes' }), /Invalid independent-verify: yes/);
});

test('start choices are injected into the dry-run prompt, with the scan warning', () => {
  const r = createOne({
    title: 'choices-in-prompt',
    important: true,
    executionMode: 'collaborative',
    security: 'planned',
    independentVerify: 'planned',
  });
  const { command } = nextDispatch(r.state, r.task.id);
  assert.match(command, /Execution mode: collaborative/);
  assert.match(command, /Security: planned/);
  assert.match(command, /Independent verify: planned/);
  assert.match(command, /do not start a scan until the user confirms again/);
});

// ── dry-run dispatch ─────────────────────────────────────────────────────────

test('dispatch is a dry run and never claims to execute', () => {
  const r = createOne({ title: 'dry-run' });
  const dispatch = nextDispatch(r.state, r.task.id);
  assert.equal(dispatch.execute, false);
  assert.equal(dispatch.requiresHumanCoordination, false);
  assert.equal(dispatch.taskId, r.task.id);
  assert.equal(dispatch.agent, 'generalist');
  assert.equal(dispatch.phase, 'specify');
  assert.equal(typeof dispatch.command, 'string');
  assert.ok(dispatch.command.length > 0);
  assert.match(dispatch.command, /^agent-run --headless /);
});

test('the dispatch record carries an argv array, not only a shell string', () => {
  const r = createOne({ title: 'argv-form' });
  const dispatch = nextDispatch(r.state, r.task.id);
  assert.ok(Array.isArray(dispatch.argv));
  assert.equal(dispatch.argv[0], 'agent-run');
  assert.equal(dispatch.argv[1], '--headless');
  assert.equal(dispatch.argv.length, 3);
  assert.equal(dispatch.command, `agent-run --headless ${shellQuote(dispatch.argv[2])}`);
  // The prompt embeds an apostrophe ("task's"), so the rendered line must escape it
  // rather than end the quoted region early.
  assert.ok(dispatch.command.includes("'\\''"), 'embedded quotes are escaped');
});

test('shell metacharacters in free-form task text stay inside a quoted argument', () => {
  // Regression: the dispatch line used to be built with JSON.stringify, which leaves
  // $(...), backticks, ${...} and ! live inside double quotes. The printed line is
  // meant to be pasted into a shell, so that was command execution.
  const r = createOne({ title: 'Fix $(touch pwned) `id` ${HOME} !boom' });
  const dispatch = nextDispatch(r.state, r.task.id);
  const prompt = dispatch.argv[dispatch.argv.length - 1];
  assert.ok(prompt.includes('$(touch pwned)'), 'argv keeps the raw text');
  assert.ok(prompt.includes('`id`'));
  assert.match(dispatch.command, /^agent-run --headless '/);
  const outsideQuoted = dispatch.command.replace(/'[^']*'/g, '');
  assert.ok(!/[$\`!]/.test(outsideQuoted), 'no live substitution outside quotes: ' + outsideQuoted);
});

test('shellQuote escapes embedded single quotes instead of breaking out', () => {
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
  assert.equal(shellQuote('safe-token_1.2:3'), 'safe-token_1.2:3');
  assert.equal(shellQuote(''), "''");
  assert.equal(shellQuote('x; rm -rf /'), "'x; rm -rf /'");
});

test('the prompt carries task, workspace, boundary and evidence fields', () => {
  const r = createOne({ title: 'prompt-fields', workspace: '<workspace>/client' });
  const { command } = nextDispatch(r.state, r.task.id);
  assert.match(command, /prompt-fields/);
  assert.match(command, /Phase: specify/);
  assert.match(command, /Workspace: <workspace>\/client/);
  assert.match(command, /Capability: full/);
  assert.match(command, /Write boundary/);
  assert.match(command, /Verifier independence/);
  assert.ok(command.includes('Evidence:'));
  assert.ok(command.includes('External actions:'));
});

test('each agent identity gets its own dry-run command', () => {
  const created = createOne({ title: 'agent-cmds', type: 'web' });
  const id = created.task.id;
  assert.match(nextDispatch(created.state, id).command, /^agent-run --headless /);
  assert.equal(nextDispatch(created.state, id).requiresCoordinatorCoordination, true);
  const afterSpecify = step(created.state, id, 'generalist'); // specify -> implement(frontend)
  const d = nextDispatch(afterSpecify, id);
  assert.equal(d.agent, 'frontend');
  assert.match(d.command, /^agent-run --profile frontend /);
  assert.equal(d.requiresCoordinatorCoordination, false);
});

test('dispatch reports the external-action approval state', () => {
  const plain = createOne({ title: 'no-action' });
  assert.equal(nextDispatch(plain.state, plain.task.id).externalActionApproved, null);
  const gated = createOne({ title: 'deploy', externalAction: 'deploy' });
  assert.equal(nextDispatch(gated.state, gated.task.id).externalActionApproved, false);
});

test('dispatch throws for non-dispatchable tasks', () => {
  const done = createOne({ title: 'done-task' });
  const finished = FLOWS.build.actors.reduce((state, actor) => step(state, done.task.id, actor), done.state);
  assert.throws(() => nextDispatch(finished, done.task.id), /is already done/);

  const blocked = createOne({ title: 'blocked-task' });
  blocked.state.tasks[blocked.task.id].status = 'blocked';
  assert.throws(() => nextDispatch(blocked.state, blocked.task.id), /blocked and cannot be dispatched/);

  const locked = createOne({ title: 'locked-task' });
  const held = claimTask(locked.state, locked.task.id, 'generalist').state;
  assert.throws(() => nextDispatch(held, locked.task.id), /already held by generalist/);

  const orphan = createOne({ title: 'no-agent' });
  orphan.state.tasks[orphan.task.id].assignedAgent = null;
  assert.throws(() => nextDispatch(orphan.state, orphan.task.id), /no assigned agent/);

  // Any agent id a roster declares is dispatchable: the generic fallback template
  // covers teams whose agents are not called generalist/frontend/specialist.
  const custom = createOne({ title: 'custom-agent' });
  custom.state.tasks[custom.task.id].assignedAgent = 'ghost';
  const dispatched = nextDispatch(custom.state, custom.task.id);
  assert.deepEqual(dispatched.argv.slice(0, 3), ['agent-run', '--profile', 'ghost']);
});

// ── external-action approve gate ─────────────────────────────────────────────

test('an external action stays blocked until approved', () => {
  const r = createOne({ title: 'publish', externalAction: 'publish' });
  assert.equal(canRunExternalAction(r.state, r.task.id), false);
  assert.equal(r.task.externalAction.approved, false);
  assert.equal(r.task.externalAction.approvedBy, null);
  assert.equal(r.task.externalAction.scope, null);
});

test('tasks without an external action report null', () => {
  const r = createOne({ title: 'no-external' });
  assert.equal(canRunExternalAction(r.state, r.task.id), null);
  assert.throws(() => approveExternalAction(r.state, r.task.id, { approvedBy: 'user', scope: 'x' }), /has no external action to approve/);
});

test('approval requires both approvedBy and scope', () => {
  const r = createOne({ title: 'gate', externalAction: 'deploy' });
  assert.throws(() => approveExternalAction(r.state, r.task.id, {}), /Approval requires approvedBy and scope/);
  assert.throws(() => approveExternalAction(r.state, r.task.id, { approvedBy: 'user' }), /Approval requires approvedBy and scope/);
  assert.throws(() => approveExternalAction(r.state, r.task.id, { scope: 'deploy main' }), /Approval requires approvedBy and scope/);
});

test('an explicit approval unlocks the external action and is recorded', () => {
  const r = createOne({ title: 'approve-me', externalAction: 'deploy' });
  const out = approveExternalAction(r.state, r.task.id, { approvedBy: 'user', scope: 'deploy staging' });
  assert.equal(canRunExternalAction(out.state, r.task.id), true);
  assert.equal(out.task.externalAction.approvedBy, 'user');
  assert.equal(out.task.externalAction.scope, 'deploy staging');
  assert.equal(out.state.events.at(-1).type, 'external_action_approved');
  assert.equal(r.state.tasks[r.task.id].externalAction.approved, false, 'input state must stay unapproved');
});

// ── fail-closed on blocked tasks ─────────────────────────────────────────────

test('a blocked task refuses claim, complete and approve', () => {
  const blocked = createOne({ title: 'blocked-guard', externalAction: 'deploy' });
  blocked.state.tasks[blocked.task.id].status = 'blocked';
  assert.throws(() => claimTask(blocked.state, blocked.task.id, 'generalist'), /blocked and cannot be claimed/);
  assert.throws(() => completeStage(blocked.state, blocked.task.id, 'generalist'), /blocked and cannot complete/);
  assert.throws(() => approveExternalAction(blocked.state, blocked.task.id, { approvedBy: 'user', scope: 'x' }), /blocked and cannot approve/);
});

// ── recover ──────────────────────────────────────────────────────────────────

test('recover clears a stranded lock, keeps the phase and re-queues the task', () => {
  const r = createOne({ title: 'stranded', type: 'complex' });
  const held = claimTask(r.state, r.task.id, 'generalist').state;
  const out = recoverTask(held, r.task.id, { reason: 'worker process ended during probe' });
  assert.equal(out.task.lock, null);
  assert.equal(out.task.status, 'queued');
  assert.equal(out.task.assignedAgent, 'generalist');
  assert.equal(out.task.phase, 'specify');
  assert.equal(out.task.evidence.at(-1).agent, 'recovery');
  assert.match(out.task.evidence.at(-1).text, /^Recovered: worker process ended/);
  const recoveredEvent = out.state.events.at(-1);
  assert.equal(recoveredEvent.type, 'recovered');
  assert.equal(recoveredEvent.reason, 'worker process ended during probe');
  assert.equal(recoveredEvent.previous.status, 'in_progress');
});

test('recover also accepts a blocked task', () => {
  const r = createOne({ title: 'blocked-recoverable' });
  r.state.tasks[r.task.id].status = 'blocked';
  const out = recoverTask(r.state, r.task.id, { reason: 'block cleared by coordinator' });
  assert.equal(out.task.status, 'queued');
});

test('recover requires a reason and refuses unrecoverable tasks', () => {
  const r = createOne({ title: 'recover-guards' });
  assert.throws(() => recoverTask(r.state, r.task.id, {}), /Recovery requires a reason/);
  assert.throws(() => recoverTask(r.state, r.task.id, { reason: '   ' }), /Recovery requires a reason/);
  assert.throws(() => recoverTask(r.state, r.task.id, { reason: 'nothing stranded' }), /is not recoverable/);
});

test('a done task cannot be recovered', () => {
  const r = createOne({ title: 'done-recover' });
  const finished = FLOWS.build.actors.reduce((state, actor) => step(state, r.task.id, actor), r.state);
  assert.equal(finished.tasks[r.task.id].phase, 'done');
  assert.throws(() => recoverTask(finished, r.task.id, { reason: 'late' }), /is not recoverable/);
});

// ── sanitisation and dry-run guards on the sources ───────────────────────────

const RUNTIME_SOURCES = ['lib.mjs', 'orchestrator.mjs'];

for (const file of RUNTIME_SOURCES) {
  test('sanitisation: ' + file + ' contains no absolute machine path', () => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/[A-Za-z]:[\\/]/.test(src), 'drive-letter absolute path found in ' + file);
    // Assembled from fragments so this guard does not itself look like a machine path.
    assert.ok(!src.includes('/' + 'Users/'), 'user home path found in ' + file);
    assert.ok(!src.includes('\\' + 'Users\\'), 'windows user path found in ' + file);
    assert.ok(!/\bTODO\b/.test(src), 'placeholder left in ' + file);
  });

  test('dry run: ' + file + ' cannot spawn a process', () => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!src.includes('child_process'), 'child_process imported in ' + file);
    assert.ok(!/\bspawnSync?\s*\(/.test(src), 'spawn call found in ' + file);
    assert.ok(!/\bexecFile\s*\(/.test(src), 'execFile call found in ' + file);
    assert.ok(!/\bexec\s*\(/.test(src), 'exec call found in ' + file);
  });
}



// ── the task packet is an artifact, not prose (R3) ───────────────────────────────────
test('the specify stage cannot end without a spec and an acceptance criterion', () => {
  const state = createState();
  const created = createTask(state, { title: 'no-packet' });
  const claimed = claimTask(created.state, created.task.id, created.task.assignedAgent).state;
  assert.throws(
    () => completeStage(claimed, created.task.id, created.task.assignedAgent, {}),
    /without its work products: --spec, --acceptance/,
  );
  const done = completeStage(claimed, created.task.id, created.task.assignedAgent, {
    spec: 'add a settings page', acceptance: 'npm test exits 0', nonGoals: 'no deploy',
  }).state;
  const task = done.tasks[created.task.id];
  assert.equal(task.spec, 'add a settings page');
  assert.equal(task.acceptance, 'npm test exits 0');
  assert.equal(task.nonGoals, 'no deploy');
  assert.equal(task.phase, 'implement');
});

test('the packet may be supplied at create time instead', () => {
  const state = createState();
  const created = createTask(state, { title: 'packet-upfront', spec: 's', acceptance: 'a' });
  const claimed = claimTask(created.state, created.task.id, created.task.assignedAgent).state;
  const done = completeStage(claimed, created.task.id, created.task.assignedAgent, {}).state;
  assert.equal(done.tasks[created.task.id].phase, 'implement');
});


// ── a check that exists must also hold on every path into it ────────────────────────
test('E1 evidence carrying explicit nulls is refused, not just undefined', () => {
  const state = createState();
  const { state: created, task } = createTask(state, { title: 'nulls', rigor: 'L1' });
  const claimed = claimTask(created, task.id, task.assignedAgent).state;
  // This is the shape the CLI produced: the flags were absent, so it filled them with null,
  // and a check for `undefined` let a command-less, exit-code-less E1 through to done.
  const nulls = { grade: 'E1', text: 'tests ok', command: null, exitCode: null, revision: null };
  assert.throws(
    () => completeStage(claimed, task.id, task.assignedAgent, { evidence: nulls, spec: 's', acceptance: 'a' }),
    /E1 evidence must carry command, exitCode, revision/,
  );
});

test('the CLI cannot record an E1 without its fields (the layer that was broken)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e1-cli-'));
  const stateFile = join(dir, 'queue.json');
  const cli = fileURLToPath(new URL('./orchestrator.mjs', import.meta.url));
  const env = { ORCHESTRATOR_LOCK_WAIT_MS: '300' };
  const run = (args) => runCli(cli, stateFile, args, env);
  assert.equal((await run(['init'])).code, 0);
  const created = JSON.parse((await run(['create', '--title', 'e1', '--type', 'build'])).out);
  const id = created.id;
  // walk to the evidence phase, acting as whoever the queue assigns
  for (let i = 0; i < 6; i++) {
    const task = JSON.parse(readFileSync(stateFile, 'utf8')).tasks[id];
    if (task.phase === 'evidence' || task.phase === 'done') break;
    const agent = task.assignedAgent;
    await run(['claim', '--task', id, '--agent', agent]);
    const args = ['complete', '--task', id, '--agent', agent, '--evidence', 'stage done'];
    if (task.phase === 'specify') args.push('--spec', 's', '--acceptance', 'a');
    await run(args);
  }
  const before = JSON.parse(readFileSync(stateFile, 'utf8')).tasks[id];
  assert.equal(before.phase, 'evidence', 'the walk should stop at the evidence phase');
  await run(['claim', '--task', id, '--agent', before.assignedAgent]);
  const bad = await run(['complete', '--task', id, '--agent', before.assignedAgent,
    '--evidence-grade', 'E1', '--evidence', 'tests ok']);
  assert.equal(bad.code, 1, 'an E1 with no command, exit code or revision must be refused');
  assert.match(bad.err, /must carry command, exitCode, revision/);
  const after = JSON.parse(readFileSync(stateFile, 'utf8')).tasks[id];
  assert.notEqual(after.phase, 'done');
  assert.ok(!(after.evidence || []).some((e) => e.grade === 'E1' && e.command == null), 'no null-bearing E1 may be stored');
});

test('an L3 task must state the three start choices, even without --important', () => {
  const state = createState();
  // L3 is consequential by definition, so the intake gate applies whether or not the caller says so.
  assert.throws(
    () => createTask(state, { title: 'consequential', rigor: 'L3' }),
    /Important task requires: --execution-mode, --security, --independent-verify/,
  );
  const ok = createTask(state, { title: 'consequential', rigor: 'L3',
    executionMode: 'collaborative', security: 'planned', independentVerify: 'planned' });
  assert.equal(ok.task.important, true, 'an L3 task is important by definition');
  assert.equal(ok.task.startChoicesSource, 'stated');
});
// ── the other grades, and the L1 rung of the rigor ladder ────────────────────────────
test('E2 must name a peer, and the peer must not be the author', () => {
  const state = createState();
  const { state: created, task } = createTask(state, { title: 'peer', rigor: 'L1' });
  const claimed = claimTask(created, task.id, task.assignedAgent).state;
  const payload = (ev) => ({ evidence: ev, spec: 's', acceptance: 'a' });
  assert.throws(
    () => completeStage(claimed, task.id, task.assignedAgent, payload({ grade: 'E2', text: 'looks right' })),
    /must name the peer/,
  );
  assert.throws(
    () => completeStage(claimed, task.id, task.assignedAgent, payload({ grade: 'E2', text: 'x', checkedBy: task.assignedAgent })),
    /must differ from the author/,
  );
  const ok = completeStage(claimed, task.id, task.assignedAgent,
    payload({ grade: 'E2', text: 're-ran it', checkedBy: 'someone-else', steps: 'node --test' })).state;
  assert.equal(ok.tasks[task.id].evidence.at(-1).grade, 'E2');
});

test('E4 must say what is planned', () => {
  const state = createState();
  const { state: created, task } = createTask(state, { title: 'planned', rigor: 'L1' });
  const claimed = claimTask(created, task.id, task.assignedAgent).state;
  assert.throws(
    () => completeStage(claimed, task.id, task.assignedAgent, { evidence: { grade: 'E4', text: 'later' }, spec: 's', acceptance: 'a' }),
    /say what is planned/,
  );
  const ok = completeStage(claimed, task.id, task.assignedAgent,
    { evidence: { grade: 'E4', plan: 'run the suite after the refactor' }, spec: 's', acceptance: 'a' }).state;
  assert.equal(ok.tasks[task.id].evidence.at(-1).grade, 'E4');
});

test('L1 may be self-verified, L2 may not', () => {
  const pack = { spec: 's', acceptance: 'a' };
  // L1: the implementer completes the verify stage, and the record says so.
  const l1 = createTask(createState(), { title: 'local', rigor: 'L1' });
  const done = driveToDone(l1.state, l1.task.id, 'ran the unit tests: exit 0');
  assert.equal(done.tasks[l1.task.id].phase, 'done');
  assert.equal(done.tasks[l1.task.id].verification.selfVerified, true);
  assert.equal(
    done.tasks[l1.task.id].verification.by,
    done.tasks[l1.task.id].evidence.at(-1).agent,
    'for L1 the verifier is the implementer',
  );
  // L2: verification must come from a different agent, so the same walk cannot even reach verify.
  const l2 = createTask(createState(), { title: 'shared', rigor: 'L2' });
  const l2done = driveToDone(l2.state, l2.task.id, 'ran the suite: exit 0');
  assert.equal(l2done.tasks[l2.task.id].phase, 'done');
  const verdict = l2done.tasks[l2.task.id].verification;
  assert.notEqual(verdict.by, undefined);
  assert.ok(!verdict.selfVerified, 'L2 must not be self-verified');
  assert.ok(pack);
});
// ── the intake gate must not answer for the user ─────────────────────────────────────
test('a task with an external action must state all three start choices', () => {
  const state = createState();
  // Refused either because it is not L3 or because the three choices are missing - both are the
  // point: an external action has to be consequential AND explicitly answered for.
  assert.throws(
    () => createTask(state, { title: 'deploy', type: 'build', externalAction: 'deploy' }),
    /must be L3|requires all three start choices/,
  );
  assert.throws(
    () => createTask(state, { title: 'deploy', type: 'build', rigor: 'L3', externalAction: 'deploy' }),
    /Important task requires: --execution-mode, --security, --independent-verify/,
  );
  const ok = createTask(state, { title: 'deploy', type: 'build', rigor: 'L3', externalAction: 'deploy', important: true,
    executionMode: 'collaborative', security: 'planned', independentVerify: 'planned' });
  assert.equal(ok.task.startChoicesSource, 'stated');
});

test('a routine task records that its start choices were assumed, not stated', () => {
  const state = createState();
  const created = createTask(state, { title: 'routine', type: 'build' }).task;
  assert.equal(created.startChoicesSource, 'defaults');
  assert.deepEqual(created.startChoices, { executionMode: 'single', security: 'skip', independentVerify: 'skip' });
});

// ── rigor decides what is mandatory (R1) and who may verify (R2) ─────────────────────
test('L2 cannot reach done without a graded evidence record', () => {
  const state = createState();
  const { state: created, task } = createTask(state, { title: 'shared', rigor: 'L2' });
  assert.throws(() => driveToDone(created, task.id), /requires at least one graded evidence record/);
  const finished = driveToDone(created, task.id, 'ran the suite: exit 0');
  assert.equal(finished.tasks[task.id].phase, 'done');
});

test('an L3 verifier may not also be an author of the evidence', () => {
  // One agent owns both verify and evidence, while a different agent implements.
  const roster = {
    agents: {
      impl:   { cost: 1, scores: { specify: 3, triage: 1, implement: 3, verify: 1, evidence: 1, environment: 1 } },
      solo:   { cost: 2, scores: { specify: 2, triage: 1, implement: 1, verify: 3, evidence: 3, environment: 1 } },
      other:  { cost: 3, scores: { specify: 1, triage: 1, implement: 1, verify: 2, evidence: 2, environment: 1 } },
    },
    routes: { specify: 'impl', implement: 'impl', verify: 'solo', evidence: 'solo' },
  };
  const state = createState(roster);
  const { state: created, task } = createTask(state, { title: 'consequential', rigor: 'L3', executionMode: 'collaborative', security: 'planned', independentVerify: 'planned' });
  const evidence = { grade: 'E1', text: 'gate evidence', command: 'node scripts/gate.mjs', exitCode: 0, revision: 'abc123' };
  assert.throws(
    () => driveToDone(created, task.id, evidence),
    /also produced evidence on this task|not independent/,
  );
});


// ── concurrency: two writers at once ─────────────────────────────────────────

// ── rigor: how much verification a change carries ─────────────────────────────────────

/** Drive a task from its current phase to done, optionally supplying evidence at the last step. */
function driveToDone(state, id, evidence) {
  let current = state;
  for (let i = 0; i < 10; i++) {
    const task = current.tasks[id];
    if (task.phase === 'done') return current;
    const agent = task.assignedAgent;
    const at = current.tasks[id].phase;
    current = claimTask(current, id, agent).state;
    const payload = at === 'specify'
      ? { spec: 'the change under test', acceptance: 'the suite exits 0' }
      : (at === 'evidence' && evidence ? { evidence } : {});
    current = completeStage(current, id, agent, payload).state;
  }
  throw new Error('task did not reach done: ' + current.tasks[id].phase);
}

test('rigor defaults to L2 and must be a level the engine accepts', () => {
  const state = createState();
  assert.equal(createTask(state, { title: 'defaulted' }).task.rigor, 'L2');
  for (const level of RIGOR_LEVELS) {
    // L3 is consequential, so it has to answer the intake questions; L1 and L2 need not.
    const extra = level === 'L3' ? { executionMode: 'collaborative', security: 'planned', independentVerify: 'planned' } : {};
    assert.equal(createTask(state, { title: 'r-' + level, rigor: level, ...extra }).task.rigor, level);
  }
  assert.throws(() => createTask(state, { title: 'bad', rigor: 'L9' }), /Invalid rigor/);
});

test('an external action must be L3 - L1 and L2 are both refused', () => {
  const state = createState();
  assert.throws(
    () => createTask(state, { title: 'deploy', rigor: 'L1', externalAction: 'deploy' }),
    /must be L3/,
  );
  assert.throws(
    () => createTask(state, { title: 'deploy', rigor: 'L2', externalAction: 'deploy' }),
    /must be L3/,
    'L2 only requires a different verifier, which is not enough for something irreversible',
  );
  const ok = createTask(state, { title: 'deploy', rigor: 'L3', externalAction: 'deploy', important: true,
    executionMode: 'collaborative', security: 'planned', independentVerify: 'planned' });
  assert.equal(ok.task.rigor, 'L3');
});

test('a bare evidence string is stored as E3 and labelled, never as E1', () => {
  const state = createState();
  const { state: created, task } = createTask(state, { title: 'e3', rigor: 'L1' });
  const claimed = claimTask(created, task.id, task.assignedAgent).state;
  const done = completeStage(claimed, task.id, task.assignedAgent, { evidence: 'looks fine to me', spec: 's', acceptance: 'a' }).state;
  const record = done.tasks[task.id].evidence.at(-1);
  assert.equal(record.grade, 'E3');
  assert.match(record.note, /downgraded to E3/);
  assert.equal(record.text, 'looks fine to me');
});

test('E1 evidence must carry the command, the exit code and the revision', () => {
  const state = createState();
  const { state: created, task } = createTask(state, { title: 'e1', rigor: 'L1' });
  const claimed = claimTask(created, task.id, task.assignedAgent).state;
  const partial = { grade: 'E1', text: 'tests pass', command: 'npm test' }; // no exitCode, no revision
  assert.throws(
    () => completeStage(claimed, task.id, task.assignedAgent, { evidence: partial, spec: 's', acceptance: 'a' }),
    /E1 evidence must carry exitCode, revision/,
  );
  const full = { grade: 'E1', text: 'tests pass', command: 'npm test', exitCode: 0, revision: 'abc123' };
  const done = completeStage(claimed, task.id, task.assignedAgent, { evidence: full, spec: 's', acceptance: 'a' }).state;
  assert.equal(done.tasks[task.id].evidence.at(-1).grade, 'E1');
  assert.equal(done.tasks[task.id].evidence.at(-1).exitCode, 0);
});

test('an L3 task cannot reach done without E1 evidence', () => {
  const state = createState();
  const { state: created, task } = createTask(state, { title: 'consequential', rigor: 'L3', executionMode: 'collaborative', security: 'planned', independentVerify: 'planned' });
  // Self-report only: the last step must refuse.
  assert.throws(() => driveToDone(created, task.id, 'I checked it'), /cannot reach done without E1 evidence/);
  // With a reproducible artifact it goes through.
  const finished = driveToDone(created, task.id, {
    grade: 'E1', text: 'gate evidence', command: 'node scripts/gate.mjs', exitCode: 0, revision: 'abc123',
  });
  assert.equal(finished.tasks[task.id].phase, 'done');
  assert.ok(EVIDENCE_GRADES.includes(finished.tasks[task.id].evidence.at(-1).grade));
});

function runCli(cliPath, stateFile, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ORCHESTRATOR_STATE: stateFile, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('four concurrent creates: every task survives (no lost update)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-orchestra-'));
  const stateFile = join(dir, 'queue.json');
  const cli = fileURLToPath(new URL('./orchestrator.mjs', import.meta.url));

  const init = await runCli(cli, stateFile, ['init']);
  assert.equal(init.code, 0, init.err);

  // All four processes read the same revision and then try to write. Without the
  // read-modify-write lock they all allocate task-0001 and three writes are lost.
  const results = await Promise.all(
    [1, 2, 3, 4].map((n) => runCli(cli, stateFile, ['create', '--title', 'race-' + n, '--type', 'build'])),
  );
  const failures = results.filter((r) => r.code !== 0).map((r) => r.err.trim());
  assert.deepEqual(failures, [], 'every concurrent create should succeed: ' + JSON.stringify(failures));

  const final = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.deepEqual(Object.keys(final.tasks).sort(), ['task-0001', 'task-0002', 'task-0003', 'task-0004']);
  assert.equal((final.events ?? []).filter((e) => e.type === 'created').length, 4);
  assert.equal(final.nextTaskNumber, 5);

  // Atomic write + lock leave nothing behind.
  assert.deepEqual(readdirSync(dir).sort(), ['queue.json']);
});

test('the lock refuses a second writer, and a stale lock is recovered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-orchestra-'));
  const stateFile = join(dir, 'queue.json');
  const lockFile = stateFile + '.lock';
  const cli = fileURLToPath(new URL('./orchestrator.mjs', import.meta.url));
  const fast = { ORCHESTRATOR_LOCK_WAIT_MS: '300' };
  await runCli(cli, stateFile, ['init']);

  // A fresh lock (another process may be mid-write) makes this command refuse to write.
  writeFileSync(lockFile, 'someone-else\n', 'utf8');
  const blocked = await runCli(cli, stateFile, ['create', '--title', 'blocked', '--type', 'build'], fast);
  assert.equal(blocked.code, 1);
  assert.match(blocked.err, /locked by another process/);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(stateFile, 'utf8')).tasks), []);

  // A lock left by a crashed process is stolen once it is stale, so it never wedges.
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockFile, old, old);
  const recovered = await runCli(cli, stateFile, ['create', '--title', 'after-crash', '--type', 'build'], fast);
  assert.equal(recovered.code, 0, recovered.err);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(stateFile, 'utf8')).tasks), ['task-0001']);
  assert.deepEqual(readdirSync(dir).sort(), ['queue.json']);
});

test('the CLI resolves the queue file relative to the module', () => {
  const src = readFileSync(new URL('orchestrator.mjs', import.meta.url), 'utf8');
  assert.match(src, /new URL\('TASK-QUEUE\.json', import\.meta\.url\)/);
});

test('the default agent roster is available to callers', () => {
  assert.deepEqual(AGENTS, ['generalist', 'frontend', 'specialist']);
});

// ── roster genericity: any size, any agent names ─────────────────────────────

const SIX_AGENT_ROSTER = {
  agents: {
    planner: { cost: 2, scores: { specify: 3, implement: 1, verify: 1, evidence: 3 } },
    builder1: { cost: 4, specialties: ['full'], scores: { specify: 1, implement: 3, verify: 1, evidence: 1 } },
    builder2: { cost: 5, specialties: ['web'], scores: { specify: 1, implement: 2, verify: 1, evidence: 1 } },
    auditorA: { cost: 6, specialties: ['verify'], scores: { specify: 1, implement: 1, verify: 3, evidence: 2 } },
    auditorB: { cost: 7, specialties: ['verify'], scores: { specify: 1, implement: 1, verify: 3, evidence: 2 } },
    scribe: { cost: 1, scores: { specify: 1, implement: 1, verify: 0, evidence: 3 } },
  },
  routes: { specify: 'planner', evidence: 'scribe', implement: { build: 'builder1', web: 'builder2' } },
};

test('a six-agent roster with custom names routes without any code change', () => {
  const created = createTask(createState(SIX_AGENT_ROSTER), { title: 'six-agents', type: 'build' });
  const state = created.state;
  const id = created.task.id;
  assert.equal(Object.keys(state.roster.agents).length, 6);
  assert.equal(implementerForType('build', state.roster), 'builder1');
  assert.equal(implementerForType('web', state.roster), 'builder2');
  assert.equal(ownerFor('specify', { roster: state.roster }), 'planner');
  assert.equal(ownerFor('evidence', { roster: state.roster }), 'scribe');
  // The verifier is scored, never the implementer: auditorA outranks auditorB on cost.
  assert.equal(selectVerifier('builder1', state.roster), 'auditorA');
  assert.equal(selectVerifier('auditorA', state.roster), 'auditorB');

  // And the whole pipeline runs end to end for a custom roster.
  let s = step(state, id, 'planner');
  s = step(s, id, 'builder1');
  assert.equal(s.tasks[id].assignedAgent, 'auditorA');
  s = step(s, id, 'auditorA');
  s = step(s, id, 'scribe');
  assert.equal(s.tasks[id].phase, 'done');
});

test('the verifier ranking scales and stays deterministic', () => {
  const roster = {
    agents: {
      a: { cost: 9, scores: { verify: 2 } },
      b: { cost: 1, scores: { verify: 2 } },
      c: { cost: 5, scores: { verify: 1 } },
      impl: { cost: 1, scores: { verify: 3, implement: 3 } },
    },
  };
  // impl has the highest score but is excluded; b beats a on cost at equal score.
  assert.equal(selectVerifier('impl', roster), 'b');
  assert.equal(selectAgent('verify', { roster }).id, 'impl');
  assert.equal(selectAgent('verify', { roster, exclude: ['impl'] }).id, 'b');
  // Capability match outranks cost at equal score.
  const specialised = {
    agents: {
      cheap: { cost: 1, scores: { verify: 2 } },
      webby: { cost: 9, specialties: ['web'], scores: { verify: 2 } },
    },
  };
  assert.equal(selectAgent('verify', { roster: specialised, capability: 'web' }).id, 'webby');
});

test('a roster with nobody scored for verification fails closed', () => {
  const roster = { agents: { solo: { cost: 1, scores: { implement: 3 } } } };
  assert.throws(() => selectVerifier('other', roster), /No agent in the roster is scored for verification/);
});

test('validateRoster rejects malformed rosters loudly', () => {
  assert.throws(() => validateRoster({}), /must look like/);
  assert.throws(() => validateRoster({ agents: {} }), /at least one agent/);
  assert.throws(() => validateRoster({ agents: { a: { scores: { verify: 4 } } } }), /score for verify must be a number 0-3/);
  assert.throws(() => validateRoster({ agents: { a: { scores: { auditing: 1 } } } }), /unknown role "auditing"/);
  assert.throws(() => validateRoster({ agents: { a: { cost: 'cheap' } } }), /cost must be a number/);
  assert.throws(() => validateRoster({ agents: { a: { specialties: 'web' } } }), /specialties must be an array/);
  assert.doesNotThrow(() => validateRoster(SIX_AGENT_ROSTER));
});

// ── the verification gate ────────────────────────────────────────────────────

function atVerify(title = 'gate-task', type = 'build') {
  const created = createOne({ title, type });
  const id = created.task.id;
  let s = step(created.state, id, 'generalist'); // specify -> implement
  s = step(s, id, implementerForType(type)); // implement -> verify
  const verifier = s.tasks[id].assignedAgent;
  s = claimTask(s, id, verifier).state;
  return { state: s, id, verifier, implementer: implementerForType(type) };
}

test('a failed verification blocks the gate and returns the task to implement', () => {
  const g = atVerify();
  const out = failVerification(g.state, g.id, g.verifier, { criteria: 'acceptance test X fails' });
  const task = out.task;
  assert.equal(task.phase, 'implement');
  assert.equal(task.assignedAgent, g.implementer);
  assert.equal(task.verification.status, 'failed');
  assert.equal(task.verification.blocked, true);
  assert.equal(task.verification.lastResult, 'fail');
  assert.equal(task.verification.criteria, 'acceptance test X fails');
  assert.equal(task.verification.by, g.verifier);
  assert.equal(task.lock, null);
  assert.equal(out.state.events.at(-1).type, 'verification_failed');
});

test('failVerification demands the verify stage and a stated failure', () => {
  const r = createOne({ title: 'not-verifying' });
  // Task is in specify: not a verify stage.
  assert.throws(() => failVerification(r.state, r.task.id, 'generalist', { findings: 'x' }), /not in the verify stage/);
  const g = atVerify();
  assert.throws(() => failVerification(g.state, g.id, g.verifier, {}), /must state the failing criteria or the findings/);
  // Only the lock holder may fail the stage.
  assert.throws(() => failVerification(g.state, g.id, 'someone-else', { findings: 'x' }), /must be claimed by/);
});

test('the gate cannot be walked past: no done without a pass or an override', () => {
  const g = atVerify();
  const failed = failVerification(g.state, g.id, g.verifier, { findings: 'flaky' }).state;
  // Simulate a queue edited by hand into the final stage: the gate still refuses.
  const doctored = structuredClone(failed);
  const task = doctored.tasks[g.id];
  task.phase = 'evidence';
  task.assignedAgent = ownerFor('evidence', { roster: doctored.roster });
  task.lock = { owner: task.assignedAgent, claimedAt: new Date().toISOString() };
  task.status = 'in_progress';
  assert.throws(() => completeStage(doctored, g.id, task.assignedAgent), /verification has not passed/);
  // And it is not dispatchable either.
  const unclaimed = structuredClone(doctored);
  unclaimed.tasks[g.id].lock = null;
  unclaimed.tasks[g.id].status = 'queued';
  assert.throws(() => nextDispatch(unclaimed, g.id), /is gated/);
});

test('reworking and passing the verify stage opens the gate', () => {
  const g = atVerify();
  let s = failVerification(g.state, g.id, g.verifier, { findings: 'flaky' }).state;
  const blocked = s.tasks[g.id];
  s = claimTask(s, g.id, blocked.assignedAgent).state;
  s = completeStage(s, g.id, blocked.assignedAgent, { evidence: 'fixed the flake' }).state;
  const verifier = s.tasks[g.id].assignedAgent;
  s = claimTask(s, g.id, verifier).state;
  s = completeStage(s, g.id, verifier, { evidence: 'reproduced, exit 0' }).state;
  assert.equal(s.tasks[g.id].verification.status, 'passed');
  assert.equal(s.tasks[g.id].verification.blocked, false);
  assert.equal(s.tasks[g.id].verification.attempts, 2);
  s = claimTask(s, g.id, s.tasks[g.id].assignedAgent).state;
  s = completeStage(s, g.id, s.tasks[g.id].lock.owner).state;
  assert.equal(s.tasks[g.id].phase, 'done');
});

test('an override needs an approver, a scope and a reason, and is recorded', () => {
  const g = atVerify();
  const failed = failVerification(g.state, g.id, g.verifier, { findings: 'known flake' }).state;
  assert.throws(() => overrideVerificationGate(failed, g.id, { approvedBy: 'user' }), /requires approvedBy, scope and reason/);
  assert.throws(() => overrideVerificationGate(failed, g.id, { approvedBy: 'user', scope: 'ship it' }), /requires approvedBy, scope and reason/);
  const out = overrideVerificationGate(failed, g.id, { approvedBy: 'user', scope: 'release 2.1', reason: 'flake is pre-existing' });
  assert.equal(out.task.verification.blocked, false);
  // The failure is kept next to the override - an override never erases the record.
  assert.equal(out.task.verification.status, 'failed');
  assert.equal(out.task.verification.override.approvedBy, 'user');
  assert.equal(out.task.verification.override.scope, 'release 2.1');
  assert.equal(out.task.verification.override.reason, 'flake is pre-existing');
  assert.equal(out.state.events.at(-1).type, 'verification_gate_overridden');
  // With the override recorded, the final stage is allowed.
  const doctorable = structuredClone(out.state);
  const task = doctorable.tasks[g.id];
  task.phase = 'evidence';
  task.lock = { owner: task.assignedAgent, claimedAt: new Date().toISOString() };
  task.status = 'in_progress';
  const done = completeStage(doctorable, g.id, task.assignedAgent);
  assert.equal(done.task.phase, 'done');
});

test('a clean run passes the gate with no override', () => {
  const created = createOne({ title: 'clean' });
  const id = created.task.id;
  let s = FLOWS.build.actors.reduce((state, actor) => step(state, id, actor), created.state);
  const task = s.tasks[id];
  assert.equal(task.phase, 'done');
  assert.equal(task.verification.status, 'passed');
  assert.equal(task.verification.blocked, false);
  assert.equal(task.verification.override, null);
  assert.equal(task.verification.attempts, 1);
});