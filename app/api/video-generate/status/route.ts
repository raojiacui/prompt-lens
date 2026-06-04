import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const KIE_STATUS_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json({ error: "Task ID required" }, { status: 400 });
    }

    const kieApiKey = process.env.KIE_API_KEY;
    if (!kieApiKey) {
      return NextResponse.json(
        { error: "KIE_API_KEY not configured" },
        { status: 500 }
      );
    }

    // 查询 Kie.ai API 状态
    const response = await fetch(`${KIE_STATUS_URL}?taskId=${taskId}`, {
      headers: {
        "Authorization": `Bearer ${kieApiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to get status");
    }

    const data = await response.json();

    // 标准化返回格式
    return NextResponse.json({
      taskId: data.data?.taskId,
      status: data.data?.state, // waiting, queuing, generating, success, fail
      url: data.data?.resultJson ? JSON.parse(data.data.resultJson)?.resultUrls?.[0] : null,
      error: data.data?.failMsg,
    });
  } catch (error: any) {
    console.error("Video status error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get status" },
      { status: 500 }
    );
  }
}