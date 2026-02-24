import { Resonate } from "@resonatehq/sdk";
import { processQueue } from "./workflow";
import type { Job } from "./jobs";

// ---------------------------------------------------------------------------
// Resonate setup
// ---------------------------------------------------------------------------

const resonate = new Resonate();
resonate.register(processQueue);

// ---------------------------------------------------------------------------
// Run the priority queue demo
// ---------------------------------------------------------------------------

const crashMode = process.argv.includes("--crash");

// A mix of jobs submitted out-of-priority-order (as they'd arrive in production)
const jobs: Job[] = [
  { id: "job-001", priority: "low",      description: "Archive old logs",            workMs: 200 },
  { id: "job-002", priority: "normal",   description: "Send weekly newsletter",       workMs: 150 },
  { id: "job-003", priority: "critical", description: "Process payment refund",       workMs: 100 },
  { id: "job-004", priority: "low",      description: "Generate monthly PDF report",  workMs: 180 },
  { id: "job-005", priority: "high",     description: "Send order confirmation",      workMs: 120 },
  { id: "job-006", priority: "normal",   description: "Update search index",          workMs: 160 },
  { id: "job-007", priority: "critical", description: "Alert: payment failure spike", workMs: 80  },
  { id: "job-008", priority: "high",     description: "Sync user profile to CDN",     workMs: 130 },
];

// In crash mode, the second "normal" job fails and retries.
// Critical and high-priority jobs that already ran are NOT re-run.
const crashJobId = crashMode ? "job-006" : null;

console.log("=== Priority Queue Demo ===");
console.log(
  `Mode: ${crashMode ? `CRASH (job-006 fails first, resumes from checkpoint)` : "HAPPY PATH (all jobs processed in priority order)"}`,
);
console.log("\nJobs submitted (out of priority order):");
for (const job of jobs) {
  console.log(`  ${job.id} [${job.priority.padEnd(8)}] ${job.description}`);
}
console.log("\n[queue]  Processing 8 jobs (max 2 concurrent per tier)");
console.log("[queue]  Order: CRITICAL → HIGH → NORMAL → LOW\n");

const wallStart = Date.now();

const result = await resonate.run(
  `queue/${Date.now()}`,
  processQueue,
  jobs,
  crashJobId,
);

const wallMs = Date.now() - wallStart;

console.log("\n=== Result ===");
console.log(`Completed: ${result.completedJobs}/${result.totalJobs} jobs in ${wallMs}ms`);
console.log("\nProcessing order (priority enforced):");
result.processingOrder.forEach((entry, i) => {
  console.log(`  ${i + 1}. ${entry}`);
});

if (crashMode) {
  console.log(
    "\nNotice: critical and high jobs ran before the crash.",
    "\nThey were NOT re-run when job-006 retried.",
  );
}
