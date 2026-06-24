import "server-only";
import { syncIfStale } from "@/lib/minerva/sync";
import { advanceJob } from "./orchestrator";
import { listActiveJobs } from "./queue";

const POLL_MS = 4000;
const MAX_CONCURRENT = 2;
// How often to check whether the Minerva index needs its ~monthly refresh.
const MINERVA_CHECK_MS = 12 * 60 * 60 * 1000;

// Guard against duplicate intervals across HMR reloads in dev.
const g = globalThis as unknown as {
  __jobWorker?: { started: boolean; processing: Set<string> };
};
const state = (g.__jobWorker ??= { started: false, processing: new Set() });

/**
 * Background poll loop: every POLL_MS, advance non-terminal jobs (up to
 * MAX_CONCURRENT at once). Long steps (fetch/upload) hold their slot until done;
 * the in-memory `processing` set prevents re-entrancy. Started from instrumentation.ts.
 */
export function startWorker(): void {
  if (state.started) return;
  state.started = true;
  console.log("[worker] download worker started");

  const tick = async () => {
    if (state.processing.size >= MAX_CONCURRENT) return;
    try {
      const active = await listActiveJobs();
      for (const job of active) {
        if (state.processing.size >= MAX_CONCURRENT) break;
        if (state.processing.has(job.id)) continue;
        state.processing.add(job.id);
        void advanceJob(job).finally(() => state.processing.delete(job.id));
      }
    } catch (e) {
      console.error("[worker] tick error:", e);
    }
  };

  setInterval(tick, POLL_MS);

  // Keep the Minerva index fresh (~monthly). Checks now and periodically;
  // syncIfStale is a no-op unless data is missing or older than the max age.
  void syncIfStale();
  setInterval(() => void syncIfStale(), MINERVA_CHECK_MS);
}
