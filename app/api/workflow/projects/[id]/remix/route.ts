import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getModelById } from "@/lib/ai/model-registry";
import { kieAccessError, resolveKieApiKeyForFeature } from "@/lib/billing/platform-access";
import { createRemixVersion } from "@/lib/workflow/service";
import { parseWorkflowModelSelection } from "@/lib/workflow/model-selection";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const sourceVersionId = typeof body?.sourceVersionId === "string" ? body.sourceVersionId : "";
  const remixPrompt = typeof body?.remixPrompt === "string" ? body.remixPrompt.trim() : "";
  if (!sourceVersionId || !remixPrompt) {
    return NextResponse.json({ error: "Missing sourceVersionId or remixPrompt" }, { status: 400 });
  }

  const modelSelection = parseWorkflowModelSelection(body);
  const selectedModel = modelSelection.modelMode === "manual" && modelSelection.modelId ? getModelById(modelSelection.modelId) : null;
  if (selectedModel && selectedModel.provider !== "kie") {
    return NextResponse.json({ error: "视频 remix 只支持 KIE 模型。免费 OpenRouter Gemini 仅用于两次视频分析试用。", code: "KIE_MODEL_REQUIRED" }, { status: 400 });
  }

  const keyAccess = await resolveKieApiKeyForFeature(session.user.id, { requiredPackageScope: "video_analysis" });
  if (!keyAccess.apiKey) return NextResponse.json(kieAccessError("视频 remix"), { status: 400 });

  try {
    const { id } = await params;
    const bundle = await createRemixVersion({
      userId: session.user.id,
      projectId: id,
      sourceVersionId,
      remixPrompt,
      allowPlatformKeyForAnalysis: keyAccess.source === "platform_admin" || keyAccess.source === "platform_paid",
      ...modelSelection,
    });
    return NextResponse.json(bundle);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Remix failed" }, { status: 500 });
  }
}

