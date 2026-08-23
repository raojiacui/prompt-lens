import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getModelById } from "@/lib/ai/model-registry";
import { getUserApiKeyForProvider } from "@/lib/byok/kie";
import { isAdmin } from "@/lib/auth";
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
  const provider = selectedModel?.provider || "kie";

  const [userApiKey, adminUser] = await Promise.all([getUserApiKeyForProvider(session.user.id, provider), isAdmin(session.user.id)]);
  if (!userApiKey && !adminUser) {
    return NextResponse.json(
      {
        error: `重写脚本需要先在设置里配置你自己的 ${provider} API Key。这个功能不消耗免费视频分析额度，普通用户不会使用平台 Key。`,
        code: "USER_PROVIDER_KEY_REQUIRED",
      },
      { status: 400 },
    );
  }

  try {
    const scene = await rewriteSceneVersion({ userId: session.user.id, projectId: id, sceneVersionId, instruction, outputLanguage: isLocale(body?.outputLanguage) ? body.outputLanguage : defaultLocale, allowPlatformKeyForRewrite: adminUser, ...modelSelection });
    return NextResponse.json({ scene });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scene rewrite failed" }, { status: 500 });
  }
}
