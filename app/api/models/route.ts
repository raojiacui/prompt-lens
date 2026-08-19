import { NextRequest, NextResponse } from "next/server";
import { listModels, routeModel, type ModelCategory, type ModelCapability, type ModelPriority } from "@/lib/ai/model-registry";

function parseCategory(value: string | null): ModelCategory | undefined {
  if (value === "analysis" || value === "video_generation" || value === "audio" || value === "video_edit") return value;
  return undefined;
}

export async function GET(request: NextRequest) {
  const category = parseCategory(request.nextUrl.searchParams.get("category"));
  const auto = request.nextUrl.searchParams.get("auto") === "1";
  if (!auto) return NextResponse.json({ models: listModels(category) });

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
        requiredCapabilities,
        duration: Number.isFinite(duration) ? duration : undefined,
        aspectRatio,
        priority,
      })
    : null;

  return NextResponse.json({ model });
}