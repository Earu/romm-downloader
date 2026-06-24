import "server-only";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./index";

let migrated = false;

/**
 * Apply pending migrations from ./drizzle. Idempotent and safe to call on every
 * server start (instrumentation.ts). libsql creates the file if missing.
 */
export async function runMigrations(): Promise<void> {
  if (migrated) return;
  await migrate(db, { migrationsFolder: "./drizzle" });
  migrated = true;
}
