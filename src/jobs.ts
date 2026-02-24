import type { Context } from "@resonatehq/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Priority = "critical" | "high" | "normal" | "low";

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface Job {
  id: string;
  priority: Priority;
  description: string;
  workMs: number; // simulated processing time
}

export interface JobResult {
  id: string;
  priority: Priority;
  description: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  queuePosition: number;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Track job attempts for crash demo
const jobAttempts = new Map<string, number>();

// ---------------------------------------------------------------------------
// Execute a single job
// Each job is a durable checkpoint — crash recovery resumes from the failing job.
// ---------------------------------------------------------------------------

export async function executeJob(
  _ctx: Context,
  job: Job,
  queuePosition: number,
  crashJobId: string | null,
): Promise<JobResult> {
  const attempt = (jobAttempts.get(job.id) ?? 0) + 1;
  jobAttempts.set(job.id, attempt);

  const startedAt = new Date().toISOString();
  console.log(
    `  [queue]  #${queuePosition} [${job.priority.toUpperCase().padEnd(8)}] ${job.id}: ${job.description}` +
      (attempt > 1 ? ` (retry ${attempt})` : ""),
  );

  await sleep(job.workMs);

  if (crashJobId === job.id && attempt === 1) {
    // Simulate crash on this specific job. Higher-priority jobs already
    // completed are checkpointed — they do NOT re-run.
    throw new Error(`${job.id} crashed — simulated failure`);
  }

  const completedAt = new Date().toISOString();
  console.log(
    `  [queue]  #${queuePosition} [${job.priority.toUpperCase().padEnd(8)}] ${job.id}: done in ${job.workMs}ms`,
  );

  return {
    id: job.id,
    priority: job.priority,
    description: job.description,
    startedAt,
    completedAt,
    durationMs: job.workMs,
    queuePosition,
  };
}
