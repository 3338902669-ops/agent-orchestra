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
export const ROLES = ['specify', 'triage', 'implement', 'verify', 'evidence', 'environment', 'domain'];

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
    generalist: { cost: 4, available: true, specialties: [], scores: { specify: 3, implement: 2, verify: 2, evidence: 3, environment: 1, domain: 1 } },
    frontend: { cost: 3, available: true, specialties: ['web'], scores: { specify: 1, implement: 3, verify: 1, evidence: 1, environment: 1, domain: 1 } },
    specialist: { cost: 6, available: true, specialties: ['complex', 'verify', 'environment'], scores: { specify: 2, implement: 3, verify: 3, evidence: 2, environment: 3, domain: 2 } },
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
export const STAGES = ['specify', 'triage', 'implement', 'verify', 'domain_review', 'evidence', 'done'];

/** Stage that only consequential work runs. See references/verification-standard.md (rigor). */
export const REQUIRES_DOMAIN_REVIEW = (rigor) => rigor === 'L3';

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

/**
 * The per-level floor. L1 is local and reversible, so any grade will do; L2 needs something a second
 * party can re-run or re-check; L3 needs E1. It lives at module scope because the dispatch packet
 * states it to the worker, not only because completeStage enforces it.
 */
export const EVIDENCE_FLOOR = { L1: ['E1', 'E2', 'E3', 'E4'], L2: ['E1', 'E2'], L3: ['E1'] };
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
    // == null catches undefined AND null. The CLI used to fill missing flags with null while this
    // check only looked for undefined, so "E1 with no command, no exit code and no revision" was
    // accepted and could reach done - a check that existed but did not hold.
    const missing = E1_REQUIRED_FIELDS.filter((field) => ev[field] == null || ev[field] === '');
    if (missing.length) {
      throw new Error(`E1 evidence must carry ${missing.join(', ')} - a reproducible result needs the command, its exit code and the revision it applies to`);
    }
    // Present is not the same as usable: Number('abc') is NaN, which survives an == null test,
    // serialises to null, and turns "the command exited 0" into a claim carrying no exit code at
    // all. A run that was killed records its signal-derived code, not NaN.
    if (!Number.isInteger(ev.exitCode)) {
      throw new Error(`E1 evidence needs an integer exit code, got ${JSON.stringify(ev.exitCode)}`);
    }
  }
  // The other grades are constrained too. Enforcing only E1 left the same hole one rung down: a
  // self-check could label itself E2 ("a peer re-ran it") and nothing asked who the peer was.
  if (grade === 'E2') {
    if (!ev.checkedBy) throw new Error('E2 evidence must name the peer that re-ran it (checkedBy)');
    if (ev.checkedBy === agent) throw new Error('E2 is a peer check, so checkedBy must differ from the author recording it');
  }
  if (grade === 'E4') {
    if (!ev.plan && !ev.target) throw new Error('E4 evidence must say what is planned (plan or target)');
  }
  // record LAST: 'at' and 'agent' are the engine's account of who recorded this and when. Spreading
  // the caller's object over them let a caller rewrite its own authorship and timestamp, which is
  // precisely the field the independence rules read.
  return { ...ev, ...record, grade };
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
  // Own properties only: `agents['constructor']` would otherwise resolve through the prototype
  // chain and hand a task to an agent that does not exist. Names that are not declared are ignored,
  // which is the documented behaviour for a missing route.
  const agents = rosterAgents(roster);
  if (!Object.hasOwn(agents, named)) return null;
  const agent = agents[named];
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
  // An explicit route is a declaration of competence, so it is honoured as given.
  if (named && !exclude.includes(named)) return named;
  const pick = selectAgent(role, { roster, exclude, capability });
  // Without a route, competence has to be positive. A roster that scores nobody for this role used
  // to be handed the work anyway, purely for being the only roster present - the same fail-open that
  // selectVerifier had already been cured of.
  if (!pick || !(pick.score > 0)) return null;
  return pick.id;
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

/**
 * Pick the domain reviewer for consequential work.
 *
 * The reviewer must be a THIRD party: not the implementer, not the verifier. It must also be
 * DOMAIN-QUALIFIED: a generic verifier is independent but does not know the domain, and "somebody
 * looked at it" is not a domain review.
 *
 * This used to fall back to the best verify-role agent and record `fallback: true`. That silently
 * downgraded the guarantee from "reviewed by someone who knows this domain" to "reviewed by someone
 * else", so it now FAILS CLOSED: no declared domain capability means no domain review, and the task
 * cannot proceed until the roster declares one.
 */
export function selectDomainReviewer(roster = DEFAULT_ROSTER, { exclude = [] } = {}) {
  const scored = selectAgent('domain', { roster, exclude });
  if (scored && scored.score > 0) return { id: scored.id, score: scored.score, fallback: false };
  return null;
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
    // Object.hasOwn, not a bare lookup: an agent named 'constructor' or 'toString' resolved to a
    // prototype member and dispatch died with "argv.map is not a function".
    (Object.hasOwn(COMMAND_TEMPLATES, task.assignedAgent)
      ? COMMAND_TEMPLATES[task.assignedAgent]
      : (prompt) => DEFAULT_COMMAND_TEMPLATE(prompt, task.assignedAgent));
  if (!template) return null;
  const argv = template(prompt);
  // A worker handed only the argv array cannot know what to build or how it will be checked, so it
  // has to guess or ask. The packet is the versioned contract: the host adds the queue location.
  return {
    argv,
    command: renderCommand(argv),
    packet: {
      version: 1,
      task: task.id,
      title: task.title,
      type: task.type,
      phase: task.phase,
      rigor: task.rigor,
      important: Boolean(task.important),
      capability: task.capability ?? null,
      workspace: task.workspace,
      owner: task.assignedAgent,
      resources: task.resources ?? [],
      spec: task.spec ?? null,
      acceptance: task.acceptance ?? null,
      nonGoals: task.nonGoals ?? null,
      startChoices: task.startChoices ?? null,
      externalAction: task.externalAction ?? null,
      evidenceFloor: (EVIDENCE_FLOOR[task.rigor] ?? []).slice(),
    },
  };
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
    // Policy the engine reads instead of hard-coding. `init --max-attempts N` raises or lowers the
    // retry ceiling; the config's verification_gate.blocked_after_rounds documents the same number.
    policy: { maxVerificationAttempts: 3 },
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
  // L3 is consequential (irreversible, published, deployed), so it is important by definition: the
  // intake gate applies to it even when the caller never passed --important. Measured before, said
  // after: a task that silently defaults security_scan to "skip" contradicts the gate.
  const important = input.important === true || input.rigor === 'L3';
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
  if (input.externalAction && rigor !== 'L3') {
    // The config states irreversible_requires: L3, and this is what makes it true: an action that
    // leaves the machine is consequential by definition, so L2 (which only requires a different
    // verifier) is not enough - it needs E1 evidence and a verifier that took no part in the work.
    throw new Error(
      `An external action (${input.externalAction}) must be L3: it is irreversible, so it needs independent verification and E1 evidence (got ${rigor}).`,
    );
  }
  // A task that leaves the machine cannot take the defaults: "not asked" must never mean "no scan,
  // no independent verification". Everything else may default, but the record says so out loud so a
  // reader can tell a stated choice from an assumed one.
  if (input.externalAction) {
    const missing = [];
    if (!executionMode) missing.push('--execution-mode');
    if (!security) missing.push('--security');
    if (!independentVerify) missing.push('--independent-verify');
    if (missing.length) {
      throw new Error(
        `A task with an external action (${input.externalAction}) requires all three start choices: ${missing.join(', ')}`,
      );
    }
  }
  const stated = Boolean(executionMode && security && independentVerify);
  // Resources: the unit of single-writer ownership. A task lock keeps one owner per TASK; this is
  // what keeps one writer per RESOURCE, which is what the doctrine actually promises.
  //
  // The identity of a resource is the identity of the lock, so it is normalised rather than compared
  // as text: './src/a.ts' and 'src/a.ts' are one file, 'src\\a.ts' is the same file again, and
  // 'src/a.ts' in two different workspaces is two different files. A directory covers what is beneath
  // it. 'logical:' names (a queue, a table, a service) keep their literal comparison.
  // Critical work (L3) runs a domain review before its evidence is accepted. The domain label is
  // free-form (security, legal, compliance, architecture, ux...) and is recorded with the review.
  const requiresDomainReview = input.domainReview === true || REQUIRES_DOMAIN_REVIEW(rigor);
  const domain = input.domain ? String(input.domain).trim() : null;
  const resources = Array.isArray(input.resources)
    ? [...new Set(input.resources.map((r) => String(r).trim()).filter(Boolean))]
    : [];
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
    requiresDomainReview,
    domain,
    domainReview: requiresDomainReview
      ? { status: 'pending', by: null, at: null, domain, fallback: null, witness: null }
      : null,
    resources,
    startChoices,
    // 'stated' = the caller answered all three; 'defaults' = nobody was asked for this task.
    startChoicesSource: stated ? 'stated' : 'defaults',
    lock: null,
    externalAction: input.externalAction
      ? {
          kind: input.externalAction,
          // What the action acts on. The approval scope has to cover this (or the kind), which is
          // what turns the scope from a note into a constraint.
          target: input.externalTarget ? String(input.externalTarget).trim() : null,
          approved: false,
          approvedBy: null,
          scope: null,
        }
      : null,
    // The task packet from references/task-queue.md, as fields rather than prose. It may be filled
    // at create time or while completing the specify stage, but it must exist before specify ends.
    spec: input.spec ? String(input.spec).trim() : null,
    acceptance: input.acceptance ? String(input.acceptance).trim() : null,
    nonGoals: input.nonGoals ? String(input.nonGoals).trim() : null,
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
/**
 * A resource is compared by IDENTITY, not spelling. Raw string comparison let './src/a.ts' and
 * 'src/a.ts' hold the same file at once, while two workspaces naming 'src/a.ts' were wrongly treated
 * as competing for one file - the same defect pointing in both directions.
 */
export function normalizeResource(raw, workspace = DEFAULT_WORKSPACE) {
  const fold = (s) => {
    const t = String(s).replace(/\/+$/, '');
    return process.platform === 'win32' ? t.toLowerCase() : t;
  };
  const text = String(raw).trim();
  const explicit = text.match(/^(file|dir|directory|logical)\s*:\s*(.*)$/i);
  const hint = explicit ? explicit[1].toLowerCase() : null;
  const body = (explicit ? explicit[2] : text).trim();
  const pathLike =
    hint === 'file' || hint === 'dir' || hint === 'directory' ||
    /[\\/]/.test(body) ||
    /\.[A-Za-z0-9]{1,8}$/.test(body);
  if (!pathLike) return { kind: 'logical', key: fold(body) };
  const kind = hint === 'dir' || hint === 'directory' ? 'dir' : 'file';
  const unified = body.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const absolute = /^([A-Za-z]:)?\//.test(unified);
  const parts = [];
  for (const seg of unified.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  const base = absolute ? '' : fold(String(workspace).replace(/\\/g, '/').replace(/\/{2,}/g, '/'));
  return { kind, key: (base ? base + '/' : '') + fold(parts.join('/')) };
}

/** Equal keys conflict; a directory also conflicts with anything beneath it. */
export function resourcesConflict(a, b) {
  if (a.kind === 'logical' || b.kind === 'logical') {
    return a.kind === b.kind && a.key === b.key;
  }
  if (a.key === b.key) return true;
  if (a.kind === 'dir' && b.key.startsWith(a.key + '/')) return true;
  if (b.kind === 'dir' && a.key.startsWith(b.key + '/')) return true;
  return false;
}

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
  // Claiming the external step is reaching for it: the approval gate applies here too, or a host that
  // never dispatches could start (and finish) an unapproved external action.
  requireExternalApproval(task);
  // A resource held by another live task cannot be claimed, no matter who is asking.
  if (task.resources?.length) {
    const mine = task.resources.map((r) => normalizeResource(r, task.workspace));
    const conflicts = Object.values(next.tasks).filter((other) => {
      if (other.id === task.id) return false;
      if (!other.lock) return false;
      if (other.status === 'done' || other.status === 'blocked') return false;
      return (other.resources ?? [])
        .map((r) => normalizeResource(r, other.workspace))
        .some((theirs) => mine.some((m) => resourcesConflict(m, theirs)));
    });
    if (conflicts.length) {
      const held = conflicts
        .flatMap((other) => (other.resources ?? [])
          .filter((r) => mine.some((m) => resourcesConflict(m, normalizeResource(r, other.workspace))))
          .map((r) => r + ' (task ' + other.id + ', held by ' + other.lock.owner + ')'));
      throw new Error(`Task ${id} cannot claim: resource already held by ${held.join('; ')}`);
    }
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
  // Completing the external step is performing it. Same gate as claim and dispatch.
  requireExternalApproval(task);
  task.verification ??= emptyVerification();
  // A verifier's pass record is a WITNESS, not task evidence. Mixing the two made the verifier an
  // evidence author, which then broke the L3 rule that the verifier must have produced none of it -
  // the two requirements would have cancelled each other out.
  if (result.evidence) {
    const record = normalizeEvidence(agent, result.evidence);
    if (task.phase === 'verify') task.verification.witness = record;
    else if (task.phase === 'domain_review') { /* stored with the review decision below */ }
    else task.evidence.push(record);
  }
  const roster = next.roster ?? DEFAULT_ROSTER;
  const implementAgent = implementerForType(task.type, roster);
  // The verifier is chosen by capability score, never the implementer (see selectVerifier).
  const needsVerifier = task.phase === 'implement';
  // Rigor decides how much independence is required, as the standard says: L1 is local and
  // reversible, so the implementer may verify it (recorded as selfVerified); L2 and L3 still need
  // a different agent, and L3 additionally checks that the verifier produced none of the evidence.
  // L1 may be self-checked, but an IMPORTANT task may not: the skill says important work needs an
  // independent verifier, and that promise outranks the L1 shortcut rather than contradicting it.
  const selfVerified = needsVerifier && task.rigor === 'L1' && !task.important;
  const verifier = needsVerifier
    ? (selfVerified ? agent : selectVerifier(agent, roster, { capability: task.capability }))
    : null;
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
  // The evidence FLOOR, per level. This used to test only `evidence.length === 0`, so an L2 task
  // carrying a single E3 self-report reached done - the standard promised an E1/E2 floor and the
  // runtime did not implement it. A specification the code does not enforce is the exact failure
  // this project exists to remove, so the floor is a table rather than a sentence.
  // (EVIDENCE_FLOOR is declared at module scope so the dispatch packet can state it.)
  if (task.phase === 'evidence' && task.evidence.length === 0) {
    throw new Error(
      `Task ${id} is ${task.rigor}: reaching done requires at least one graded evidence record ` +
        '(see references/verification-standard.md).',
    );
  }
  if (task.phase === 'evidence') {
    const floor = EVIDENCE_FLOOR[task.rigor];
    if (floor && !task.evidence.some((e) => floor.includes(e.grade))) {
      const got = [...new Set(task.evidence.map((e) => e.grade))].join(', ');
      throw new Error(
        `Task ${id} is ${task.rigor}: reaching done requires ${floor.join(' or ')} evidence, and the ` +
          `record holds only ${got}. A self-report is not verification at this level.`,
      );
    }
  }
  if (task.phase === 'evidence' && task.rigor === 'L3') {
    if (!task.evidence.some((e) => e.grade === 'E1')) {
      throw new Error(
        `Task ${id} is L3 (consequential) and cannot reach done without E1 evidence: a command, its exit code and the revision it applies to.`,
      );
    }
    // R2, at the level where it matters: at L3 the verifier may not have taken part in the work at
    // all, not merely "not the implementer". Producing evidence on the task is taking part.
    const verifier = task.verification.by;
    if (verifier && task.evidence.some((e) => e.agent === verifier)) {
      throw new Error(
        `Task ${id} is L3: the verifier (${verifier}) also produced evidence on this task, so the verification is not independent.`,
      );
    }
  }
  const stageOwner = (role) => ownerFor(role, { roster, type: task.type, capability: task.capability });
  // Who reviews the domain: a third party, never the implementer and never the verifier.
  const domainPick = task.requiresDomainReview
    // At this point the verify completion has not been written yet, so the verifier IS the agent
    // completing the stage - falling back to `agent` is what keeps the reviewer a third party.
    ? selectDomainReviewer(roster, {
        // Excluding only the CURRENT verifier was not enough: after a failed domain review and a
        // rework, task.verification.by can still hold the previous pass's verifier, so the review
        // could be handed to whoever completed that verification - and then refused by the
        // independence check, stalling a normal flow. Every identity that must not review is named.
        exclude: [...new Set([
          implementAgent,
          task.verification.by,
          agent,
          task.domainReview?.by,
        ].filter(Boolean))],
      })
    : null;
  const transitions = {
    specify: task.type === 'environment'
      ? { phase: 'triage', agent: stageOwner('triage') }
      : { phase: 'implement', agent: implementAgent },
    triage: { phase: 'implement', agent: implementAgent },
    implement: { phase: 'verify', agent: verifier },
    verify: task.requiresDomainReview && task.domainReview?.status !== 'passed'
      ? {
          phase: 'domain_review',
          // fail closed: if nobody outside the work is available, say so instead of skipping review
          agent: domainPick ? domainPick.id : null,
        }
      : { phase: 'evidence', agent: stageOwner('evidence') },
    domain_review: { phase: 'evidence', agent: stageOwner('evidence') },
    evidence: { phase: 'done', agent: null },
  };
  // R3: each stage declares its work products, and the specify stage's product is the packet. Leaving
  // specify without a spec and an acceptance criterion is how "done" becomes unfalsifiable later.
  if (task.phase === 'specify') {
    if (result.spec) task.spec = String(result.spec).trim();
    if (result.acceptance) task.acceptance = String(result.acceptance).trim();
    if (result.nonGoals) task.nonGoals = String(result.nonGoals).trim();
    const missing = [];
    if (!task.spec) missing.push('--spec');
    if (!task.acceptance) missing.push('--acceptance');
    if (missing.length) {
      throw new Error(`Task ${id} cannot leave the specify stage without its work products: ${missing.join(', ')}`);
    }
  }
  // C: completing the verify stage IS the pass, so the pass must arrive with its evidence. Before
  // this, a verifier could complete verify with nothing at all and the task moved on - the gate had
  // a status but no witness.
  if (task.phase === 'verify' && !result.evidence) {
    throw new Error(
      `Task ${id}: verification cannot PASS without criterion-linked evidence. ` +
        'Pass --evidence (and --evidence-grade with the command, exit code and revision for E1).',
    );
  }
  const nextStep = transitions[task.phase];
  if (!nextStep) throw new Error(`Task ${id} cannot complete unknown phase ${task.phase}`);
  if (nextStep.phase !== 'done' && !nextStep.agent) {
    if (nextStep.phase === 'domain_review') {
      throw new Error(
        `Task ${id} is ${task.rigor} and needs a domain review, but no eligible agent is both a ` +
          'third party AND scored for the "domain" role. Give an agent who took no part in the work ' +
          'a domain score of 1 or more, or record the review explicitly.',
      );
    }
    throw new Error(`No agent in the roster can own the ${nextStep.phase} stage`);
  }
  // A domain review is a decision about the work, so it carries its own record, and the reviewer
  // must be a third party. Like the verifier's pass, the record is a witness, not task evidence.
  if (task.phase === 'domain_review') {
    if (!result.evidence) {
      throw new Error(`Task ${id}: a domain review cannot PASS without its review record (--evidence)`);
    }
    if (agent === implementAgent || agent === task.verification.by) {
      throw new Error(
        `Task ${id}: the domain reviewer must be neither the implementer nor the verifier (got ${agent})`,
      );
    }
    task.domainReview = {
      status: 'passed',
      by: agent,
      at: now(),
      domain: task.domain,
      fallback: domainPick ? domainPick.fallback : false,
      witness: normalizeEvidence(agent, result.evidence),
    };
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
      // L1 only: the implementer verified their own work. Recorded rather than hidden, so a reader
      // can tell a self-check from an independent one without reading the roster.
      selfVerified: task.rigor === 'L1' && agent === implementAgent,
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
  if (task.phase !== 'verify' && task.phase !== 'domain_review') {
    throw new Error(`Task ${id} is not in a stage that can fail (current: ${task.phase})`);
  }
  if (task.status === 'blocked') throw new Error(`Task ${id} is blocked and cannot fail a stage`);
  requireOwner(task, agent);
  const criteria = failure.criteria ?? null;
  const findings = failure.findings ?? null;
  if (!criteria && !findings) {
    throw new Error('A verification failure must state the failing criteria or the findings');
  }
  const rejectedStage = task.phase;
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
  // E: the doctrine says a task stuck after three rounds is blocked rather than retried forever.
  // That was only in the config; this makes it a state transition a coordinator has to clear.
  // Policy, not a constant: the config documents blocked_after_rounds, and a hard-coded 3 here is
  // exactly how "config says 5, engine does 3" happens. init --max-attempts sets it.
  const blockedAfter = next.policy?.maxVerificationAttempts ?? 3;
  if (task.verification.attempts >= blockedAfter) {
    task.status = 'blocked';
    event(next, id, 'blocked_after_rounds', { attempts: task.verification.attempts, criteria, findings });
  } else {
    task.status = 'queued';
  }
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
  // An override is the decision to proceed with the failure accepted, so it advances the task to the
  // evidence stage. Leaving it in the rework loop meant the only way forward was a second PASS -
  // exactly the PASS the override exists to waive. A task blocked by the retry ceiling is NOT moved:
  // that is what recover is for, and conflating the two would let an override erase three failures.
  if (task.status !== 'blocked') {
    task.phase = 'evidence';
    task.assignedAgent = ownerFor('evidence', {
      roster: next.roster ?? DEFAULT_ROSTER,
      type: task.type,
      capability: task.capability,
    });
    task.lock = null;
  }
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

/**
 * The approval gate, in one place. It was enforced only in nextDispatch, so a host that advanced a
 * task without dispatching it - claim and complete are public API - could carry an unapproved
 * external action all the way to done. The gate belongs to the STEP, not to one of the three ways
 * of reaching it.
 */
export function requireExternalApproval(task) {
  if (!task.externalAction) return;
  const at = task.externalAction.at ?? 'implement';
  if (task.phase !== at) return;
  const normalise = (v) => String(v ?? '').trim().toLowerCase();
  if (!task.externalAction.approved) {
    throw new Error(
      `Task ${task.id} reaches its external action (${task.externalAction.kind}) in the ${at} stage and ` +
        'it is not approved. Internal stages may continue; record one with: ' +
        `approve --task ${task.id} --by <who> --scope <target>`,
    );
  }
  // The scope is a constraint, not a note, and it is matched STRUCTURALLY: the approval has to name
  // the action's target (or its kind) exactly. A substring test let "not production" unlock
  // production, which is the classic way an authorization check becomes decoration.
  const scope = normalise(task.externalAction.scope);
  const required = normalise(task.externalAction.target ?? task.externalAction.kind);
  if (!scope || !required || scope !== required) {
    throw new Error(
      `Task ${task.id}: the approval scope must equal the action's target exactly. Got "${task.externalAction.scope}", ` +
        `the action targets "${task.externalAction.target ?? task.externalAction.kind}".`,
    );
  }
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
  if (task.phase === 'done' && task.requiresDomainReview && task.domainReview?.status !== 'passed') {
    throw new Error(`Task ${id} is ${task.rigor} and cannot be done without a passed domain review`);
  }
  if (task.phase === 'evidence' && task.verification?.blocked && !task.verification?.override) {
    throw new Error(
      `Task ${id} is gated: verification failed and no override is recorded, so it cannot be dispatched to evidence`,
    );
  }
  // The gate has to gate the thing it names, and ONLY that thing: internal work may proceed, the
  // external STEP needs approval (externalAction.at, default "implement"). One implementation, shared
  // with claim and complete - enforcing it only here left the other two paths open.
  requireExternalApproval(task);
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
    // The packet travels with the dispatch record: a worker that receives only an argv array has to
    // guess what to build and how it will be checked, which is not a contract.
    packet: rendered.packet,
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
