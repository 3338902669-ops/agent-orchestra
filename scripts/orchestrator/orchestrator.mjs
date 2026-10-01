#!/usr/bin/env node
// orchestrator.mjs — CLI for the portable orchestration queue (dependency-free, Node 18+).
//
// Commands: init | status | create | claim | complete | dispatch | approve | recover
//
// Safety boundary:
//   * dispatch only PRINTS a dry-run command (execute: false). Nothing is spawned.
//   * a non-dispatchable task (done / blocked / locked / no agent / no command) throws,
//     and the process exits non-zero instead of pretending success.
//   * init refuses to reset a non-empty queue unless --force is passed, and then writes
//     a timestamped backup first.
//   * external actions are only unblocked by an explicit approve record.
//
// The queue file is resolved relative to this module, so the CLI works from any cwd.
// ORCHESTRATOR_STATE overrides the path (used by smoke tests to avoid writing into the repo).

import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, openSync, closeSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  approveExternalAction,
  claimTask,
  completeStage,
  createState,
  createTask,
  failVerification,
  nextDispatch,
  overrideVerificationGate,
  recoverTask,
} from './lib.mjs';

const STATE_PATH = process.env.ORCHESTRATOR_STATE
  ? process.env.ORCHESTRATOR_STATE
  : new URL('TASK-QUEUE.json', import.meta.url);

/** Always a filesystem path, so temp-file names and rename() work the same either way. */
const STATE_FILE = STATE_PATH instanceof URL ? fileURLToPath(STATE_PATH) : String(STATE_PATH);

function stateLabel() {
  return STATE_FILE;
}

function backupTarget(stamp) {
  return STATE_PATH instanceof URL
    ? new URL(`./TASK-QUEUE.json.pre-init-${stamp}.bak`, import.meta.url)
    : `${STATE_PATH}.pre-init-${stamp}.bak`;
}

/**
 * Revision = number of events. Mutators append exactly one event each, so the count
 * grows monotonically and doubles as a version number for the optimistic lock below.
 */
function revisionOf(state) {
  return (state.events ?? []).length;
}

/** Blocking sleep without a dependency (used only while waiting for the lock). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const LOCK_FILE = `${STATE_FILE}.lock`;
const LOCK_WAIT_MS = Number(process.env.ORCHESTRATOR_LOCK_WAIT_MS ?? 5000);
const LOCK_STALE_MS = 10000;

/**
 * Mutual exclusion across processes. openSync(..., 'wx') fails if the file exists, and
 * that check-and-create is atomic at the OS level, so exactly one process can hold the
 * lock. A lock left behind by a crashed process is stolen once it is stale.
 *
 * Comparison alone is not enough: "read the revision, compare, then write" leaves a
 * window in which two processes both compare successfully and both write, which is
 * exactly the lost-update race this guards against.
 */
function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(LOCK_FILE, 'wx');
      writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) {
          rmSync(LOCK_FILE, { force: true });
          continue;
        }
      } catch {
        continue; // the lock disappeared between the open and the stat: retry immediately
      }
      if (Date.now() > deadline) {
        throw new Error('the queue is locked by another process; re-run in a moment');
      }
      sleepSync(25);
    }
  }
}

function releaseLock() {
  rmSync(LOCK_FILE, { force: true });
}

/** Read the queue and remember the revision we read it at. */
function load() {
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : createState();
  return { state, rev: revisionOf(state) };
}

/**
 * Atomic write: serialise to a unique temp file in the same directory, then rename it
 * over the queue. rename() is atomic within a filesystem, so a reader never observes a
 * half-written queue - and a crash mid-write leaves the previous queue intact.
 */
function writeState(state) {
  const tmp = `${STATE_FILE}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  try {
    renameSync(tmp, STATE_FILE);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Optimistic lock. Every command reads, computes and writes; without this check two
 * concurrent invocations both read the same revision and the later write silently
 * discards the earlier one (a lost claim, an overwritten evidence entry). Here the
 * second writer is refused and told to re-run against the new state.
 */
function commit(state, expectedRev) {
  const currentRev = existsSync(STATE_FILE)
    ? revisionOf(JSON.parse(readFileSync(STATE_FILE, 'utf8')))
    : 0;
  if (currentRev !== expectedRev) {
    throw new Error(
      `state changed underneath this command (expected v${expectedRev}, found v${currentRev}). Re-run.`,
    );
  }
  writeState(state);
}

function value(args, flag, required = true) {
  const index = args.indexOf(flag);
  const result = index < 0 ? undefined : args[index + 1];
  if (required && !result) throw new Error(`Missing ${flag}`);
  return result;
}

function print(output) {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function main(args) {
  // One writer at a time: the lock is held across read-modify-write.
  acquireLock();
  try {
    return runCommand(args);
  } finally {
    releaseLock();
  }
}

function runCommand(args) {
  const command = args[0];
  const { state, rev } = load();
  if (command === 'init') {
    // --roster <file> installs a team of any size (3 agents, 5, 12 - the shape is
    // documented in the README). Without it the default three-agent roster is used.
    const rosterPath = value(args, '--roster', false);
    const roster = rosterPath ? JSON.parse(readFileSync(rosterPath, 'utf8')) : undefined;
    // Fail closed: a non-empty queue is only reset on an explicit --force, and the
    // previous contents are always backed up with a timestamp first.
    const taskCount = Object.keys(state.tasks ?? {}).length;
    if (taskCount > 0 && !args.includes('--force')) {
      throw new Error(
        `Refusing to init: queue already holds ${taskCount} task(s). ` +
        'Use "status" to inspect, or pass --force to reset (a timestamped backup will be written).'
      );
    }
    if (taskCount > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = backupTarget(stamp);
      writeFileSync(backup, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      const fresh = createState(roster);
      commit(fresh, rev);
      return print({
        ok: true,
        reset: true,
        backedUpTasks: taskCount,
        backup: backup instanceof URL ? fileURLToPath(backup) : String(backup),
        agents: Object.keys(fresh.roster.agents),
      });
    }
    const fresh = createState(roster);
    commit(fresh, rev);
    return print({ ok: true, state: stateLabel(), agents: Object.keys(fresh.roster.agents) });
  }
  if (command === 'status') return print(state);
  if (command === 'create') {
    const result = createTask(state, {
      title: value(args, '--title'),
      type: value(args, '--type', false) ?? 'build',
      capability: value(args, '--capability', false),
      workspace: value(args, '--workspace', false),
      externalAction: value(args, '--external-action', false),
      important: args.includes('--important'),
      rigor: value(args, '--rigor', false),
      executionMode: value(args, '--execution-mode', false),
      security: value(args, '--security', false),
      independentVerify: value(args, '--independent-verify', false),
    });
    commit(result.state, rev);
    return print(result.task);
  }
  const id = value(args, '--task');
  if (command === 'claim') {
    const result = claimTask(state, id, value(args, '--agent'));
    commit(result.state, rev);
    return print(result.task);
  }
  if (command === 'complete') {
    // Graded evidence: --evidence-grade turns the free text into a graded record, and E1 is
    // refused unless it carries the command, the exit code and the revision (see lib.mjs).
    const grade = value(args, '--evidence-grade', false);
    const text = value(args, '--evidence', false);
    const exitCodeRaw = value(args, '--evidence-exit-code', false);
    const evidence = grade
      ? {
          grade,
          text: text ?? null,
          command: value(args, '--evidence-command', false) ?? null,
          revision: value(args, '--evidence-revision', false) ?? null,
          exitCode: exitCodeRaw === undefined || exitCodeRaw === null ? null : Number(exitCodeRaw),
        }
      : text;
    const result = completeStage(state, id, value(args, '--agent'), { evidence });
    commit(result.state, rev);
    return print(result.task);
  }
  if (command === 'recover') {
    const result = recoverTask(state, id, { reason: value(args, '--reason') });
    commit(result.state, rev);
    return print(result.task);
  }
  if (command === 'approve') {
    const result = approveExternalAction(state, id, {
      approvedBy: value(args, '--by'),
      scope: value(args, '--scope'),
    });
    commit(result.state, rev);
    return print(result.task);
  }
  // Verification gate: fail sends the task back to implement and keeps the gate shut.
  if (command === 'fail') {
    const result = failVerification(state, id, value(args, '--agent'), {
      criteria: value(args, '--criteria', false),
      findings: value(args, '--findings', false),
    });
    commit(result.state, rev);
    return print(result.task);
  }
  // Soft gate: only with an approver, a scope AND a reason; the failure stays on record.
  if (command === 'override') {
    const result = overrideVerificationGate(state, id, {
      approvedBy: value(args, '--by'),
      scope: value(args, '--scope'),
      reason: value(args, '--reason'),
    });
    commit(result.state, rev);
    return print(result.task);
  }
  // Dry run only: nextDispatch never spawns anything, and it throws for tasks that
  // must not be dispatched, which turns into a non-zero exit code below.
  if (command === 'dispatch') return print(nextDispatch(state, id));
  throw new Error('Commands: init, status, create, claim, complete, recover, approve, fail, override, dispatch');
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`orchestrator: ${error.message}\n`);
  process.exitCode = 1;
}
