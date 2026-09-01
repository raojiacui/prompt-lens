import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { analysisHistory, db, user } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = Number.parseInt(searchParams.get("limit") || "60", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 60;

    const samples = await db
      .select({
        id: analysisHistory.id,
        mediaType: analysisHistory.mediaType,
        mediaUrl: analysisHistory.mediaUrl,
        mediaName: analysisHistory.mediaName,
        corePrompt: analysisHistory.corePrompt,
        prompt: analysisHistory.prompt,
        favorite: analysisHistory.favorite,
        createdAt: analysisHistory.createdAt,
      })
      .from(analysisHistory)
      .innerJoin(user, eq(analysisHistory.userId, user.id))
      .where(and(eq(user.role, "admin"), isNotNull(analysisHistory.mediaUrl)))
      .orderBy(desc(analysisHistory.createdAt))
      .limit(limit);

    return NextResponse.json({ samples });
  } catch (error) {
    console.error("Samples error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
