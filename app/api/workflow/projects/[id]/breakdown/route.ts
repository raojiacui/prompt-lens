import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runVideoBreakdown } from "@/lib/workflow/service";
import { parseWorkflowModelSelection } from "@/lib/workflow/model-selection";
import { assertTrialQuota, trialQuotaResponse } from "@/lib/usage/trial-quota";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
  if (!mediaUrl) return NextResponse.json({ error: "Missing mediaUrl" }, { status: 400 });

  try {
    await assertTrialQuota(session.user.id);

    const { id } = await params;
    const bundle = await runVideoBreakdown({
      userId: session.user.id,
      projectId: id,
      mediaUrl,
      mediaName: typeof body?.mediaName === "string" ? body.mediaName : undefined,
      storageKey: typeof body?.storageKey === "string" ? body.storageKey : undefined,
      mediaType: body?.mediaType === "image" ? "image" : "video",
      mediaDuration: typeof body?.mediaDuration === "number" && Number.isFinite(body.mediaDuration) ? body.mediaDuration : undefined,
      singleShot: body?.singleShot === true,
      resolveLinkedMedia: body?.resolveLinkedMedia === true,
      ...parseWorkflowModelSelection(body),
    });
    return NextResponse.json(bundle);
  } catch (error) {
    const quotaError = trialQuotaResponse(error);
    if (quotaError) return NextResponse.json(quotaError, { status: 402 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Breakdown failed" }, { status: 500 });
  }
}
