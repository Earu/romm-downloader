/**
 * Next.js startup hook (runs once per server process). We use it to apply DB
 * migrations and — once built — to launch the background download worker.
 * Guarded to the Node.js runtime so it never runs on the edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("@/lib/db/migrate");
  await runMigrations();

  // The download worker is started here once lib/jobs/worker.ts exists.
  const { startWorker } = await import("@/lib/jobs/worker");
  startWorker();
}
