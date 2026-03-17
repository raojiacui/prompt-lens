import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    SILICONFLOW_API_KEY: !!process.env.SILICONFLOW_API_KEY,
    DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  });
}
