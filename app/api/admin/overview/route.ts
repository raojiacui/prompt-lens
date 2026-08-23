import { NextRequest, NextResponse } from "next/server";
import { desc, eq, gte, count, countDistinct, isNotNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getCreditBalancesForUsers } from "@/lib/billing/credits";
import {
  analysisHistory,
  audioAnalysis,
  creditLedger,
  dailyVisits,
  db,
  operationLogs,
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
    return { date: dayKey(date), activeUsers: 0, uploads: 0, uploadBytes: 0, analyses: 0, generations: 0 };
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

async function requireAdmin(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const currentUser = await db.query.user.findFirst({ where: eq(user.id, session.user.id) });
  return currentUser?.role === "admin" ? currentUser : null;
}

export async function GET(request: NextRequest) {
  try {
    const adminUser = await requireAdmin(request.headers);
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

  const [
    totalUsersRow,
    newUsersRow,
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
    recentDailyVisits,
  ] = await Promise.all([
    db.select({ count: count() }).from(user),
    db.select({ count: count() }).from(user).where(gte(user.createdAt, since30)),
    db.select({ count: count() }).from(projects),
    db.select({ count: count() }).from(videoGeneration),
    db.select({ count: count() }).from(workflowJobs),
    db.select({ count: countDistinct(creditLedger.userId) }).from(creditLedger).where(isNotNull(creditLedger.packageId)),
    db.query.operationLogs.findMany({ where: gte(operationLogs.createdAt, since), orderBy: [desc(operationLogs.createdAt)], limit: 50000 }),
    db.query.projects.findMany({ where: gte(projects.createdAt, since), orderBy: [desc(projects.createdAt)], limit: 20000 }),
    db.query.videoGeneration.findMany({ where: gte(videoGeneration.createdAt, since), orderBy: [desc(videoGeneration.createdAt)], limit: 20000 }),
    db.query.analysisHistory.findMany({ where: gte(analysisHistory.createdAt, since), orderBy: [desc(analysisHistory.createdAt)], limit: 20000 }),
    db.query.audioAnalysis.findMany({ where: gte(audioAnalysis.createdAt, since), orderBy: [desc(audioAnalysis.createdAt)], limit: 20000 }),
    db.query.videoClip.findMany({ where: gte(videoClip.createdAt, since), orderBy: [desc(videoClip.createdAt)], limit: 20000 }),
    db.query.projectAssets.findMany({ where: gte(projectAssets.createdAt, since), orderBy: [desc(projectAssets.createdAt)], limit: 20000 }),
    db.query.user.findMany({ orderBy: [desc(user.createdAt)], limit: 8 }),
    db.query.user.findMany({ limit: 10000 }),
    db.query.projects.findMany({ limit: 50000 }),
    db.query.dailyVisits.findMany({ where: gte(dailyVisits.date, dayKey(since)), orderBy: [desc(dailyVisits.createdAt)], limit: 100000 }),
  ]);

  const daily = makeDailyWindow(days);
  const dailyMap = new Map(daily.map((item) => [item.date, item]));
  const dailyVisitors = new Map<string, { users: Set<string>; sessions: Set<string> }>();
  const active7d = new Set<string>();
  const active30d = new Set<string>();
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

  for (const visit of recentDailyVisits) {
    const date = visit.date;
    if (!dailyMap.has(date)) continue;

    if (!dailyVisitors.has(date)) {
      dailyVisitors.set(date, { users: new Set(), sessions: new Set() });
    }
    const visitors = dailyVisitors.get(date)!;

    if (visit.userId) {
      visitors.users.add(visit.userId);
      if (visit.createdAt >= since7) active7d.add(`user:${visit.userId}`);
      if (visit.createdAt >= since30) active30d.add(`user:${visit.userId}`);
    } else {
      visitors.sessions.add(visit.sessionId);
      if (visit.createdAt >= since7) active7d.add(`session:${visit.sessionId}`);
      if (visit.createdAt >= since30) active30d.add(`session:${visit.sessionId}`);
    }
  }

  for (const [date, { users, sessions }] of dailyVisitors) {
    const day = dailyMap.get(date);
    if (day) day.activeUsers = users.size + sessions.size;
  }

  const todayMetrics = dailyMap.get(dayKey(today)) || daily[daily.length - 1];
  const uploadBytes = daily.reduce((sum, item) => sum + item.uploadBytes, 0);
  const uploadCount = daily.reduce((sum, item) => sum + item.uploads, 0);
  const analysisCount = daily.reduce((sum, item) => sum + item.analyses, 0);
  const generationCount = daily.reduce((sum, item) => sum + item.generations, 0);
  const usersById = new Map(allUsers.map((item) => [item.id, item]));
  const creditBalances = await getCreditBalancesForUsers(Array.from(usageByUser.keys()));

  const totalUsers = totalUsersRow[0]?.count || 0;
  const purchasedUsers = purchasedUsersRow[0]?.count || 0;
  const nonPurchasedUsers = Math.max(0, totalUsers - purchasedUsers);

  return NextResponse.json({
    period: { days, since: since.toISOString() },
    overview: {
      totalUsers,
      newUsers30d: newUsersRow[0]?.count || 0,
      activeToday: todayMetrics.activeUsers,
      active7d: active7d.size,
      active30d: active30d.size,
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
    recentUsers: recentUsers.map((item) => ({ id: item.id, name: item.name, email: item.email, role: item.role, createdAt: item.createdAt })),
  });
  } catch (error) {
    console.error("Admin overview error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load admin overview" }, { status: 500 });
  }
}
