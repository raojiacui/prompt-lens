import { NextRequest, NextResponse } from "next/server";
import { listModels, routeModel, type ModelCategory, type ModelCapability, type ModelPriority } from "@/lib/ai/model-registry";
import { isUserProvider } from "@/lib/ai/providers";
import { auth } from "@/lib/auth";
import { getUserCredential } from "@/lib/byok/credentials";
import { listInfistarModels } from "@/lib/ai/infistar-client";

function parseCategory(value: string | null): ModelCategory | undefined {
  if (value === "analysis" || value === "video_generation" || value === "audio" || value === "video_edit") return value;
  return undefined;
}

export async function GET(request: NextRequest) {
  const category = parseCategory(request.nextUrl.searchParams.get("category"));
  const requestedProvider = request.nextUrl.searchParams.get("provider");
  const provider = isUserProvider(requestedProvider) ? requestedProvider : "kie";
  const auto = request.nextUrl.searchParams.get("auto") === "1";
  if (!auto) {
    const models = listModels(category, provider);
    if (provider === "infistar") {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      try {
        const credential = await getUserCredential(session.user.id, "infistar");
        if (!credential) return NextResponse.json({ error: "请先保存 Infistar API Key。" }, { status: 400 });
        // Validate credentials without hiding verified auto-group models absent from /models.
        await listInfistarModels(credential.apiKey);
      } catch { return NextResponse.json({ error: "无法获取 Infistar 模型列表，请检查 Key 或稍后重试。" }, { status: 502 }); }
    }
    return NextResponse.json({ models, provider }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const requiredCapabilities = (request.nextUrl.searchParams.get("capabilities") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as ModelCapability[];
  const duration = Number(request.nextUrl.searchParams.get("duration"));
  const aspectRatio = request.nextUrl.searchParams.get("aspectRatio") || undefined;
  const priority = (request.nextUrl.searchParams.get("priority") || "balanced") as ModelPriority;
  const model = category
    ? routeModel({
        category,
        provider,
        requiredCapabilities,
        duration: Number.isFinite(duration) ? duration : undefined,
        aspectRatio,
        priority,
      })
    : null;

  return NextResponse.json({ model });
}
