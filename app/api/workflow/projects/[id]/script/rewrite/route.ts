import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { commercialRewriteEnabled } from "@/lib/billing/commercial-rewrite";
import { getPlatformKieApiKey } from "@/lib/billing/platform-access";
import { getUserCredential } from "@/lib/byok/credentials";
import { proposeScriptRewrite } from "@/lib/workflow/full-video-script-rewrite";
import { scriptError } from "@/lib/workflow/full-video-script-errors";

export const maxDuration = 300;
const bodySchema = z.object({ versionId: z.string().uuid(), revision: z.number().int().positive(), requestId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(8000), sceneIds: z.array(z.string().uuid()).max(100),
  language: z.enum(["zh", "en"]), payer: z.enum(["included", "byok"]) }).strict();
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid rewrite request" }, { status: 400 });
  const body = parsed.data;
  if (body.payer === "included" && !commercialRewriteEnabled()) return NextResponse.json({ error: "套餐改写暂不可用 / Included rewrites unavailable" }, { status: 403 });
  try {
    const credential = body.payer === "byok" ? await getUserCredential(session.user.id) : null;
    const apiKey = body.payer === "included" ? getPlatformKieApiKey() : credential?.apiKey;
    if (!apiKey) return NextResponse.json({ error: "请先配置可用 API Key / API key unavailable", final: true }, { status: 400 });
    const { id } = await params;
    const candidate = await proposeScriptRewrite({ ...body, userId: session.user.id, projectId: id, apiKey, provider: credential?.provider ?? "kie" });
    return NextResponse.json({ candidate }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return scriptError(error); }
}
