import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, userApiKeys } from "@/lib/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { encryptApiKey, decryptApiKey, isValidEncryptedKey } from "@/lib/utils/encryption";

import { isUserProvider, USER_PROVIDERS } from "@/lib/ai/providers";
import { listInfistarModels } from "@/lib/ai/infistar-client";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKeys = await db.query.userApiKeys.findMany({
      where: and(eq(userApiKeys.userId, session.user.id), inArray(userApiKeys.provider, [...USER_PROVIDERS])),
      orderBy: [desc(userApiKeys.updatedAt), desc(userApiKeys.createdAt)],
    });

    const sanitizedKeys = apiKeys.map((key) => {
      let displayKey = "••••••••";
      let decryptError = false;
      try {
        if (isValidEncryptedKey(key.apiKey)) {
          const decrypted = decryptApiKey(key.apiKey);
          displayKey = decrypted.substring(0, 4) + "••••••••" + decrypted.substring(decrypted.length - 4);
        } else {
          decryptError = true;
          displayKey = "••••••••";
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
        isPreferred: key.isPreferred,
        createdAt: key.createdAt,
        apiKey: displayKey,
        decryptError,
      };
    });

    const preferredProvider = apiKeys.find(key => key.isActive && key.isPreferred)?.provider
      || (apiKeys.some(key => key.isActive && key.provider === "kie") ? "kie" : apiKeys.find(key => key.isActive)?.provider) || null;
    return NextResponse.json({ apiKeys: sanitizedKeys, preferredProvider }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("API key get error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const apiKey = body?.apiKey;
    const provider = body?.provider ?? "kie";

    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 512) {
      return NextResponse.json({ error: "Missing API Key" }, { status: 400 });
    }

    if (!isUserProvider(provider)) {
      return NextResponse.json({ error: "Unsupported API provider" }, { status: 400 });
    }

    if (apiKey.trim().length < 16) {
      return NextResponse.json({ error: "Invalid API Key format" }, { status: 400 });
    }

    const { allowed } = await checkRateLimit(`provider-save:${session.user.id}`, 6, 60_000);
    if (!allowed) return NextResponse.json({ error: "Too many save attempts. Try again shortly.", code: "KEY_SAVE_RATE_LIMITED" }, { status: 429 });

    // Validate before acquiring the transaction lock or replacing any stored key.
    // These read-only provider endpoints do not invoke paid model inference.
    try {
      if (provider === "infistar") await listInfistarModels(apiKey.trim(), { refresh: true });
      else {
        const base = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
        const response = await fetch(`${base}/api/v1/chat/credit`, { headers: { Authorization: `Bearer ${apiKey.trim()}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const data = await response.json();
        if (!response.ok || data.code !== 200) throw new Error("Provider authentication failed");
      }
    } catch {
      return NextResponse.json({ error: "API Key verification failed. Check the provider, key and network.", code: "KEY_VALIDATION_FAILED" }, { status: 400 });
    }

    const encryptedApiKey = encryptApiKey(apiKey.trim());
    await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`byok:${session.user.id}`}))`);
    const existing = await tx.query.userApiKeys.findMany({
      where: and(
        eq(userApiKeys.userId, session.user.id),
        eq(userApiKeys.provider, provider)
      ),
    });

    if (existing.length > 0) {
      await tx
        .update(userApiKeys)
        .set({
          apiKey: encryptedApiKey,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(and(
          eq(userApiKeys.userId, session.user.id),
          eq(userApiKeys.provider, provider)
        ));
    } else {
      await tx.insert(userApiKeys).values({
        userId: session.user.id,
        provider,
        apiKey: encryptedApiKey,
        isActive: true,
      });
    }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API key save error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { provider } = await request.json();
  if (!isUserProvider(provider)) return NextResponse.json({ error: "Unsupported API provider" }, { status: 400 });
  try {
    const changed = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`byok:${session.user.id}`}))`);
      const record = await tx.query.userApiKeys.findFirst({
        where: and(eq(userApiKeys.userId, session.user.id), eq(userApiKeys.provider, provider), eq(userApiKeys.isActive, true)),
        orderBy: [desc(userApiKeys.updatedAt)],
      });
      if (!record || !isValidEncryptedKey(record.apiKey) || !decryptApiKey(record.apiKey)) return false;
      await tx.update(userApiKeys).set({ isPreferred: false }).where(eq(userApiKeys.userId, session.user.id));
      await tx.update(userApiKeys).set({ isPreferred: true }).where(eq(userApiKeys.id, record.id));
      return true;
    });
    return NextResponse.json(changed ? { success: true } : { error: "Save a valid API Key first" }, { status: changed ? 200 : 400 });
  } catch {
    return NextResponse.json({ error: "Unable to switch API provider" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
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

    await db.delete(userApiKeys).where(and(eq(userApiKeys.id, id), eq(userApiKeys.userId, session.user.id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API key delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
