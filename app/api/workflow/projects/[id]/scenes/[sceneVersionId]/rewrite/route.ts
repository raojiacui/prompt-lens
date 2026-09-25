import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getModelById } from "@/lib/ai/model-registry";
import { getPlatformKieApiKey, kieAccessError, resolveKieApiKeyForFeature } from "@/lib/billing/platform-access";
import { commercialRewriteEnabled } from "@/lib/billing/commercial-rewrite";
import { getUserKieApiKey } from "@/lib/byok/kie";
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
  if (instruction.length > 8000 || (typeof body?.currentPrompt === "string" && body.currentPrompt.length > 40000)) {
    return NextResponse.json({ error: "Rewrite input too long" }, { status: 400 });
  }

  if (commercialRewriteEnabled()) {
    const payer = body?.payer;
    if (payer !== "included" && payer !== "byok") return NextResponse.json({ error: "请选择套餐改写额度或自带 Key", code: "REWRITE_PAYER_REQUIRED" }, { status: 400 });
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    if (payer === "included" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      return NextResponse.json({ error: "Invalid rewrite request ID" }, { status: 400 });
    }
    try {
      const key = payer === "included" ? getPlatformKieApiKey() : await getUserKieApiKey(session.user.id);
      if (!key) return NextResponse.json({ error: payer === "included" ? "Platform rewrite temporarily unavailable" : "Configure your KIE API Key first", code: "KIE_KEY_REQUIRED", final: true }, { status: 400 });
      const scene = await rewriteSceneVersion({
        userId: session.user.id, projectId: id, sceneVersionId, instruction,
        currentPrompt: typeof body?.currentPrompt === "string" && body.currentPrompt.trim() ? body.currentPrompt.trim() : undefined,
        outputLanguage: isLocale(body?.outputLanguage) ? body.outputLanguage : defaultLocale,
        modelMode: "manual", modelId: "analysis-gemini-2-5-pro", modelPriority: "best_quality",
        rewriteKeySource: payer === "included" ? "platform" : "user",
        allowPlatformKeyForRewrite: payer === "included",
        commercialTaskKey: payer === "included" ? `rewrite:${requestId}` : undefined,
      });
      return NextResponse.json({ scene, keySource: payer === "included" ? "platform_paid" : "user", billing: { payer, chargedCredits: 0, includedRewrites: payer === "included" ? 1 : 0 } });
    } catch (error) {
      const code = error instanceof Error ? error.message : "REWRITE_FAILED";
      const zh = body?.outputLanguage !== "en";
      const errors: Record<string, { status: number; final: boolean; message: string }> = {
        INSUFFICIENT_COMMERCIAL_BALANCE: { status: 402, final: true, message: zh ? "套餐改写次数不足，请充值或选择自带 Key。" : "No included rewrites left. Top up or select your own key." },
        REWRITE_IN_PROGRESS: { status: 409, final: false, message: zh ? "这次改写仍在处理中，请稍后重试查询，不会重复扣次数。" : "This rewrite is still processing. Retry later to retrieve it without another charge." },
        REWRITE_PREVIOUSLY_FAILED: { status: 409, final: true, message: zh ? "上次改写失败，次数已退回，可以重新提交。" : "The previous rewrite failed and its allowance was returned. Submit again." },
        REWRITE_PROVIDER_FAILED: { status: 502, final: true, message: zh ? "AI 改写失败，次数已退回，原版本已保留。" : "AI rewrite failed. Your allowance was returned and the original is preserved." },
      };
      const known = errors[code];
      return NextResponse.json({ code: known ? code : "REWRITE_STATUS_UNKNOWN", final: known?.final ?? false, error: known?.message ?? (zh ? "暂时无法确认改写结果，请稍后重试查询。" : "Unable to confirm the rewrite result. Retry later to retrieve it.") }, { status: known?.status ?? 500 });
    }
  }

  const modelSelection = parseWorkflowModelSelection(body);
  const selectedModel = modelSelection.modelMode === "manual" && modelSelection.modelId ? getModelById(modelSelection.modelId) : null;
  if (selectedModel && selectedModel.provider !== "kie") {
    return NextResponse.json({ error: "AI 重写脚本只支持 KIE 模型。", code: "KIE_MODEL_REQUIRED" }, { status: 400 });
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
      currentPrompt: typeof body?.currentPrompt === "string" && body.currentPrompt.trim() ? body.currentPrompt.trim() : undefined,
      outputLanguage: isLocale(body?.outputLanguage) ? body.outputLanguage : defaultLocale,
      allowPlatformKeyForRewrite: keyAccess.source === "platform_admin" || keyAccess.source === "platform_paid",
      ...modelSelection,
    });
    return NextResponse.json({ scene, keySource: keyAccess.source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scene rewrite failed" }, { status: 500 });
  }
}

