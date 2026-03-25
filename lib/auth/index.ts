import { db } from "@/lib/db";
import { account, session, user, verification } from "@/lib/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, anonymous } from "better-auth/plugins";
import { eq } from "drizzle-orm";

// 配置代理（仅本地开发环境使用）
const isLocalhost = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_SITE_URL?.includes("localhost");
const proxyUrl = isLocalhost ? (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:7897") : undefined;

if (proxyUrl) {
  try {
    const { setGlobalDispatcher, ProxyAgent } = require("undici");
    const agent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(agent);
    console.log("[Auth] Proxy enabled:", proxyUrl);
  } catch (error) {
    console.warn("[Auth] Failed to set up proxy:", error);
  }
}

// Get base URL - support dynamic port for development
function getBaseURL() {
  if (process.env.NEXT_PUBLIC_BETTER_AUTH_URL) {
    return process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  // Fallback: detect from request headers in API routes
  return undefined;
}

export const auth = betterAuth({
  appName: "Prompt Analyzer",
  baseURL: getBaseURL(),
  secret: process.env.BETTER_AUTH_SECRET,
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    freshAge: 60 * 5, // Consider session fresh for 5 minutes
    cookieCache: {
      enabled: true,
      maxAge: 10 * 60,
    },
  },
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
    cookies: {
      sessionToken: {
        name: "better-auth.session_token",
      },
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "github"],
    },
  },
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: user,
      session: session,
      account: account,
      verification: verification,
    },
  }),
  socialProviders: {
    github: {
      clientId: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          // 检查是否为管理员邮箱
          const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase());
          const userEmail = createdUser.email?.toLowerCase();

          if (userEmail && adminEmails.includes(userEmail)) {
            await db
              .update(user)
              .set({ role: "admin" })
              .where(eq(user.id, createdUser.id));
            console.log(`User ${createdUser.id} promoted to admin (email: ${createdUser.email})`);
          }
        },
      },
    },
  },
  trustedOrigins: [
    "http://localhost:3000",
    process.env.NEXT_PUBLIC_SITE_URL || "",
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "",
  ].filter(Boolean),
  plugins: [
    anonymous(),
    admin(),
    nextCookies(),
  ],
});

// 辅助函数：检查用户是否为管理员
export async function isAdmin(userId: string): Promise<boolean> {
  const currentUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
  });
  return currentUser?.role === "admin";
}

// 辅助函数：获取当前用户
export async function getCurrentUser(userId: string) {
  return db.query.user.findFirst({
    where: eq(user.id, userId),
  });
}
