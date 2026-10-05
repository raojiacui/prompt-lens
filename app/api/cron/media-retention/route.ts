import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { expireProjectMedia } from "@/lib/workflow/media-retention";
import { processMediaCleanupJobs } from "@/lib/workflow/media-cleanup";

export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const provided = request.headers.get("authorization") || "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const retention = await expireProjectMedia(10, dryRun);
  const deletedFiles = dryRun ? 0 : await processMediaCleanupJobs(50);
  return NextResponse.json({ ...retention, deletedFiles, dryRun }, { headers: { "Cache-Control": "no-store" } });
}
