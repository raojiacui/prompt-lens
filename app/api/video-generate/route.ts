import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const KIE_API_URL = "https://api.kie.ai/api/v1/veo/generate";
const KIE_STATUS_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { prompt, aspectRatio = "16:9", model = "veo-3.1-fast" } = body;

    if (!prompt) {
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    }

    const kieApiKey = process.env.KIE_API_KEY;
    if (!kieApiKey) {
      return NextResponse.json(
        { error: "KIE_API_KEY not configured. Please add KIE_API_KEY to environment variables." },
        { status: 500 }
      );
    }

    // 调用 Kie.ai API
    const response = await fetch(KIE_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${kieApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        aspect_ratio: aspectRatio,
        model,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("KIE API error:", response.status, error);
      throw new Error(`KIE API error: ${response.status}`);
    }

    const result = await response.json();

    return NextResponse.json({
      taskId: result.data?.taskId,
      status: "processing",
    });
  } catch (error: any) {
    console.error("Video generate error:", error);
    return NextResponse.json(
      { error: error.message || "Video generation failed" },
      { status: 500 }
    );
  }
}