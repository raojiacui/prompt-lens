import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare/r2";

export async function GET() {
  try {
    const testKey = `test/${Date.now()}-test.txt`;
    const testContent = "R2 connection test - " + new Date().toISOString();
    const testFileUrl = await uploadToR2(Buffer.from(testContent), testKey, "text/plain");

    return NextResponse.json({
      success: true,
      message: "R2 connection successful",
      testFile: testKey,
      testFileUrl,
    });
  } catch (error: any) {
    console.error("R2 test error:", error);
    return NextResponse.json({
      error: "R2 connection failed",
      details: {
        message: error.message,
        code: error.code,
        statusCode: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId,
      },
      possibleCauses: [
        "R2_ACCOUNT_ID or R2_ENDPOINT is missing or incorrect",
        "R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY is incorrect",
        "R2_BUCKET_NAME does not exist",
        "The R2 API token does not have object read/write permission",
        "R2_PUBLIC_URL is missing or does not point to this bucket",
      ],
    }, { status: 500 });
  }
}
