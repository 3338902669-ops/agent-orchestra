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
import { readFileSync } from 'node:fs';

import {
  AGENTS,
  CAPABILITIES,
  DEFAULT_START_CHOICES,
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
  nextDispatch,
  recoverTask,
  shellQuote,
  verifierFor,
} from './lib.mjs';

function createOne(input) {
  return createTask(createState(), input);
}

function step(state, id, agent, evidence = '') {
  const claimed = claimTask(state, id, agent).state;
  return completeStage(claimed, id, agent, { evidence }).state;
}

// ── state shape ──────────────────────────────────────────────────────────────

test('createState returns an empty schema-v3 queue', () => {
  const state = createState();
  assert.equal(state.version, STATE_VERSION);
  assert.equal(state.version, 3);
  assert.equal(state.nextTaskNumber, 1);
  assert.deepEqual(state.tasks, {});
  assert.deepEqual(state.events, []);
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
  web:         { phases: ['specify', 'implement', 'verify', 'evidence', 'done'], actors: ['generalist', 'frontend', 'generalist', 'generalist'] },
  complex:     { phases: ['specify', 'implement', 'verify', 'evidence', 'done'], actors: ['generalist', 'specialist', 'generalist', 'generalist'] },
  verify:      { phases: ['specify', 'implement', 'verify', 'evidence', 'done'], actors: ['generalist', 'specialist', 'generalist', 'generalist'] },
  environment: { phases: ['specify', 'triage', 'implement', 'verify', 'evidence', 'done'], actors: ['generalist', 'frontend', 'frontend', 'generalist', 'generalist'] },
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
  assert.equal(verifierFor('frontend'), 'generalist');
  assert.equal(verifierFor('specialist'), 'generalist');
});

test('completeStage without the claim is rejected', () => {
  const r = createOne({ title: 'unclaimed' });
  assert.throws(() => completeStage(r.state, r.task.id, 'generalist'), /must be claimed by generalist/);
});

test('completeStage records evidence supplied by the owner', () => {
  const r = createOne({ title: 'evidence' });
  const claimed = claimTask(r.state, r.task.id, 'generalist').state;
  const out = completeStage(claimed, r.task.id, 'generalist', { evidence: 'exit code 0' });
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

  const unknown = createOne({ title: 'no-command' });
  unknown.state.tasks[unknown.task.id].assignedAgent = 'ghost';
  assert.throws(() => nextDispatch(unknown.state, unknown.task.id), /no dispatch command for agent ghost/);
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

test('the CLI resolves the queue file relative to the module', () => {
  const src = readFileSync(new URL('orchestrator.mjs', import.meta.url), 'utf8');
  assert.match(src, /new URL\('TASK-QUEUE\.json', import\.meta\.url\)/);
});

test('the default agent roster is available to callers', () => {
  assert.deepEqual(AGENTS, ['generalist', 'frontend', 'specialist']);
});
