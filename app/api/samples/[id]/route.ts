import { NextResponse } from "next/server";
import { getPublicSampleBundle } from "@/lib/samples/public-workflow-samples";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const bundle = await getPublicSampleBundle(id);
    if (!bundle) return NextResponse.json({ error: "Sample not found" }, { status: 404 });

    return NextResponse.json(bundle);
  } catch (error) {
    console.error("Sample detail error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
