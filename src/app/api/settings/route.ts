import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const mask = (v: string | null | undefined) =>
  v ? `${v.slice(0, 6)}…(${v.length})` : "";

/** Return current persisted settings with secrets masked. */
export async function GET() {
  const row = await db.select().from(settings).where(eq(settings.id, 1)).get();
  return NextResponse.json({
    rommUrl: row?.rommUrl ?? "",
    rommTokenMasked: mask(row?.rommToken),
    torboxApiKeyMasked: mask(row?.torboxApiKey),
    igdbClientId: row?.igdbClientId ?? "",
    igdbClientSecretMasked: mask(row?.igdbClientSecret),
    downloadTmpDir: row?.downloadTmpDir ?? "",
  });
}

const bodySchema = z.object({
  rommUrl: z.string().url().optional().or(z.literal("")),
  rommToken: z.string().optional(),
  torboxApiKey: z.string().optional(),
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
    torboxApiKey: keepSecret(input.torboxApiKey, existing?.torboxApiKey),
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
