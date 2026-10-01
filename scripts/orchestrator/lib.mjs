// lib.mjs — dependency-free orchestration state machine (Node 18+, ESM).
//
// Portable, sanitised port of a local agent-orchestrator runtime. Preserved behaviour:
//   * stage machine: specify -> [triage] -> implement -> verify -> evidence -> done
//   * single-writer claim locks: one owner per task at a time
//   * capability labels: full | web | complex | verify | environment
//   * important tasks must pass all three start choices explicitly
//   * external actions stay unapproved until an approval record is written
//   * dispatch returns a DRY-RUN command only; this module never starts a process
//
// Every mutator is pure: it returns { state, task } with a copied state and never
// mutates the state object it was handed. State is plain JSON (structuredClone-able).

export const STATE_VERSION = 3;

/** Capability labels a task may carry. Describes which roles can be dispatched. */
export const CAPABILITIES = ['full', 'web', 'complex', 'verify', 'environment'];

/** Task types. The type decides routing; capability is an independent label. */
export const TYPES = ['build', 'web', 'complex', 'verify', 'environment'];

/** Agent identities used by the default routing table. Replace with your own roster. */
export const AGENTS = ['generalist', 'frontend', 'specialist'];

/** Pipeline stages in order. `triage` is only used by `environment` tasks. */
export const STAGES = ['specify', 'triage', 'implement', 'verify', 'evidence', 'done'];

/** Allowed values for the three start choices. */
export const EXECUTION_MODES = ['single', 'collaborative'];
export const PLAN_CHOICES = ['planned', 'skip'];

/** Default workspace label. Relative on purpose: no machine path is baked in. */
export const DEFAULT_WORKSPACE = '.';

/** Default start choices for a task that does not declare them. */
export const DEFAULT_START_CHOICES = Object.freeze({
  executionMode: 'single',
  security: 'skip',
  independentVerify: 'skip',
});

// Per-type routing table.
//   triage    — optional extra stage handed to another agent (environment only).
//   implement — who owns the implement stage for this type.
// The specify stage is always owned by the coordinator ('generalist'); evidence
// likewise. The verify owner is derived so that verifier !== implementer.
const ROUTES = Object.freeze({
  build:       Object.freeze({ triage: null,       implement: 'generalist' }),
  web:         Object.freeze({ triage: null,       implement: 'frontend'   }),
  complex:     Object.freeze({ triage: null,       implement: 'specialist' }),
  verify:      Object.freeze({ triage: null,       implement: 'specialist' }),
  environment: Object.freeze({ triage: 'frontend', implement: 'frontend'   }),
});

// Dry-run command templates. These are PLACEHOLDERS: swap `agent-run` for your own
// runner. Each template returns an ARGV ARRAY, never a shell string: task titles and
// workspaces are free-form text, and JSON.stringify is a JSON encoder, not a shell
// quoter (it leaves `$(...)`, backticks, `${...}` and `!` live inside double quotes).
export const COMMAND_TEMPLATES = Object.freeze({
  generalist: (prompt) => ['agent-run', '--headless', prompt],
  frontend:   (prompt) => ['agent-run', '--profile', 'frontend', prompt],
  specialist: (prompt) => ['agent-run', '--profile', 'specialist', prompt],
});

/** Characters that need no quoting in a POSIX shell. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Quote one value for a POSIX shell. Values made only of safe characters pass
 * through unchanged so the printed command stays readable; everything else is
 * wrapped in single quotes with embedded single quotes escaped as '\''.
 * This is the shlex.quote rule, not JSON.stringify: JSON leaves $(...), backticks,
 * ${...} and ! live inside its double quotes, which is how a free-form task title
 * becomes command execution when the printed line is pasted into a shell.
 * Prefer the argv array when you can — it needs no quoting at all.
 */
export function shellQuote(value) {
  const text = String(value);
  if (text === '') return "''";
  if (SHELL_SAFE.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Render an argv array as a POSIX shell command line. Display only — prefer argv. */
export function renderCommand(argv) {
  return argv.map(shellQuote).join(' ');
}

function copy(value) {
  return structuredClone(value);
}

function now() {
  return new Date().toISOString();
}

function event(state, taskId, type, detail = {}) {
  state.events.push({ at: now(), taskId, type, ...detail });
}

/** Capability label implied by a task type. Unknown/build types fall back to 'full'. */
export function capabilityForType(type) {
  switch (type) {
    case 'web': return 'web';
    case 'complex': return 'complex';
    case 'verify': return 'verify';
    case 'environment': return 'environment';
    default: return 'full';
  }
}

/** Who implements the current type. */
export function implementerForType(type) {
  return (ROUTES[type] ?? ROUTES.build).implement;
}

/**
 * Independent verifier for an implementer: always a different agent.
 * Mirrors the source invariant: when the coordinator implemented, the specialist
 * verifies; any other implementer is verified by the coordinator.
 */
export function verifierFor(implementer) {
  return implementer === 'generalist' ? 'specialist' : 'generalist';
}

function route(type) {
  // Every type starts in `specify` with the coordinator.
  void type;
  return { phase: 'specify', agent: 'generalist' };
}

function requireTask(state, id) {
  const task = state.tasks[id];
  if (!task) throw new Error(`Unknown task: ${id}`);
  return task;
}

function requireOwner(task, agent) {
  if (!task.lock || task.lock.owner !== agent) {
    throw new Error(`Task ${task.id} must be claimed by ${agent} before this action`);
  }
}

function agentCommand(task) {
  const sc = task.startChoices ?? DEFAULT_START_CHOICES;
  // Every dry-run prompt carries: title, phase, workspace, capability, start choices,
  // write boundary, verifier independence, evidence requirements and the
  // external-action gate. It is text for a human (or a runner) to inspect.
  const prompt = [
    `Execute only task ${task.id}: ${task.title}.`,
    `Phase: ${task.phase}.`,
    `Capability: ${task.capability}.`,
    `Workspace: ${task.workspace}.`,
    `Execution mode: ${sc.executionMode}.`,
    `Security: ${sc.security}.`,
    `Independent verify: ${sc.independentVerify}.`,
    'When security is "planned", do not start a scan until the user confirms again.',
    "Write boundary: modify files only within the task's explicit write scope; do not touch the queue file, handoff notes, shared rules, or any file outside the task's declared workspace unless the task carries an explicit approval.",
    'Verifier independence: the verifier for this task is a different agent from the implementer; never verify your own implementation.',
    'Evidence: record changed files, commands, exit codes, and evidence through the orchestrator, and write a machine-readable JSON result under the task workspace outputs directory.',
    'External actions: never deploy, send external messages, publish, or delete data without an explicit user approval recorded in the orchestrator.',
    'Headless workers: before editing, state the allowed write paths; run the stated verification commands; write the machine-readable JSON result; and report changed files, commands, exit codes, evidence, and unresolved items.',
  ].join(' ');
  const template = COMMAND_TEMPLATES[task.assignedAgent];
  if (!template) return null;
  const argv = template(prompt);
  return { argv, command: renderCommand(argv) };
}

/** A fresh, empty orchestrator state. */
export function createState() {
  return { version: STATE_VERSION, migration: null, nextTaskNumber: 1, tasks: {}, events: [] };
}

/**
 * Create a task from a plain input object.
 * Required: title. Optional: type, capability, workspace, externalAction, important,
 * executionMode, security, independentVerify.
 * Important tasks must supply all three start choices or the call is rejected.
 */
export function createTask(state, input) {
  if (!input?.title?.trim()) throw new Error('Task title is required');
  const next = copy(state);
  const id = `task-${String(next.nextTaskNumber).padStart(4, '0')}`;
  next.nextTaskNumber += 1;
  const type = input.type ?? 'build';
  if (!TYPES.includes(type)) throw new Error(`Invalid type: ${type} (allowed: ${TYPES.join(', ')})`);
  const capability = input.capability ?? capabilityForType(type);
  if (!CAPABILITIES.includes(capability)) {
    throw new Error(`Invalid capability: ${capability} (allowed: ${CAPABILITIES.join(', ')})`);
  }
  // Start choices: important tasks must state all three explicitly, so that an
  // important task can never enter the queue with an implied scan or collaboration mode.
  const important = input.important === true;
  const executionMode = input.executionMode;
  const security = input.security;
  const independentVerify = input.independentVerify;
  if (executionMode !== undefined && !EXECUTION_MODES.includes(executionMode)) {
    throw new Error(`Invalid execution-mode: ${executionMode} (allowed: ${EXECUTION_MODES.join(', ')})`);
  }
  if (security !== undefined && !PLAN_CHOICES.includes(security)) {
    throw new Error(`Invalid security: ${security} (allowed: ${PLAN_CHOICES.join(', ')})`);
  }
  if (independentVerify !== undefined && !PLAN_CHOICES.includes(independentVerify)) {
    throw new Error(`Invalid independent-verify: ${independentVerify} (allowed: ${PLAN_CHOICES.join(', ')})`);
  }
  if (important) {
    const missing = [];
    if (!executionMode) missing.push('--execution-mode');
    if (!security) missing.push('--security');
    if (!independentVerify) missing.push('--independent-verify');
    if (missing.length) throw new Error(`Important task requires: ${missing.join(', ')}`);
  }
  const startChoices = {
    executionMode: executionMode ?? DEFAULT_START_CHOICES.executionMode,
    security: security ?? DEFAULT_START_CHOICES.security,
    independentVerify: independentVerify ?? DEFAULT_START_CHOICES.independentVerify,
  };
  const initial = route(type);
  const task = {
    id,
    title: input.title.trim(),
    type,
    capability,
    workspace: input.workspace ?? DEFAULT_WORKSPACE,
    phase: initial.phase,
    assignedAgent: initial.agent,
    status: 'queued',
    important,
    startChoices,
    lock: null,
    externalAction: input.externalAction
      ? { kind: input.externalAction, approved: false, approvedBy: null, scope: null }
      : null,
    evidence: [],
    createdAt: now(),
    updatedAt: now(),
  };
  next.tasks[id] = task;
  event(next, id, 'created', { assignedAgent: task.assignedAgent, phase: task.phase, capability: task.capability });
  return { state: next, task: copy(task) };
}

/** Take the single-writer lock. Only the assigned agent may claim; a held lock wins. */
export function claimTask(state, id, agent) {
  const next = copy(state);
  const task = requireTask(next, id);
  if (task.status === 'blocked') throw new Error(`Task ${id} is blocked and cannot be claimed`);
  if (task.lock && task.lock.owner !== agent) {
    throw new Error(`Task ${id} is already held by ${task.lock.owner}`);
  }
  if (task.assignedAgent !== agent) {
    throw new Error(`Task ${id} is assigned to ${task.assignedAgent}, not ${agent}`);
  }
  task.lock = { owner: agent, claimedAt: now() };
  task.status = 'in_progress';
  task.updatedAt = now();
  event(next, id, 'claimed', { agent });
  return { state: next, task: copy(task) };
}

/**
 * Complete the current stage and advance to the next one.
 * Releases the lock; the verify owner is always a different agent from the implementer.
 */
export function completeStage(state, id, agent, result = {}) {
  const next = copy(state);
  const task = requireTask(next, id);
  if (task.status === 'blocked') throw new Error(`Task ${id} is blocked and cannot complete a stage`);
  requireOwner(task, agent);
  if (result.evidence) task.evidence.push({ at: now(), agent, text: result.evidence });
  const implementAgent = implementerForType(task.type);
  const verifier = verifierFor(agent);
  if (!verifier) throw new Error(`No independent verifier available for implementer ${agent}`);
  const transitions = {
    specify: task.type === 'environment'
      ? { phase: 'triage', agent: ROUTES.environment.triage }
      : { phase: 'implement', agent: implementAgent },
    triage: { phase: 'implement', agent: ROUTES.environment.implement },
    implement: { phase: 'verify', agent: verifier },
    verify: { phase: 'evidence', agent: 'generalist' },
    evidence: { phase: 'done', agent: null },
  };
  const nextStep = transitions[task.phase];
  if (!nextStep) throw new Error(`Task ${id} cannot complete unknown phase ${task.phase}`);
  const previousPhase = task.phase;
  task.phase = nextStep.phase;
  task.assignedAgent = nextStep.agent;
  task.lock = null;
  task.status = nextStep.phase === 'done' ? 'done' : 'queued';
  task.updatedAt = now();
  event(next, id, 'stage_completed', { agent, previousPhase, nextPhase: task.phase, nextAgent: task.assignedAgent });
  return { state: next, task: copy(task) };
}

/** Clear a stranded lock on an in_progress/blocked task and re-queue it. Reason required. */
export function recoverTask(state, id, recovery) {
  const next = copy(state);
  const task = requireTask(next, id);
  if (!recovery?.reason?.trim()) throw new Error('Recovery requires a reason');
  if (!['in_progress', 'blocked'].includes(task.status) && !task.lock) {
    throw new Error(`Task ${id} is not recoverable`);
  }
  if (!task.assignedAgent) throw new Error(`Task ${id} has no assigned agent to recover`);
  const previous = { status: task.status, lock: task.lock };
  task.lock = null;
  task.status = 'queued';
  task.updatedAt = now();
  task.evidence.push({ at: now(), agent: 'recovery', text: `Recovered: ${recovery.reason}` });
  event(next, id, 'recovered', { reason: recovery.reason, previous });
  return { state: next, task: copy(task) };
}

/** Record an explicit approval for a task's external action. Both fields are required. */
export function approveExternalAction(state, id, approval) {
  const next = copy(state);
  const task = requireTask(next, id);
  if (!task.externalAction) throw new Error(`Task ${id} has no external action to approve`);
  if (task.status === 'blocked') throw new Error(`Task ${id} is blocked and cannot approve external action`);
  if (!approval?.approvedBy || !approval?.scope) throw new Error('Approval requires approvedBy and scope');
  task.externalAction.approved = true;
  task.externalAction.approvedBy = approval.approvedBy;
  task.externalAction.scope = approval.scope;
  task.updatedAt = now();
  event(next, id, 'external_action_approved', { approvedBy: approval.approvedBy, scope: approval.scope });
  return { state: next, task: copy(task) };
}

/** null when the task has no external action, otherwise whether it is approved. */
export function canRunExternalAction(state, id) {
  const task = requireTask(state, id);
  if (!task.externalAction) return null;
  return task.externalAction.approved === true;
}

/**
 * Build the next dispatch record. Throws for any task that must not be dispatched
 * (done, blocked, already locked, no assigned agent, no command for that agent).
 * The returned record is a dry run: execute is always false.
 */
export function nextDispatch(state, id) {
  const task = requireTask(state, id);
  if (task.status === 'done') throw new Error(`Task ${id} is already done`);
  if (task.status === 'blocked') throw new Error(`Task ${id} is blocked and cannot be dispatched`);
  if (task.lock) throw new Error(`Task ${id} is already held by ${task.lock.owner}`);
  if (!task.assignedAgent) throw new Error(`Task ${id} has no assigned agent; cannot dispatch`);
  const rendered = agentCommand(task);
  if (!rendered) throw new Error(`Task ${id} has no dispatch command for agent ${task.assignedAgent}`);
  return {
    taskId: id,
    agent: task.assignedAgent,
    phase: task.phase,
    capability: task.capability,
    execute: false,
    // argv is the safe form: hand it to a process API. command is the same thing
    // rendered for display with POSIX single-quote escaping.
    command: rendered.command,
    argv: rendered.argv,
    requiresHumanCoordination: false,
    requiresCoordinatorCoordination: task.assignedAgent === 'generalist',
    externalActionApproved: canRunExternalAction(state, id),
  };
}
