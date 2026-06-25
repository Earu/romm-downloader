import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * Return the EFFECTIVE settings (env merged with the saved DB row) so the form
 * reflects values configured via environment variables too. Secrets are returned
 * in full to pre-fill the (password) inputs — this is an unauthenticated,
 * self-hosted admin tool, so anyone who can reach it can read its config anyway.
 */
export async function GET() {
  const cfg = await getConfig();
  return NextResponse.json({
    rommUrl: cfg.rommUrl,
    rommToken: cfg.rommToken,
    debridProvider: cfg.debridProvider || "none",
    debridApiKey: cfg.debridApiKey,
    maxDebridGb: cfg.maxDebridGb,
    igdbClientId: cfg.igdbClientId,
    igdbClientSecret: cfg.igdbClientSecret,
    downloadTmpDir: cfg.downloadTmpDir,
  });
}

const bodySchema = z.object({
  rommUrl: z.string().url().optional().or(z.literal("")),
  rommToken: z.string().optional(),
  debridProvider: z.string().optional(),
  debridApiKey: z.string().optional(),
  maxDebridGb: z.coerce.number().int().positive().max(100000).optional(),
  igdbClientId: z.string().optional(),
  igdbClientSecret: z.string().optional(),
  downloadTmpDir: z.string().optional(),
});

/**
 * Upsert settings (id=1). Empty strings are treated as "leave unchanged" for
 * secrets so masked values aren't accidentally cleared on save.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const existing = await db.select().from(settings).where(eq(settings.id, 1)).get();

  const keepSecret = (incoming: string | undefined, current: string | null | undefined) =>
    incoming === undefined || incoming === "" ? (current ?? null) : incoming;

  const values = {
    id: 1 as const,
    rommUrl: input.rommUrl ?? existing?.rommUrl ?? null,
    rommToken: keepSecret(input.rommToken, existing?.rommToken),
    debridProvider: input.debridProvider ?? existing?.debridProvider ?? null,
    debridApiKey: keepSecret(input.debridApiKey, existing?.debridApiKey),
    maxDebridGb: input.maxDebridGb ?? existing?.maxDebridGb ?? null,
    igdbClientId: input.igdbClientId ?? existing?.igdbClientId ?? null,
    igdbClientSecret: keepSecret(input.igdbClientSecret, existing?.igdbClientSecret),
    downloadTmpDir: input.downloadTmpDir ?? existing?.downloadTmpDir ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(settings)
    .values(values)
    .onConflictDoUpdate({ target: settings.id, set: values });

  return NextResponse.json({ ok: true });
}
