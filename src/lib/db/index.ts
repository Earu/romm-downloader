import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./data/app.db";

// Reuse a single client across HMR reloads in dev.
const globalForDb = globalThis as unknown as {
  __libsql?: ReturnType<typeof createClient>;
};

const client = globalForDb.__libsql ?? createClient({ url });
if (process.env.NODE_ENV !== "production") globalForDb.__libsql = client;

export const db = drizzle(client, { schema });
export { schema };
