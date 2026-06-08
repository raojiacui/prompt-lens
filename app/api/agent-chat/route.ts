import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { callAIProvider } from "@/lib/ai/chat";

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messages, provider = "deepseek" } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
    }

    const reply = await callAIProvider({
      userId: session.user.id,
      provider,
      messages,
    });

    return NextResponse.json({ reply });
  } catch (error: any) {
    console.error("[Agent Chat] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}