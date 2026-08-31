import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, userApiKeys } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { encryptApiKey, decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";

const SUPPORTED_USER_PROVIDER = "kie" as const;

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKeys = await db.query.userApiKeys.findMany({
      where: and(eq(userApiKeys.userId, session.user.id), eq(userApiKeys.provider, SUPPORTED_USER_PROVIDER)),
    });

    const sanitizedKeys = apiKeys.map((key) => {
      let displayKey = "••••••••";
      let decryptError = false;
      try {
        if (isValidEncryptedKey(key.apiKey)) {
          const decrypted = decryptApiKey(key.apiKey);
          displayKey = decrypted.substring(0, 8) + "••••••••" + decrypted.substring(decrypted.length - 4);
        } else {
          displayKey = key.apiKey.substring(0, 8) + "••••••••" + key.apiKey.substring(key.apiKey.length - 4);
        }
      } catch (e) {
        decryptError = true;
        displayKey = "无法解密，请删除后重新保存";
        console.error("Failed to decrypt API key:", e);
      }

      return {
        id: key.id,
        provider: key.provider,
        isActive: key.isActive,
        createdAt: key.createdAt,
        apiKey: displayKey,
        decryptError,
      };
    });

    return NextResponse.json({ apiKeys: sanitizedKeys });
  } catch (error) {
    console.error("API key get error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { provider, apiKey } = body;

    if (!apiKey) {
      return NextResponse.json({ error: "Missing API Key" }, { status: 400 });
    }

    if (provider && provider !== SUPPORTED_USER_PROVIDER) {
      return NextResponse.json({ error: "当前只支持配置 KIE API Key。OpenRouter 仅由平台用于两次免费视频分析试用。" }, { status: 400 });
    }

    if (apiKey.trim().length < 16) {
      return NextResponse.json({ error: "Invalid Kie.ai API Key format" }, { status: 400 });
    }

    const encryptedApiKey = encryptApiKey(apiKey);
    const existing = await db.query.userApiKeys.findFirst({
      where: and(
        eq(userApiKeys.userId, session.user.id),
        eq(userApiKeys.provider, SUPPORTED_USER_PROVIDER)
      ),
    });

    if (existing) {
      await db
        .update(userApiKeys)
        .set({
          apiKey: encryptedApiKey,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(userApiKeys.id, existing.id));
    } else {
      await db.insert(userApiKeys).values({
        userId: session.user.id,
        provider: SUPPORTED_USER_PROVIDER,
        apiKey: encryptedApiKey,
        isActive: true,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API key save error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const existing = await db.query.userApiKeys.findFirst({
      where: and(
        eq(userApiKeys.id, id),
        eq(userApiKeys.userId, session.user.id)
      ),
    });

    if (!existing) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    await db.delete(userApiKeys).where(eq(userApiKeys.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API key delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
