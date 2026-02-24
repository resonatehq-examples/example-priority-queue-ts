import type { Context } from "@resonatehq/sdk";
import { executeJob, PRIORITY_WEIGHT, type Job, type JobResult } from "./jobs";

// ---------------------------------------------------------------------------
// Priority Queue Workflow
// ---------------------------------------------------------------------------
// Processes a batch of jobs in strict priority order with bounded concurrency.
//
// Jobs are grouped by priority tier: critical → high → normal → low.
// Within each tier, jobs run concurrently (up to MAX_CONCURRENT at a time).
// Higher-priority tiers always complete before lower-priority tiers begin.
//
// This prevents low-priority batch jobs from starving critical work:
//   Without priority: jobs start in submission order (random)
//   With priority:    critical jobs always run before high, which run before normal
//
// Each job is an independent checkpoint. If a normal-priority job crashes,
// critical and high jobs that already completed are NOT re-run.

const MAX_CONCURRENT = 2; // process up to 2 jobs at a time per tier

export interface QueueResult {
  totalJobs: number;
  completedJobs: number;
  processingOrder: string[];
}

function groupByTier(jobs: Job[]): Map<number, Job[]> {
  const tiers = new Map<number, Job[]>();
  for (const job of jobs) {
    const weight = PRIORITY_WEIGHT[job.priority];
    if (!tiers.has(weight)) tiers.set(weight, []);
    tiers.get(weight)!.push(job);
  }
  return tiers;
}

export function* processQueue(
  ctx: Context,
  jobs: Job[],
  crashJobId: string | null,
): Generator<any, QueueResult, any> {
  const sorted = [...jobs].sort(
    (a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority],
  );

  const allResults: JobResult[] = [];
  let queuePosition = 1;

  // Process tier by tier (critical first, low last)
  const tiers = groupByTier(sorted);
  const tierWeights = [...tiers.keys()].sort((a, b) => a - b);

  for (const tierWeight of tierWeights) {
    const tierJobs = tiers.get(tierWeight)!;

    // Within each tier: run up to MAX_CONCURRENT jobs in parallel
    for (let i = 0; i < tierJobs.length; i += MAX_CONCURRENT) {
      const chunk = tierJobs.slice(i, i + MAX_CONCURRENT);

      // Fan-out: start all jobs in this chunk simultaneously
      const futures = [];
      for (const job of chunk) {
        const future = yield* ctx.beginRun(executeJob, job, queuePosition++, crashJobId);
        futures.push(future);
      }

      // Fan-in: wait for this chunk to complete before starting next
      for (const future of futures) {
        const result = yield* future;
        allResults.push(result);
      }
    }
  }

  return {
    totalJobs: jobs.length,
    completedJobs: allResults.length,
    processingOrder: allResults.map((r) => `${r.id} [${r.priority}]`),
  };
}
