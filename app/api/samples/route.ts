import { NextRequest, NextResponse } from "next/server";
import { getPublicWorkflowSamples } from "@/lib/samples/public-workflow-samples";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = Number.parseInt(searchParams.get("limit") || "60", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 60;
    const samples = await getPublicWorkflowSamples(limit);

    return NextResponse.json({ samples });
  } catch (error) {
    console.error("Samples error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
