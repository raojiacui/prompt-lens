import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getModelById } from "@/lib/ai/model-registry";
import { kieAccessError, resolveKieApiKeyForFeature } from "@/lib/billing/platform-access";
import { rewriteSceneVersion } from "@/lib/workflow/service";
import { parseWorkflowModelSelection } from "@/lib/workflow/model-selection";
import { defaultLocale, isLocale } from "@/i18n/config";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sceneVersionId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, sceneVersionId } = await params;
  const body = await request.json().catch(() => null);
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) return NextResponse.json({ error: "Missing rewrite instruction" }, { status: 400 });

  const modelSelection = parseWorkflowModelSelection(body);
  const selectedModel = modelSelection.modelMode === "manual" && modelSelection.modelId ? getModelById(modelSelection.modelId) : null;
  if (selectedModel && selectedModel.provider !== "kie") {
    return NextResponse.json({ error: "AI 重写脚本只支持 KIE 模型。免费 OpenRouter Gemini 仅用于两次视频分析试用。", code: "KIE_MODEL_REQUIRED" }, { status: 400 });
  }

  const keyAccess = await resolveKieApiKeyForFeature(session.user.id, { requiredPackageScope: "video_analysis" });
  if (!keyAccess.apiKey) {
    return NextResponse.json(kieAccessError("AI 重写脚本"), { status: 400 });
  }

  try {
    const scene = await rewriteSceneVersion({
      userId: session.user.id,
      projectId: id,
      sceneVersionId,
      instruction,
      outputLanguage: isLocale(body?.outputLanguage) ? body.outputLanguage : defaultLocale,
      allowPlatformKeyForRewrite: keyAccess.source === "platform_admin" || keyAccess.source === "platform_paid",
      ...modelSelection,
    });
    return NextResponse.json({ scene, keySource: keyAccess.source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scene rewrite failed" }, { status: 500 });
  }
}

