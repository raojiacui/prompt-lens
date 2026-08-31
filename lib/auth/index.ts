import { db } from "@/lib/db";
import { account, creditLedger, session, user, userCredits, verification } from "@/lib/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, anonymous } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { eq } from "drizzle-orm";

// 配置代理（仅本地开发环境使用，禁止在生产环境使用）
const isLocalDev = process.env.NODE_ENV === "development";
const proxyUrl = isLocalDev ? (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:7897") : undefined;

if (proxyUrl) {
  void import("undici")
    .then(({ setGlobalDispatcher, ProxyAgent }) => {
      const agent = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(agent);
      console.log("[Auth] Proxy enabled (local dev only):", proxyUrl);
    })
    .catch((error) => {
      console.warn("[Auth] Failed to set up proxy:", error);
    });
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
    expiresIn: 60 * 60 * 24 * 30, // 30 days
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
        name: "prompt-lens.session_token",
        attributes: {
          path: "/",
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60 * 24 * 30,
        },
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
  emailAndPassword: {
    enabled: false, // 禁用密码登录
  },
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          // 检查是否为管理员邮箱
          const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase());
          const userEmail = createdUser.email?.toLowerCase();


          await db
            .insert(userCredits)
            .values({
              userId: createdUser.id,
              balance: 2,
              lifetimeGranted: 2,
              metadata: { source: "signup_bonus" },
            })
            .onConflictDoNothing({ target: userCredits.userId });

          await db.insert(creditLedger).values({
            userId: createdUser.id,
            amount: 2,
            balanceAfter: 2,
            type: "manual_grant",
            note: "注册赠送 2 积分",
            metadata: { source: "signup_bonus" },
          });
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
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "https://prompt-lens.cc.cd",
    process.env.NEXT_PUBLIC_SITE_URL || "",
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "",
  ].filter(Boolean),
  plugins: [
    anonymous(),
    admin(),
    nextCookies(),
    emailOTP({
      sendVerificationOTP: async ({ email, otp }) => {
        const nodemailer = await import("nodemailer");

        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587"),
          secure: false,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM,
          to: email,
          subject: "Prompt Lens 登录验证码",
          html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #D97757;">Prompt Lens 登录验证码</h2>
              <p>您的登录验证码是：</p>
              <div style="background: #f5f5f5; padding: 20px; font-size: 32px; letter-spacing: 8px; text-align: center; border-radius: 8px; font-family: monospace;">
                ${otp}
              </div>
              <p style="color: #666; font-size: 14px; margin-top: 20px;">
                验证码有效期为 10 分钟，请尽快完成登录。
              </p>
            </div>
          `,
        });
      },
    }),
  ],
});

type CurrentUser = typeof user.$inferSelect;

function envList(name: string) {
  return (process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return envList("ADMIN_EMAILS")
    .map((item) => item.toLowerCase())
    .includes(normalized);
}

export function isAdminUserId(userId: string | null | undefined): boolean {
  const normalized = userId?.trim();
  if (!normalized) return false;
  return envList("ADMIN_USER_IDS").includes(normalized);
}

export function isAdminProfile(profile: Pick<CurrentUser, "id" | "email" | "role"> | null | undefined): boolean {
  return profile?.role === "admin" || isAdminEmail(profile?.email) || isAdminUserId(profile?.id);
}

async function persistEnvAdminRole(currentUser: CurrentUser): Promise<CurrentUser> {
  if (currentUser.role === "admin" || (!isAdminEmail(currentUser.email) && !isAdminUserId(currentUser.id))) {
    return currentUser;
  }

  try {
    await db.update(user).set({ role: "admin" }).where(eq(user.id, currentUser.id));
    return { ...currentUser, role: "admin" };
  } catch (error) {
    console.warn("[Auth] Failed to persist admin role:", error);
    return currentUser;
  }
}

// 辅助函数：获取当前用户
export async function getCurrentUser(userId: string) {
  return db.query.user.findFirst({
    where: eq(user.id, userId),
  });
}

export async function getAdminUser(userId: string): Promise<CurrentUser | null> {
  const currentUser = await getCurrentUser(userId);
  if (!currentUser || !isAdminProfile(currentUser)) return null;
  return persistEnvAdminRole(currentUser);
}

export async function getAdminUserFromHeaders(headers: Headers): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  return getAdminUser(session.user.id);
}

// 辅助函数：检查用户是否为管理员
export async function isAdmin(userId: string): Promise<boolean> {
  return Boolean(await getAdminUser(userId));
}

