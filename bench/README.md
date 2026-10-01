# Protocol benchmark

`node bench/protocol-benchmark.mjs` - no dependencies, no network, no model calls.

## What it measures

Six failure modes that multi-agent work actually hits, driven through three coordination models:

| Model | What it is |
|---|---|
| **single** | one agent; whatever it says goes |
| **naive** | several agents sharing state with no locks and no gate - the obvious first attempt |
| **orchestra** | the shipped engine, `scripts/orchestrator/lib.mjs` |

The protocol column is not a re-implementation: those scenarios call the real library, and a scenario
that a rule should stop is only counted as stopped if the library refused it.

## What it does NOT measure

- **Model quality.** It does not compare LLMs. It compares coordination layers.
- **Task success on real work.** The actors are deterministic scripts. Whether an agent writes good
  code under this protocol is outside the scope of a reproducible benchmark and is not claimed.
- **Cost or wall time.** Both depend on the host and the model.

Stating this is the point: a bigger number that means less would be worse than a small table that
means exactly what it says.

## Why scripted actors

A benchmark a reader cannot re-run is an anecdote. Deterministic actors make the table identical on
any machine, in any year, without an API key - and they isolate the variable the project controls.

## Reading the result

Every non-zero value in the Agent Orchestra column is a rule that did NOT hold, and the run prints each
refusal verbatim. A regression therefore shows up as a number moving off zero.

Evidence is written with:

```bash
node bench/protocol-benchmark.mjs --json bench/evidence/protocol-benchmark.json --markdown bench/RESULTS.md
```

The committed result is [`RESULTS.md`](RESULTS.md).
