import { NextRequest, NextResponse } from "next/server";
import { desc, gte, count, countDistinct, eq, sql } from "drizzle-orm";
import { getAdminUserFromHeaders } from "@/lib/auth";
import { getCreditBalancesForUsers } from "@/lib/billing/credits";
import {
  analysisHistory,
  audioAnalysis,
  dailyVisits,
  db,
  operationLogs,
  paymentOrders,
  projectAssets,
  projects,
  user,
  videoClip,
  videoGeneration,
  workflowJobs,
} from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

type DailyMetric = {
  date: string;
  activeUsers: number;
  signedInUsers: number;
  uploads: number;
  uploadBytes: number;
  analyses: number;
  generations: number;
};

type UserUsage = {
  userId: string;
  actions: number;
  uploads: number;
  uploadBytes: number;
  analyses: number;
  generations: number;
  projects: number;
  clips: number;
  lastSeen: string;
};

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date: Date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function makeDailyWindow(days: number) {
  const today = startOfDay(new Date());
  return Array.from({ length: days }, (_, index): DailyMetric => {
    const date = new Date(today.getTime() - (days - 1 - index) * DAY_MS);
    return { date: dayKey(date), activeUsers: 0, signedInUsers: 0, uploads: 0, uploadBytes: 0, analyses: 0, generations: 0 };
  });
}

function numberFromMetadata(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0;
  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isRecoverableAdminQueryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code === "42P01" || message.includes("does not exist") || message.includes("statement timeout") || message.includes("canceling statement");
}
async function safeAdminQuery<T>(label: string, promise: Promise<T>, fallback: T, unavailable: string[]): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (!isRecoverableAdminQueryError(error)) throw error;
    unavailable.push(label);
    console.warn(`[admin] ${label} unavailable, using fallback:`, error);
    return fallback;
  }
}

function touchUser(map: Map<string, UserUsage>, userId: string, createdAt: Date) {
  const existing = map.get(userId) || {
    userId,
    actions: 0,
    uploads: 0,
    uploadBytes: 0,
    analyses: 0,
    generations: 0,
    projects: 0,
    clips: 0,
    lastSeen: createdAt.toISOString(),
  };
  if (createdAt > new Date(existing.lastSeen)) existing.lastSeen = createdAt.toISOString();
  map.set(userId, existing);
  return existing;
}

export async function GET(request: NextRequest) {
  try {
    const adminUser = await getAdminUserFromHeaders(request.headers);
    if (!adminUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    if (request.nextUrl.searchParams.get("probe") === "1") {
      return NextResponse.json({ ok: true });
    }

  const daysParam = Number(request.nextUrl.searchParams.get("days") || 14);
  const days = Number.isFinite(daysParam) ? Math.max(7, Math.min(60, Math.round(daysParam))) : 14;
  const since = new Date(Date.now() - days * DAY_MS);
  const since30 = new Date(Date.now() - 30 * DAY_MS);
  const since7 = new Date(Date.now() - 7 * DAY_MS);
  const today = startOfDay(new Date());
  const unavailable: string[] = [];
  const safe = <T,>(label: string, promise: Promise<T>, fallback: T) => safeAdminQuery(label, promise, fallback, unavailable);

  const zeroCountRows = [{ count: 0 }];
  const [
    totalUsersRow,
    newUsersTodayRow,
    newUsers7dRow,
    newUsers30dRow,
    totalProjectsRow,
    totalGenerationsRow,
    totalWorkflowJobsRow,
    purchasedUsersRow,
    recentLogs,
    recentProjects,
    recentGenerations,
    recentAnalysisHistory,
    recentAudioAnalysis,
    recentVideoClips,
    recentProjectAssets,
    recentUsers,
    allUsers,
    projectOwners,
    dailyVisitMetrics,
    activeWindowsRows,
    recentPaidOrders,
  ] = await Promise.all([
    safe("total users", db.select({ count: count() }).from(user), zeroCountRows),
    safe("new users today", db.select({ count: count() }).from(user).where(gte(user.createdAt, today)), zeroCountRows),
    safe("new users 7d", db.select({ count: count() }).from(user).where(gte(user.createdAt, since7)), zeroCountRows),
    safe("new users 30d", db.select({ count: count() }).from(user).where(gte(user.createdAt, since30)), zeroCountRows),
    safe("projects count", db.select({ count: count() }).from(projects), zeroCountRows),
    safe("video generations count", db.select({ count: count() }).from(videoGeneration), zeroCountRows),
    safe("workflow jobs count", db.select({ count: count() }).from(workflowJobs), zeroCountRows),
    safe("purchased users", db.select({ count: countDistinct(paymentOrders.userId) }).from(paymentOrders).where(eq(paymentOrders.status, "paid")), zeroCountRows),
    safe("operation logs", db.query.operationLogs.findMany({ where: gte(operationLogs.createdAt, since), orderBy: [desc(operationLogs.createdAt)], limit: 3000 }), []),
    safe("recent projects", db.query.projects.findMany({ where: gte(projects.createdAt, since), orderBy: [desc(projects.createdAt)], limit: 1000 }), []),
    safe("recent generations", db.query.videoGeneration.findMany({ where: gte(videoGeneration.createdAt, since), orderBy: [desc(videoGeneration.createdAt)], limit: 1000 }), []),
    safe("recent analysis history", db.query.analysisHistory.findMany({ where: gte(analysisHistory.createdAt, since), orderBy: [desc(analysisHistory.createdAt)], limit: 1000 }), []),
    safe("recent audio analysis", db.query.audioAnalysis.findMany({ where: gte(audioAnalysis.createdAt, since), orderBy: [desc(audioAnalysis.createdAt)], limit: 1000 }), []),
    safe("recent video clips", db.query.videoClip.findMany({ where: gte(videoClip.createdAt, since), orderBy: [desc(videoClip.createdAt)], limit: 1000 }), []),
    safe("recent project assets", db.query.projectAssets.findMany({ where: gte(projectAssets.createdAt, since), orderBy: [desc(projectAssets.createdAt)], limit: 1000 }), []),
    safe("recent users", db.query.user.findMany({ orderBy: [desc(user.createdAt)], limit: 20 }), []),
    safe("all users", db.query.user.findMany({ limit: 3000 }), []),
    safe("project owners", db.query.projects.findMany({ limit: 3000 }), []),
    safe("daily visit metrics", db.select({
      date: dailyVisits.date,
      visitors: sql<number>`count(distinct ${dailyVisits.sessionId})::int`,
      signedInUsers: sql<number>`count(distinct ${dailyVisits.userId})::int`,
    }).from(dailyVisits).where(gte(dailyVisits.date, dayKey(since))).groupBy(dailyVisits.date).orderBy(dailyVisits.date), []),
    safe("activity windows", db.select({
      visitorToday: sql<number>`count(distinct ${dailyVisits.sessionId}) filter (where ${dailyVisits.date} >= ${dayKey(today)})::int`,
      visitor7d: sql<number>`count(distinct ${dailyVisits.sessionId}) filter (where ${dailyVisits.date} >= ${dayKey(since7)})::int`,
      visitor30d: sql<number>`count(distinct ${dailyVisits.sessionId})::int`,
      signedInToday: sql<number>`count(distinct ${dailyVisits.userId}) filter (where ${dailyVisits.date} >= ${dayKey(today)})::int`,
      signedIn7d: sql<number>`count(distinct ${dailyVisits.userId}) filter (where ${dailyVisits.date} >= ${dayKey(since7)})::int`,
      signedIn30d: sql<number>`count(distinct ${dailyVisits.userId})::int`,
    }).from(dailyVisits).where(gte(dailyVisits.date, dayKey(since30))), []),
    safe("paid orders", db.select({
      id: paymentOrders.id, userId: paymentOrders.userId, packageId: paymentOrders.packageId, packageName: paymentOrders.packageName,
      amountCents: paymentOrders.amountCents, paidAt: paymentOrders.paidAt, createdAt: paymentOrders.createdAt,
      email: user.email, name: user.name,
    }).from(paymentOrders).innerJoin(user, eq(paymentOrders.userId, user.id)).where(eq(paymentOrders.status, "paid")).orderBy(desc(paymentOrders.paidAt), desc(paymentOrders.createdAt)).limit(1000), []),
  ]);
  const daily = makeDailyWindow(days);
  const dailyMap = new Map(daily.map((item) => [item.date, item]));
  const usageByUser = new Map<string, UserUsage>();
  const actionCounts = new Map<string, number>();
  const projectOwnerById = new Map(projectOwners.map((item) => [item.id, item.userId]));

  function registerActivity(userId: string | null | undefined, createdAtValue: Date | string, kind: "action" | "upload" | "analysis" | "generation" | "project" | "clip", bytes = 0) {
    if (!userId) return;
    const createdAt = new Date(createdAtValue);
    if (Number.isNaN(createdAt.getTime())) return;
    const date = dayKey(createdAt);
    const day = dailyMap.get(date);
    const stats = touchUser(usageByUser, userId, createdAt);

    if (kind === "action") stats.actions += 1;
    if (kind === "upload") {
      stats.uploads += 1;
      stats.uploadBytes += bytes;
      if (day) {
        day.uploads += 1;
        day.uploadBytes += bytes;
      }
    }
    if (kind === "analysis" || kind === "project") {
      stats.analyses += 1;
      if (day) day.analyses += 1;
    }
    if (kind === "generation") {
      stats.generations += 1;
      if (day) day.generations += 1;
    }
    if (kind === "project") stats.projects += 1;
    if (kind === "clip") stats.clips += 1;
  }

  for (const log of recentLogs) {
    actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
    registerActivity(log.userId, log.createdAt, "action");
    if (log.action === "file.upload") {
      const metadata = log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata) ? log.metadata as Record<string, unknown> : {};
      if (metadata.phase !== "requested") {
        registerActivity(log.userId, log.createdAt, "upload", numberFromMetadata(log.metadata, "size"));
      }
    }
  }

  for (const project of recentProjects) registerActivity(project.userId, project.createdAt, "project");
  for (const item of recentAnalysisHistory) registerActivity(item.userId, item.createdAt, "analysis");
  for (const item of recentAudioAnalysis) registerActivity(item.userId, item.createdAt, "analysis");
  for (const item of recentGenerations) registerActivity(item.userId, item.createdAt, "generation");
  for (const item of recentVideoClips) registerActivity(item.userId, item.createdAt, "clip");

  for (const asset of recentProjectAssets) {
    const ownerId = asset.projectId ? projectOwnerById.get(asset.projectId) : null;
    registerActivity(ownerId, asset.createdAt, "upload", asset.size || 0);
  }

  for (const item of dailyVisitMetrics) {
    const day = dailyMap.get(item.date);
    if (day) {
      day.activeUsers = Number(item.visitors) || 0;
      day.signedInUsers = Number(item.signedInUsers) || 0;
    }
  }

  const todayMetrics = dailyMap.get(dayKey(today)) || daily[daily.length - 1];
  const uploadBytes = daily.reduce((sum, item) => sum + item.uploadBytes, 0);
  const uploadCount = daily.reduce((sum, item) => sum + item.uploads, 0);
  const analysisCount = daily.reduce((sum, item) => sum + item.analyses, 0);
  const generationCount = daily.reduce((sum, item) => sum + item.generations, 0);
  const usersById = new Map(allUsers.map((item) => [item.id, item]));
  const creditBalances = await safe("credit balances", getCreditBalancesForUsers(Array.from(usageByUser.keys())), new Map<string, number>());

  const totalUsers = totalUsersRow[0]?.count || 0;
  const purchasedUsers = purchasedUsersRow[0]?.count || 0;
  const nonPurchasedUsers = Math.max(0, totalUsers - purchasedUsers);
  const activity = activeWindowsRows[0] || { visitorToday: 0, visitor7d: 0, visitor30d: 0, signedInToday: 0, signedIn7d: 0, signedIn30d: 0 };
  const paidUsers = new Map<string, { userId: string; email: string; name: string | null; orderCount: number; totalPaidCents: number; lastPaidAt: Date; latestPackageId: string; latestPackageName: string }>();
  for (const order of recentPaidOrders) {
    const existing = paidUsers.get(order.userId);
    if (existing) {
      existing.orderCount += 1;
      existing.totalPaidCents += order.amountCents;
    } else {
      paidUsers.set(order.userId, { userId: order.userId, email: order.email, name: order.name, orderCount: 1, totalPaidCents: order.amountCents, lastPaidAt: order.paidAt || order.createdAt, latestPackageId: order.packageId, latestPackageName: order.packageName });
    }
  }

  return NextResponse.json({
    period: { days, since: since.toISOString() },
    overview: {
      totalUsers,
      newUsersToday: newUsersTodayRow[0]?.count || 0,
      newUsers7d: newUsers7dRow[0]?.count || 0,
      newUsers30d: newUsers30dRow[0]?.count || 0,
      visitorToday: Number(activity.visitorToday) || 0,
      visitor7d: Number(activity.visitor7d) || 0,
      visitor30d: Number(activity.visitor30d) || 0,
      signedInToday: Number(activity.signedInToday) || 0,
      signedIn7d: Number(activity.signedIn7d) || 0,
      signedIn30d: Number(activity.signedIn30d) || 0,
      activeToday: Number(activity.visitorToday) || todayMetrics.activeUsers,
      active7d: Number(activity.visitor7d) || 0,
      active30d: Number(activity.visitor30d) || 0,
      purchasedUsers,
      nonPurchasedUsers,
      totalProjects: totalProjectsRow[0]?.count || 0,
      totalGenerations: totalGenerationsRow[0]?.count || 0,
      totalWorkflowJobs: totalWorkflowJobsRow[0]?.count || 0,
      uploadCount,
      uploadBytes,
      analysisCount,
      generationCount,
      videoClips: recentVideoClips.length,
    },
    daily,
    actionCounts: Array.from(actionCounts.entries()).map(([action, value]) => ({ action, value })).sort((a, b) => b.value - a.value),
    topUsers: Array.from(usageByUser.values())
      .sort((a, b) => b.uploadBytes - a.uploadBytes || b.generations - a.generations || b.analyses - a.analyses || b.actions - a.actions)
      .slice(0, 30)
      .map((stats) => {
        const profile = usersById.get(stats.userId);
        return {
          ...stats,
          name: profile?.name || "Unknown user",
          email: profile?.email || null,
          role: profile?.role || null,
          banned: profile?.banned || false,
          creditBalance: creditBalances.get(stats.userId) || 0,
        };
      }),
    purchasedUsers: Array.from(paidUsers.values()).slice(0, 50),
    recentUsers: recentUsers.map((item) => ({ id: item.id, name: item.name, email: item.email, role: item.role, createdAt: item.createdAt })),
    dataHealth: { degraded: unavailable.length > 0, unavailable },
  });
  } catch (error) {
    console.error("Admin overview error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load admin overview" }, { status: 500 });
  }
}

