import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import { getConfig } from "@/lib/config";
import { encryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * Return the EFFECTIVE settings (env merged with the saved DB row) so the form
 * reflects values configured via environment variables too. Admin-only: this
 * exposes stored secrets in full to pre-fill the (password) inputs, so non-admin
 * users (and unauthenticated callers) must not reach it.
 */
export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
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
    disabledSources: cfg.disabledSources,
    firmwareAutoInstall: cfg.firmwareAutoInstall,
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
  disabledSources: z.array(z.string()).optional(),
  firmwareAutoInstall: z.boolean().optional(),
});

/**
 * Upsert settings (id=1). Empty strings are treated as "leave unchanged" for
 * secrets so masked values aren't accidentally cleared on save.
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const existing = await db.select().from(settings).where(eq(settings.id, 1)).get();

  // Empty/undefined => keep the (already-encrypted) current value; a new value is
  // encrypted before storage (encryption-at-rest, see lib/crypto/secrets).
  const keepSecret = (incoming: string | undefined, current: string | null | undefined) =>
    incoming === undefined || incoming === "" ? (current ?? null) : encryptSecret(incoming);

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
    // Persist as CSV; an explicit empty array saves "" (all sources enabled).
    disabledSources:
      input.disabledSources !== undefined
        ? input.disabledSources.join(",")
        : (existing?.disabledSources ?? null),
    firmwareAutoInstall:
      input.firmwareAutoInstall ?? existing?.firmwareAutoInstall ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(settings)
    .values(values)
    .onConflictDoUpdate({ target: settings.id, set: values });

  return NextResponse.json({ ok: true });
}
