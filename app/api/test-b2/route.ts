import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, ListBucketsCommand } from "@aws-sdk/client-s3";

export async function GET(request: NextRequest) {
  try {
    const s3Client = new S3Client({
      region: "us-east-1",
      endpoint: `https://s3.${process.env.B2_REGION}.backblazeb2.com`,
      credentials: {
        accessKeyId: process.env.B2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.B2_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    });

    // 先测试列出 buckets
    console.log("Testing B2 connection...", {
      endpoint: `https://s3.${process.env.B2_REGION}.backblazeb2.com`,
      region: "us-east-1",
      keyId: process.env.B2_ACCESS_KEY_ID?.substring(0, 10) + "...",
      bucket: process.env.B2_BUCKET_NAME,
    });

    // 测试列出 buckets
    try {
      const listResult = await s3Client.send(new ListBucketsCommand({}));
      console.log("List buckets result:", listResult);
    } catch (listError: any) {
      console.error("List buckets error:", listError);
      return NextResponse.json({
        error: "Cannot list buckets - Key may not be S3 compatible",
        details: {
          message: listError.message,
          code: listError.code,
          statusCode: listError.$metadata?.httpStatusCode,
        },
        hint: "Make sure to create an S3 Compatible Application Key, not a regular B2 key",
      }, { status: 401 });
    }

    // 测试上传一个很小的文本文件
    const testKey = `test/${Date.now()}-test.txt`;
    const testContent = "B2 connection test - " + new Date().toISOString();

    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: testKey,
      Body: testContent,
      ContentType: "text/plain",
    }));

    return NextResponse.json({
      success: true,
      message: "B2 connection successful",
      testFile: testKey,
    });
  } catch (error: any) {
    console.error("B2 test error:", error);
    return NextResponse.json({
      error: "B2 connection failed",
      details: {
        message: error.message,
        code: error.code,
        statusCode: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId,
      },
      possibleCauses: [
        "Key is not S3 Compatible (must create S3 Compatible Application Key)",
        "Key doesn't have write permission",
        "Key is expired",
        "Region/endpoint mismatch",
      ],
    }, { status: 500 });
  }
}