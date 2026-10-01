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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  approveExternalAction,
  claimTask,
  completeStage,
  createState,
  createTask,
  nextDispatch,
  recoverTask,
} from './lib.mjs';

const STATE_PATH = process.env.ORCHESTRATOR_STATE
  ? process.env.ORCHESTRATOR_STATE
  : new URL('TASK-QUEUE.json', import.meta.url);

function stateLabel() {
  return STATE_PATH instanceof URL ? fileURLToPath(STATE_PATH) : String(STATE_PATH);
}

function backupTarget(stamp) {
  return STATE_PATH instanceof URL
    ? new URL(`./TASK-QUEUE.json.pre-init-${stamp}.bak`, import.meta.url)
    : `${STATE_PATH}.pre-init-${stamp}.bak`;
}

function load() {
  return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : createState();
}

function save(state) {
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
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
  const command = args[0];
  let state = load();
  if (command === 'init') {
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
      state = createState();
      save(state);
      return print({
        ok: true,
        reset: true,
        backedUpTasks: taskCount,
        backup: backup instanceof URL ? fileURLToPath(backup) : String(backup),
      });
    }
    save(state);
    return print({ ok: true, state: stateLabel() });
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
      executionMode: value(args, '--execution-mode', false),
      security: value(args, '--security', false),
      independentVerify: value(args, '--independent-verify', false),
    });
    save(result.state);
    return print(result.task);
  }
  const id = value(args, '--task');
  if (command === 'claim') {
    const result = claimTask(state, id, value(args, '--agent'));
    save(result.state);
    return print(result.task);
  }
  if (command === 'complete') {
    const result = completeStage(state, id, value(args, '--agent'), { evidence: value(args, '--evidence', false) });
    save(result.state);
    return print(result.task);
  }
  if (command === 'recover') {
    const result = recoverTask(state, id, { reason: value(args, '--reason') });
    save(result.state);
    return print(result.task);
  }
  if (command === 'approve') {
    const result = approveExternalAction(state, id, {
      approvedBy: value(args, '--by'),
      scope: value(args, '--scope'),
    });
    save(result.state);
    return print(result.task);
  }
  // Dry run only: nextDispatch never spawns anything, and it throws for tasks that
  // must not be dispatched, which turns into a non-zero exit code below.
  if (command === 'dispatch') return print(nextDispatch(state, id));
  throw new Error('Commands: init, status, create, claim, complete, recover, approve, dispatch');
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`orchestrator: ${error.message}\n`);
  process.exitCode = 1;
}
