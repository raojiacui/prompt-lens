import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { quoteImageAnalysis } from "@/lib/workflow/analysis-tasks";
import { checkRateLimit } from "@/lib/utils/rate-limit";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.projectId) || typeof body.mediaUrl !== "string" || body.mediaUrl.length > 2048 || typeof body.modelId !== "string" || (body.mediaName !== undefined && typeof body.mediaName !== "string")) return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
  try {
    if (!(await checkRateLimit(`image-analysis-quote:${session.user.id}`, 5, 60000)).allowed) return NextResponse.json({ code: "IMAGE_QUOTE_RATE_LIMIT" }, { status: 429 });
    return NextResponse.json(await quoteImageAnalysis(session.user.id, body));
  }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^[A-Z_]+$/.test(message) ? message : "IMAGE_QUOTE_UNAVAILABLE";
    return NextResponse.json({ code }, { status: code === "COMMERCIAL_NOT_ENABLED" ? 503 : code === "IMAGE_QUOTE_RATE_LIMIT" ? 429 : 409 });
  }
}
