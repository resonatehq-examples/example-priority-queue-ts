# Priority Queue

Priority-ordered job execution with bounded concurrency. Processes a batch of mixed-priority jobs in strict tier order: critical jobs complete before high, high before normal, normal before low. Within each tier, up to 2 jobs run concurrently.

## What This Demonstrates

- **Priority ordering**: jobs execute in priority tier order regardless of submission order
- **Bounded concurrency**: at most 2 jobs run simultaneously per tier
- **Tier completion**: no lower-priority tier starts until the higher-priority tier finishes
- **Durable checkpoint per job**: crash recovery resumes from the failing job, not the beginning

## How It Works

Jobs are sorted and grouped into tiers. Each tier is processed as a fan-out/fan-in chunk:

```typescript
for (const tierWeight of tierWeights) {  // critical → high → normal → low
  const tierJobs = tiers.get(tierWeight)!;

  for (let i = 0; i < tierJobs.length; i += MAX_CONCURRENT) {
    const chunk = tierJobs.slice(i, i + MAX_CONCURRENT);

    // Fan-out: start up to MAX_CONCURRENT jobs simultaneously
    const futures = chunk.map(job => yield* ctx.beginRun(executeJob, job, ...));

    // Fan-in: wait for all jobs in this chunk before moving to next tier
    for (const future of futures) allResults.push(yield* future);
  }
}
```

Each `yield*` is a checkpoint. A crashed job only retries itself — completed jobs in earlier tiers are not re-run.

## Prerequisites

- [Bun](https://bun.sh) v1.0+

No external services required. Resonate runs in embedded mode.

## Setup

```bash
git clone https://github.com/resonatehq-examples/example-priority-queue-ts
cd example-priority-queue-ts
bun install
```

## Run It

**Happy path** — 8 jobs processed in priority order:
```bash
bun start
```

```
=== Priority Queue Demo ===
Mode: HAPPY PATH (all jobs processed in priority order)

Jobs submitted (out of priority order):
  job-001 [low     ] Archive old logs
  job-002 [normal  ] Send weekly newsletter
  job-003 [critical] Process payment refund
  ...

[queue]  Processing 8 jobs (max 2 concurrent per tier)
[queue]  Order: CRITICAL → HIGH → NORMAL → LOW

  [queue]  #1 [CRITICAL] job-003: Process payment refund
  [queue]  #2 [CRITICAL] job-007: Alert: payment failure spike
  [queue]  #2 [CRITICAL] job-007: done in 80ms
  [queue]  #1 [CRITICAL] job-003: done in 100ms
  [queue]  #3 [HIGH    ] job-005: Send order confirmation
  [queue]  #4 [HIGH    ] job-008: Sync user profile to CDN
  ...

=== Result ===
Completed: 8/8 jobs in 623ms

Processing order (priority enforced):
  1. job-003 [critical]
  2. job-007 [critical]
  3. job-005 [high]
  4. job-008 [high]
  5. job-002 [normal]
  6. job-006 [normal]
  7. job-001 [low]
  8. job-004 [low]
```

**Crash mode** — a normal-priority job fails; critical and high jobs are not re-run:
```bash
bun start:crash
```

```
  [queue]  #1 [CRITICAL] job-003: Process payment refund
  [queue]  #2 [CRITICAL] job-007: Alert: payment failure spike
  [queue]  #2 [CRITICAL] job-007: done in 80ms
  [queue]  #1 [CRITICAL] job-003: done in 100ms
  [queue]  #3 [HIGH    ] job-005: Send order confirmation
  [queue]  #4 [HIGH    ] job-008: Sync user profile to CDN
  [queue]  #3 [HIGH    ] job-005: done in 120ms
  [queue]  #4 [HIGH    ] job-008: done in 130ms
  [queue]  #5 [NORMAL  ] job-002: Send weekly newsletter
  [queue]  #6 [NORMAL  ] job-006: Update search index
  [queue]  #5 [NORMAL  ] job-002: done in 150ms
Runtime. Function 'executeJob' failed with 'Error: job-006 crashed — simulated failure' (retrying in 2 secs)
  [queue]  #6 [NORMAL  ] job-006: Update search index (retry 2)
  [queue]  #6 [NORMAL  ] job-006: done in 160ms
  [queue]  #7 [LOW     ] job-001: Archive old logs
  [queue]  #8 [LOW     ] job-004: Generate monthly PDF report

Notice: critical and high jobs ran before the crash.
They were NOT re-run when job-006 retried.
```

## What to Observe

1. **Tier ordering enforced**: both CRITICAL jobs start before any HIGH, HIGH before NORMAL, NORMAL before LOW — regardless of submission order.
2. **2-at-a-time within a tier**: `#1` and `#2` log together, `#3` and `#4` log together, etc.
3. **Tier gate**: HIGH doesn't start until CRITICAL finishes. `#3 [HIGH]` only appears after `#1 [CRITICAL]: done`.
4. **Crash recovery**: job-006 retries without re-running critical or high jobs.

## The Code

The workflow is 40 lines in [`src/workflow.ts`](src/workflow.ts). The priority logic:

```typescript
const tiers = groupByTier(sorted);
const tierWeights = [...tiers.keys()].sort((a, b) => a - b);

for (const tierWeight of tierWeights) {
  const tierJobs = tiers.get(tierWeight)!;
  for (let i = 0; i < tierJobs.length; i += MAX_CONCURRENT) {
    const chunk = tierJobs.slice(i, i + MAX_CONCURRENT);
    const futures = [];
    for (const job of chunk) {
      futures.push(yield* ctx.beginRun(executeJob, job, queuePosition++, crashJobId));
    }
    for (const future of futures) allResults.push(yield* future);
  }
}
```

## File Structure

```
example-priority-queue-ts/
├── src/
│   ├── index.ts    Entry point — Resonate setup and demo runner
│   ├── workflow.ts Priority dispatch workflow — tier-based fan-out
│   └── jobs.ts     Job execution and priority weight definitions
├── package.json
└── tsconfig.json
```

**Lines of code**: ~175 total, ~40 lines of workflow logic.

## Why tier-by-tier iteration is the scheduler

Priority queues often mean virtual objects, awaiters, in-flight counters, and server-side scheduling infrastructure. This example doesn't reach for any of that. The scheduler is a nested loop.

Sort jobs by priority tier. For each tier, chunk into `MAX_CONCURRENT`-sized slices. Fan out the chunk with `ctx.beginRun()`. Fan in before advancing to the next chunk. Before advancing to the next tier, wait for every chunk in the current tier. Every `yield*` is a checkpoint — a mid-tier crash resumes at the failing job, not the start.

The approach fits when priority ordering is one piece of a larger workflow — a fan-out stage that happens to care about priority. For a standalone queueing system with cancellation, drop semantics, or arbitrary in-flight limits, reach for a purpose-built queue; `example-distributed-mutex-ts` covers the serialized-access primitive underneath.

## Learn More

- [Resonate documentation](https://docs.resonatehq.io)
- [Distributed mutex](https://github.com/resonatehq-examples/example-distributed-mutex-ts) — serialized-access primitive
- [Fan-out/fan-in](https://github.com/resonatehq-examples/example-fan-out-fan-in-ts) — concurrency without a scheduler
