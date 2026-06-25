import "server-only";
import { syncIfStale } from "@/lib/minerva/sync";
import { advanceJob } from "./orchestrator";
import { failJob, getJob, listActiveJobs } from "./queue";

const POLL_MS = 4000;
// Force-fail the in-flight job if it hasn't updated (made progress) within this
// window — a hung step that never settles would otherwise block the queue
// forever. Active downloads/uploads update on a ~1s cadence and the longest legit
// quiet stretch (waiting for RomM to finalize a large upload) is ~10 min, so this
// stays comfortably above that.
const STALL_MS = 15 * 60 * 1000;
// How often to check whether the Minerva index needs its ~monthly refresh.
const MINERVA_CHECK_MS = 12 * 60 * 60 * 1000;

// Job states the worker advances. Others are terminal, transient, or parked
// waiting for the user (unavailable / multi_file) — skip those so they don't
// block the queue.
const WORKABLE = new Set<string>([
  "requested", "adding", "caching", "fetching", "local_fetching", "uploading",
]);

// Guard against duplicate intervals across HMR reloads in dev. `current` is the id
// of the one job being worked, or null when idle.
const g = globalThis as unknown as {
  __jobWorker?: { started: boolean; current: string | null };
};
const state = (g.__jobWorker ??= { started: false, current: null });

/**
 * Background queue loop: one job at a time. Every POLL_MS, advance the oldest
 * job that has work to do by one step (long steps run to completion). A watchdog
 * frees the slot if its job hangs. Started from instrumentation.ts.
 */
export function startWorker(): void {
  if (state.started) return;
  state.started = true;
  console.log("[worker] download worker started");

  const tick = async () => {
    try {
      // A job is in flight — leave it alone unless it has stalled.
      if (state.current) {
        const job = await getJob(state.current);
        if (job && Date.now() - job.updatedAt.getTime() <= STALL_MS) return;
        if (job) {
          console.warn(`[worker] reaping stalled job ${state.current} (no progress >15m)`);
          await failJob(state.current, "Stalled — no progress for 15 min; cancelled.").catch(() => {});
        }
        state.current = null; // job hung or vanished — free the slot
      }

      // Pick the oldest job with work to do and advance it one step.
      const next = (await listActiveJobs()).find((j) => WORKABLE.has(j.state));
      if (!next) return;
      state.current = next.id;
      void advanceJob(next).finally(() => {
        state.current = null;
      });
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
