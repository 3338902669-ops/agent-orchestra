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

export const STATE_VERSION = 4;

/** Capability labels a task may carry. Describes which roles can be dispatched. */
export const CAPABILITIES = ['full', 'web', 'complex', 'verify', 'environment'];

/** Task types. The type decides routing; capability is an independent label. */
export const TYPES = ['build', 'web', 'complex', 'verify', 'environment'];

/** Roles a roster can score an agent for. */
export const ROLES = ['specify', 'triage', 'implement', 'verify', 'evidence', 'environment'];

/**
 * The default roster. A roster is DATA - "who can do what, how well, at what cost":
 *
 *   agents: { <id>: { cost, available, specialties[], scores{ role -> 0..3 } } }
 *   routes: optional explicit owners. Any name that is missing from `agents` is
 *           ignored and resolution falls back to capability score.
 *
 * Nothing in the code requires the roster to have a particular size or particular
 * names: 3 agents, 5 agents or 12 agents all work, and agents called anything at all
 * are dispatchable. Scores are 0-3 (3 = direct tooling plus repeated evidence,
 * 0 = unavailable or forbidden); `cost` breaks ties towards the cheaper agent;
 * `specialties` hold capability labels (full|web|complex|verify|environment).
 */
export const DEFAULT_ROSTER = Object.freeze({
  agents: {
    generalist: { cost: 4, available: true, specialties: [], scores: { specify: 3, implement: 2, verify: 2, evidence: 3, environment: 1 } },
    frontend: { cost: 3, available: true, specialties: ['web'], scores: { specify: 1, implement: 3, verify: 1, evidence: 1, environment: 1 } },
    specialist: { cost: 6, available: true, specialties: ['complex', 'verify', 'environment'], scores: { specify: 2, implement: 3, verify: 3, evidence: 2, environment: 3 } },
  },
  routes: {
    specify: 'generalist',
    evidence: 'generalist',
    triage: 'frontend',
    implement: { build: 'generalist', web: 'frontend', complex: 'specialist', verify: 'specialist', environment: 'frontend' },
  },
});

/** Agent identities in the default roster. */
export const AGENTS = Object.keys(DEFAULT_ROSTER.agents);

/**
 * Validate a roster and fail loudly: a malformed custom roster must never silently
 * downgrade routing. Accepts any number of agents (one or more).
 */
export function validateRoster(roster) {
  const agents = roster?.agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
    throw new Error('A roster must look like { agents: { <id>: {...} }, routes?: {...} }');
  }
  const ids = Object.keys(agents);
  if (ids.length === 0) throw new Error('A roster must declare at least one agent');
  for (const [id, agent] of Object.entries(agents)) {
    if (!agent || typeof agent !== 'object') throw new Error(`Agent ${id} must be an object`);
    if (agent.cost != null && typeof agent.cost !== 'number') throw new Error(`Agent ${id}: cost must be a number`);
    if (agent.available != null && typeof agent.available !== 'boolean') throw new Error(`Agent ${id}: available must be a boolean`);
    if (agent.specialties != null && !Array.isArray(agent.specialties)) throw new Error(`Agent ${id}: specialties must be an array`);
    for (const [role, score] of Object.entries(agent.scores ?? {})) {
      if (!ROLES.includes(role)) throw new Error(`Agent ${id}: unknown role "${role}" (allowed: ${ROLES.join(', ')})`);
      if (typeof score !== 'number' || score < 0 || score > 3) throw new Error(`Agent ${id}: score for ${role} must be a number 0-3`);
    }
  }
  return roster;
}

/** Pipeline stages in order. `triage` is only used by `environment` tasks. */
export const STAGES = ['specify', 'triage', 'implement', 'verify', 'evidence', 'done'];

/** Allowed values for the three start choices. */
export const EXECUTION_MODES = ['single', 'collaborative'];
export const PLAN_CHOICES = ['planned', 'skip'];

/**
 * Rigor is chosen from the blast radius of the change, not from how interesting it is, and it
 * decides which activities are mandatory - the way an integrity level selects V&V tasks in
 * IEEE 1012. See references/verification-standard.md.
 *   L1 local         - one file, reversible; tests for the change; self-produced evidence allowed
 *   L2 shared        - multiple files, shared config or user-visible behaviour (the default)
 *   L3 consequential - irreversible, published, deployed, or touching credentials/permissions
 */
export const RIGOR_LEVELS = ['L1', 'L2', 'L3'];
export const DEFAULT_RIGOR = 'L2';

/**
 * Evidence grades. E1 means someone else can re-run it and get the same answer; E3 means only
 * the producer looked. A bare string is recorded as E3 and labelled as such, so it can never
 * borrow E1's voice.
 */
export const EVIDENCE_GRADES = ['E1', 'E2', 'E3', 'E4'];
export const E1_REQUIRED_FIELDS = ['command', 'exitCode', 'revision'];

/**
 * Turn whatever a caller passed as evidence into a graded record. Keeping the old string form
 * working matters (every existing call site uses it), but it must not be allowed to pose as
 * E1: an ungraded sentence is self-report, so it is downgraded to E3 with a note.
 */
export function normalizeEvidence(agent, ev) {
  const record = { at: now(), agent };
  if (typeof ev === 'string') {
    return { ...record, grade: 'E3', text: ev, note: 'ungraded string, downgraded to E3' };
  }
  const grade = ev?.grade;
  if (!EVIDENCE_GRADES.includes(grade)) {
    throw new Error(`evidence.grade is required and must be one of ${EVIDENCE_GRADES.join(', ')}`);
  }
  if (grade === 'E1') {
    const missing = E1_REQUIRED_FIELDS.filter((field) => ev[field] === undefined || ev[field] === '');
    if (missing.length) {
      throw new Error(`E1 evidence must carry ${missing.join(', ')} - a reproducible result needs the command, its exit code and the revision it applies to`);
    }
  }
  return { ...record, ...ev, grade };
}

/** Default workspace label. Relative on purpose: no machine path is baked in. */
export const DEFAULT_WORKSPACE = '.';

/** Default start choices for a task that does not declare them. */
export const DEFAULT_START_CHOICES = Object.freeze({
  executionMode: 'single',
  security: 'skip',
  independentVerify: 'skip',
});

function rosterAgents(roster) {
  return roster?.agents ?? DEFAULT_ROSTER.agents;
}

/** An explicitly named owner for a stage, when the roster names a usable one. */
function namedOwner(role, roster, type) {
  const routes = roster?.routes ?? {};
  const named = role === 'implement' ? routes.implement?.[type] : routes[role];
  if (!named) return null;
  const agent = rosterAgents(roster)[named];
  if (!agent || agent.available === false) return null;
  return named;
}

/**
 * Score-ranked candidate for a role. Deterministic and reproducible:
 *   1. highest `scores[role]`;
 *   2. then a capability match in `specialties`;
 *   3. then lower `cost`;
 *   4. then agent id order (lexicographic, so it is stable across runs).
 * Returns null when nobody is eligible. Excluded ids never win.
 */
export function selectAgent(role, { roster = DEFAULT_ROSTER, exclude = [], capability = null } = {}) {
  const candidates = Object.entries(rosterAgents(roster))
    .filter(([id, agent]) => !exclude.includes(id) && agent?.available !== false)
    .map(([id, agent]) => ({
      id,
      score: agent?.scores?.[role] ?? 0,
      specialty: capability && Array.isArray(agent?.specialties) && agent.specialties.includes(capability) ? 1 : 0,
      cost: agent?.cost ?? 0,
    }));
  if (candidates.length === 0) return null;
  candidates.sort(
    (x, y) => y.score - x.score || y.specialty - x.specialty || x.cost - y.cost || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
  return candidates[0];
}

/**
 * Owner of a stage: the explicitly named agent when the roster provides one,
 * otherwise the highest-scoring eligible agent. Works for any roster size and any
 * agent names - nothing here hardcodes an identity.
 */
export function ownerFor(role, { roster = DEFAULT_ROSTER, type = null, capability = null, exclude = [] } = {}) {
  const named = namedOwner(role, roster, type);
  if (named && !exclude.includes(named)) return named;
  const pick = selectAgent(role, { roster, exclude, capability });
  return pick ? pick.id : null;
}

// Dry-run command templates. These are PLACEHOLDERS: swap `agent-run` for your own
// runner. Each template returns an ARGV ARRAY, never a shell string: task titles and
// workspaces are free-form text, and JSON.stringify is a JSON encoder, not a shell
// quoter (it leaves `$(...)`, backticks, `${...}` and `!` live inside double quotes).
export const COMMAND_TEMPLATES = Object.freeze({
  generalist: (prompt) => ['agent-run', '--headless', prompt],
  frontend:   (prompt) => ['agent-run', '--profile', 'frontend', prompt],
  specialist: (prompt) => ['agent-run', '--profile', 'specialist', prompt],
});

/**
 * Fallback template for any agent id a roster declares. Without it, a team whose
 * agents are not called generalist/frontend/specialist could not be dispatched at all.
 */
export const DEFAULT_COMMAND_TEMPLATE = (prompt, agentId) => ['agent-run', '--profile', agentId, prompt];

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

/**
 * Who implements this task type: the roster's named route when it has one, otherwise
 * the highest-scoring eligible agent. Never hardcodes an identity, so any roster works.
 */
export function implementerForType(type, roster = DEFAULT_ROSTER) {
  return ownerFor('implement', { roster, type, capability: capabilityForType(type) });
}

/** Default verification-gate record for a task that has not been verified yet. */
export function emptyVerification() {
  return {
    status: 'pending',
    attempts: 0,
    blocked: false,
    lastResult: null,
    criteria: null,
    findings: null,
    at: null,
    by: null,
    override: null,
  };
}

/**
 * Pick the agent best suited to verify this task, from the roster's capability scores.
 *
 * Selection is the generic `selectAgent('verify', ...)` ranking with the implementer
 * excluded, so it scales to any roster: it prefers the highest verify score, then a
 * capability match, then the cheaper agent, then agent id order. Verification is the
 * gate, so this fails closed:
 *   * nobody eligible      -> returns null (caller throws);
 *   * best eligible is 0   -> throws, instead of pretending an unscored agent can verify.
 */
export function selectVerifier(implementer, roster = DEFAULT_ROSTER, options = {}) {
  const pick = selectAgent('verify', { roster, exclude: [implementer], capability: options.capability ?? null });
  if (!pick) return null;
  if (pick.score <= 0) {
    throw new Error(
      `No agent in the roster is scored for verification (best eligible: ${pick.id}, score 0). ` +
        'Give an agent a verify score of 1 or more, or assign the verifier explicitly.',
    );
  }
  return pick.id;
}

/** Convenience wrapper over selectVerifier for the default roster. */
export function verifierFor(implementer) {
  return selectVerifier(implementer);
}

function route(type, roster = DEFAULT_ROSTER) {
  // Every type starts in `specify`, owned by the roster's coordinator (or the
  // highest-scoring agent when the roster names none).
  return { phase: 'specify', agent: ownerFor('specify', { roster, capability: capabilityForType(type) }) };
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
    'Verification gate: the verifier is chosen by capability score and is never the implementer. If verification fails, report the failing criteria and findings - the task returns to implement and cannot reach done until a verification passes or an explicit override (approver, scope, reason) is recorded.',
    ...(task.phase === 'verify'
      ? ['This is the verify stage: you are the independent verifier. Do not fix the work yourself. Record a pass only with criterion-linked evidence; otherwise record a failure with the failing criteria.']
      : []),
    'External actions: never deploy, send external messages, publish, or delete data without an explicit user approval recorded in the orchestrator.',
    'Headless workers: before editing, state the allowed write paths; run the stated verification commands; write the machine-readable JSON result; and report changed files, commands, exit codes, evidence, and unresolved items.',
  ].join(' ');
  const template =
    COMMAND_TEMPLATES[task.assignedAgent] ?? ((prompt) => DEFAULT_COMMAND_TEMPLATE(prompt, task.assignedAgent));
  if (!template) return null;
  const argv = template(prompt);
  return { argv, command: renderCommand(argv) };
}

/** A fresh, empty orchestrator state. */
/**
 * A fresh state. Pass a roster of any size (3 agents, 5, 12 - all fine); the default
 * roster is used when none is given. The roster is validated before it is stored.
 */
export function createState(roster = DEFAULT_ROSTER) {
  const checked = validateRoster(copy(roster));
  return {
    version: STATE_VERSION,
    migration: null,
    nextTaskNumber: 1,
    tasks: {},
    events: [],
    // Who can do what. Older state files without a roster fall back to the default.
    roster: checked,
  };
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
  // Rigor: how much verification this change has to carry. It is stated, not inferred, and an
  // irreversible action can never be filed as "local".
  const rigor = input.rigor ?? DEFAULT_RIGOR;
  if (!RIGOR_LEVELS.includes(rigor)) {
    throw new Error(`Invalid rigor: ${rigor} (allowed: ${RIGOR_LEVELS.join(', ')})`);
  }
  if (rigor === 'L1' && input.externalAction) {
    throw new Error(
      `An external action (${input.externalAction}) cannot be L1: it leaves the machine. Use L3, which requires independent verification and E1 evidence.`,
    );
  }
  const startChoices = {
    executionMode: executionMode ?? DEFAULT_START_CHOICES.executionMode,
    security: security ?? DEFAULT_START_CHOICES.security,
    independentVerify: independentVerify ?? DEFAULT_START_CHOICES.independentVerify,
  };
  const initial = route(type, next.roster);
  if (!initial.agent) throw new Error('No agent in the roster can own the specify stage');
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
    rigor,
    startChoices,
    lock: null,
    externalAction: input.externalAction
      ? { kind: input.externalAction, approved: false, approvedBy: null, scope: null }
      : null,
    evidence: [],
    verification: emptyVerification(),
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
  task.verification ??= emptyVerification();
  if (result.evidence) task.evidence.push(normalizeEvidence(agent, result.evidence));
  const roster = next.roster ?? DEFAULT_ROSTER;
  const implementAgent = implementerForType(task.type, roster);
  // The verifier is chosen by capability score, never the implementer (see selectVerifier).
  const needsVerifier = task.phase === 'implement';
  const verifier = needsVerifier ? selectVerifier(agent, roster, { capability: task.capability }) : null;
  if (needsVerifier && !verifier) {
    throw new Error(`No independent verifier available for implementer ${agent}`);
  }
  // The gate. A task may reach `done` only after a verification PASS, or after an
  // explicit override that carries an approver, a scope and a reason.
  if (task.phase === 'evidence' && task.verification.status !== 'passed' && !task.verification.override) {
    throw new Error(
      `Task ${id} cannot reach done: verification has not passed (status: ${task.verification.status}). ` +
        'Re-run the verify stage, or record an explicit override with approvedBy, scope and reason.',
    );
  }
  // Rigor L3 means the blast radius is irreversible or published, so a graded, reproducible
  // artifact is required - not a sentence saying it looked fine.
  if (task.phase === 'evidence' && task.rigor === 'L3' && !task.evidence.some((e) => e.grade === 'E1')) {
    throw new Error(
      `Task ${id} is L3 (consequential) and cannot reach done without E1 evidence: a command, its exit code and the revision it applies to.`,
    );
  }
  const stageOwner = (role) => ownerFor(role, { roster, type: task.type, capability: task.capability });
  const transitions = {
    specify: task.type === 'environment'
      ? { phase: 'triage', agent: stageOwner('triage') }
      : { phase: 'implement', agent: implementAgent },
    triage: { phase: 'implement', agent: implementAgent },
    implement: { phase: 'verify', agent: verifier },
    verify: { phase: 'evidence', agent: stageOwner('evidence') },
    evidence: { phase: 'done', agent: null },
  };
  const nextStep = transitions[task.phase];
  if (!nextStep) throw new Error(`Task ${id} cannot complete unknown phase ${task.phase}`);
  if (nextStep.phase !== 'done' && !nextStep.agent) {
    throw new Error(`No agent in the roster can own the ${nextStep.phase} stage`);
  }
  const previousPhase = task.phase;
  // Completing the verify stage IS the pass. Record who passed it, and when.
  if (task.phase === 'verify') {
    task.verification = {
      ...task.verification,
      status: 'passed',
      blocked: false,
      lastResult: 'pass',
      attempts: task.verification.attempts + 1,
      findings: null,
      at: now(),
      by: agent,
    };
  }
  task.phase = nextStep.phase;
  task.assignedAgent = nextStep.agent;
  task.lock = null;
  task.status = nextStep.phase === 'done' ? 'done' : 'queued';
  task.updatedAt = now();
  event(next, id, 'stage_completed', { agent, previousPhase, nextPhase: task.phase, nextAgent: task.assignedAgent });
  return { state: next, task: copy(task) };
}

/**
 * Record a failed verification and send the task back to implement.
 *
 * Only the verifier holding the lock may fail the stage, and it must say WHAT failed
 * (criteria or findings). The verifier never fixes the work itself. The gate stays
 * blocked until a later verify stage passes or an explicit override is recorded.
 */
export function failVerification(state, id, agent, failure = {}) {
  const next = copy(state);
  const task = requireTask(next, id);
  if (task.phase !== 'verify') {
    throw new Error(`Task ${id} is not in the verify stage (current: ${task.phase})`);
  }
  if (task.status === 'blocked') throw new Error(`Task ${id} is blocked and cannot fail a stage`);
  requireOwner(task, agent);
  const criteria = failure.criteria ?? null;
  const findings = failure.findings ?? null;
  if (!criteria && !findings) {
    throw new Error('A verification failure must state the failing criteria or the findings');
  }
  const previous = task.verification ?? emptyVerification();
  task.verification = {
    ...previous,
    status: 'failed',
    blocked: true,
    attempts: previous.attempts + 1,
    lastResult: 'fail',
    criteria,
    findings,
    at: now(),
    by: agent,
  };
  task.phase = 'implement';
  task.assignedAgent = implementerForType(task.type, next.roster ?? DEFAULT_ROSTER);
  task.lock = null;
  task.status = 'queued';
  task.updatedAt = now();
  event(next, id, 'verification_failed', { agent, criteria, findings });
  return { state: next, task: copy(task) };
}

/**
 * Soft gate: let a human/coordinator pass a failed verification deliberately.
 *
 * All three fields are required - approver, scope and reason - so an override is
 * always attributable and never silent. The failed result is kept in the record;
 * the override is added next to it rather than replacing it.
 */
export function overrideVerificationGate(state, id, override = {}) {
  const next = copy(state);
  const task = requireTask(next, id);
  if (!override?.approvedBy || !override?.scope || !override?.reason) {
    throw new Error('Overriding the verification gate requires approvedBy, scope and reason');
  }
  if (!task.verification?.blocked) {
    throw new Error(`Task ${id} has no blocked verification gate to override`);
  }
  task.verification.override = {
    approvedBy: override.approvedBy,
    scope: override.scope,
    reason: override.reason,
    at: now(),
  };
  task.verification.blocked = false;
  task.updatedAt = now();
  event(next, id, 'verification_gate_overridden', {
    approvedBy: override.approvedBy,
    scope: override.scope,
    reason: override.reason,
  });
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
  if (task.phase === 'evidence' && task.verification?.blocked && !task.verification?.override) {
    throw new Error(
      `Task ${id} is gated: verification failed and no override is recorded, so it cannot be dispatched to evidence`,
    );
  }
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
    requiresCoordinatorCoordination:
      task.assignedAgent === ownerFor('specify', { roster: state.roster ?? DEFAULT_ROSTER, capability: task.capability }),
    externalActionApproved: canRunExternalAction(state, id),
    // Gate visibility: the dispatch record shows whether verification passed and
    // whether an override is in force.
    verificationStatus: task.verification?.status ?? 'pending',
    verificationBlocked: task.verification?.blocked === true,
    verificationOverride: task.verification?.override ?? null,
  };
}
