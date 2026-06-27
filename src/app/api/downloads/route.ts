import { NextResponse } from "next/server";
import { z } from "zod";
import { getRommClient } from "@/lib/clients";
import { createJob, listJobs } from "@/lib/jobs/queue";
import { toRommFsSlug } from "@/lib/platforms";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await listJobs();
  return NextResponse.json({ jobs });
}

const createSchema = z.object({
  // Chosen source: which provider + its opaque reference (Minerva path / Vimm
  // vault id / pasted magnet for the "magnet" pseudo-provider).
  sourceProvider: z.enum(["minerva", "vimm", "magnet"]),
  sourceRef: z.string().min(1),
  title: z.string().min(1),
  catalogGameId: z.string().optional(),
  coverUrl: z.string().url().optional(),
  // Either an existing RomM platform id, or omit to auto-create via platformSlug.
  platformId: z.number().int().positive().optional(),
  platformSlug: z.string().min(1),
});

/** Queue a new download job. The worker picks it up on its next tick. */
export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  let platformId = input.platformId;
  if (!platformId) {
    // Platform doesn't exist in RomM yet — create it now using the fs_slug.
    try {
      const client = await getRommClient();
      const created = await client.createPlatform(toRommFsSlug(input.platformSlug));
      platformId = created.id;
    } catch (e) {
      return NextResponse.json(
        { error: `Failed to create RomM platform "${input.platformSlug}": ${e instanceof Error ? e.message : e}` },
        { status: 502 },
      );
    }
  }

  const job = await createJob({
    sourceProvider: input.sourceProvider,
    sourceRef: input.sourceRef,
    title: input.title,
    catalogGameId: input.catalogGameId,
    coverUrl: input.coverUrl,
    targetPlatformId: platformId,
    targetPlatformSlug: input.platformSlug,
  });
  return NextResponse.json({ job }, { status: 201 });
}
