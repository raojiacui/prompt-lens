import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare/r2";

export const runtime = "nodejs";

function mask(value: string | undefined) {
  if (!value) return "missing";
  if (value.length <= 8) return `${value.length} chars`;
  return `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`;
}

export async function GET() {
  const key = `debug/r2-upload-${Date.now()}.txt`;

  try {
    const url = await uploadToR2(
      Buffer.from(`R2 debug upload ${new Date().toISOString()}`, "utf8"),
      key,
      "text/plain"
    );

    return NextResponse.json({
      ok: true,
      key,
      url,
      config: {
        endpoint: process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? "derived-from-account-id" : "missing"),
        accountId: mask(process.env.R2_ACCOUNT_ID),
        accessKeyId: mask(process.env.R2_ACCESS_KEY_ID),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ? "present" : "missing",
        bucketName: process.env.R2_BUCKET_NAME || "missing",
        publicUrl: process.env.R2_PUBLIC_URL || "missing",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        config: {
          endpoint: process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? "derived-from-account-id" : "missing"),
          accountId: mask(process.env.R2_ACCOUNT_ID),
          accessKeyId: mask(process.env.R2_ACCESS_KEY_ID),
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ? "present" : "missing",
          bucketName: process.env.R2_BUCKET_NAME || "missing",
          publicUrl: process.env.R2_PUBLIC_URL || "missing",
        },
      },
      { status: 500 }
    );
  }
}