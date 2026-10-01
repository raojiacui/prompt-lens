import { NextRequest, NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { getAdminUserFromHeaders } from "@/lib/auth";
import { adminQuery } from "@/lib/admin/query";

const DAY_MS = 86_400_000;
const privateHeaders = { "Cache-Control": "private, no-store" };
const tables = ["projects", "video_generation", "workflow_jobs", "analysis_history", "audio_analysis", "video_clip", "operation_logs", "commercial_wallets", "user_credits"];
type Metric = { date: string; activeUsers: number; signedInUsers: number; uploads: number; uploadBytes: number; analyses: number; generations: number };
type Usage = { userId: string; actions: number; uploads: number; uploadBytes: number; analyses: number; generations: number; projects: number; clips: number; lastSeen: string; name: string; email: string; role: string; banned: boolean; creditBalance: number };
type PaidUser = { userId: string; email: string; name: string; orderCount: number; totalPaidCents: number; lastPaidAt: string; latestPackageId: string; latestPackageName: string };
type RecentUser = { id: string; email: string; name: string; role: string; createdAt: string };
type Payload = Awaited<ReturnType<typeof loadOverview>>;
const cache = new Map<number, { expires: number; data: Payload }>();
const pending = new Map<number, Promise<Payload>>();

async function loadOverview(days: number, summary = false) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const since = new Date(today.getTime() - (days - 1) * DAY_MS);
  const since7 = new Date(today.getTime() - 6 * DAY_MS);
  const since30 = new Date(today.getTime() - 29 * DAY_MS);
  const key = (value: Date) => value.toISOString().slice(0, 10);
  const unavailable: string[] = [];
  async function safe<T>(label: string, query: SQL, fallback: T[]): Promise<T[]> {
    try { return await adminQuery<T>(query); }
    catch (error) {
      unavailable.push(label);
      console.error(`[admin] ${label} query failed`, error);
      return fallback;
    }
  }
  const discovered = await safe<{ name: string; exists: boolean }>("data sources", sql`
    select name, to_regclass('public.' || name) is not null as exists
    from unnest(array[${sql.join(tables.map(name => sql`${name}`), sql`, `)}]::text[]) as name`, []);
  const available = new Set(discovered.filter(row => row.exists).map(row => row.name));
  for (const table of tables) if (!available.has(table)) unavailable.push(table);

  // Fixed sources only: full prompts, transcripts and provider responses never leave the database.
  const sources: SQL[] = [];
  for (const [table, kind] of [["projects", "project"], ["analysis_history", "analysis"], ["audio_analysis", "analysis"], ["video_generation", "generation"], ["video_clip", "clip"]]) {
    if (available.has(table)) sources.push(sql`select user_id, created_at, ${kind}::text as kind, 0::bigint as bytes, null::text as action
      from ${sql.identifier(table)} where created_at >= ${since.toISOString()}::timestamptz`);
  }
  if (available.has("operation_logs")) {
    sources.push(sql`select user_id, created_at, 'action'::text as kind, 0::bigint as bytes, action::text
      from operation_logs where created_at >= ${since.toISOString()}::timestamptz`);
    // Assets also include generated outputs. Count uploads once using completed upload events.
    sources.push(sql`select user_id, created_at, 'upload'::text as kind,
      case when metadata->>'size' ~ '^[0-9]{1,15}$' then (metadata->>'size')::bigint else 0 end as bytes, null::text as action
      from operation_logs where created_at >= ${since.toISOString()}::timestamptz
      and action::text = 'file.upload' and coalesce(metadata->>'phase', '') <> 'requested'`);
  }
  const activity = sources.length ? sql.join(sources, sql` union all `) : sql`
    select null::uuid as user_id, now() as created_at, ''::text as kind, 0::bigint as bytes, null::text as action where false`;
  const totals = (table: string) => available.has(table) ? sql`(select count(*)::int from ${sql.identifier(table)})` : sql`0`;
  const balances = available.has("commercial_wallets") ? sql`left join commercial_wallets w on w.user_id = s.user_id`
    : available.has("user_credits") ? sql`left join user_credits w on w.user_id = s.user_id` : sql``;
  const balance = available.has("commercial_wallets") ? sql`coalesce(w.credits, 0)`
    : available.has("user_credits") ? sql`coalesce(w.balance, 0)` : sql`0`;

  const [users, visits, payments, usage] = await Promise.all([
    safe<{ totalUsers: number; newUsersToday: number; newUsers7d: number; newUsers30d: number; recentUsers: RecentUser[] }>("users", sql`
      select count(*)::int as "totalUsers",
        count(*) filter (where created_at >= ${today.toISOString()}::timestamptz)::int as "newUsersToday",
        count(*) filter (where created_at >= ${since7.toISOString()}::timestamptz)::int as "newUsers7d",
        count(*) filter (where created_at >= ${since30.toISOString()}::timestamptz)::int as "newUsers30d",
        ${summary ? sql`'[]'::jsonb` : sql`(select coalesce(jsonb_agg(r), '[]') from (select id, email, name, role, created_at as "createdAt" from "user" order by created_at desc limit 20) r)`} as "recentUsers"
      from "user"`, []),
    safe<{ visitorToday: number; visitor7d: number; visitor30d: number; signedInToday: number; signedIn7d: number; signedIn30d: number; daily: Metric[] }>("activity windows", sql`
      select count(distinct session_id) filter (where date >= ${key(today)})::int as "visitorToday",
        count(distinct session_id) filter (where date >= ${key(since7)})::int as "visitor7d",
        count(distinct session_id) filter (where date >= ${key(since30)})::int as "visitor30d",
        count(distinct user_id) filter (where date >= ${key(today)})::int as "signedInToday",
        count(distinct user_id) filter (where date >= ${key(since7)})::int as "signedIn7d",
        count(distinct user_id) filter (where date >= ${key(since30)})::int as "signedIn30d",
        (select coalesce(jsonb_agg(d), '[]') from (select date, count(distinct session_id)::int as "activeUsers", count(distinct user_id)::int as "signedInUsers"
          from daily_visits where date >= ${key(since)} group by date) d) as daily
      from daily_visits where date >= ${key(since < since30 ? since : since30)}`, []),
    safe<{ purchasedUsers: number; paidUsers: PaidUser[] }>("paid orders", sql`
      with paid as (select user_id, count(*)::int as "orderCount", sum(amount_cents)::bigint as "totalPaidCents",
        max(coalesce(paid_at, created_at)) as "lastPaidAt",
        (array_agg(package_id order by coalesce(paid_at, created_at) desc, id desc))[1] as "latestPackageId",
        (array_agg(package_name order by coalesce(paid_at, created_at) desc, id desc))[1] as "latestPackageName"
        from payment_orders where status = 'paid' group by user_id)
      select count(*)::int as "purchasedUsers", ${summary ? sql`'[]'::jsonb` : sql`(select coalesce(jsonb_agg(p), '[]') from
        (select paid.user_id as "userId", u.email, u.name, paid."orderCount", paid."totalPaidCents", paid."lastPaidAt", paid."latestPackageId", paid."latestPackageName"
          from paid join "user" u on u.id = paid.user_id order by paid."lastPaidAt" desc limit 50) p)`} as "paidUsers" from paid`, []),
    safe<{ daily: Metric[]; topUsers: Usage[]; actionCounts: { action: string; value: number }[]; totalProjects: number; totalGenerations: number; totalWorkflowJobs: number; videoClips: number }>("product usage", sql`
      with events as materialized (${activity}), stats as (
        select user_id, count(*) filter (where kind = 'action')::int as actions,
          count(*) filter (where kind = 'upload')::int as uploads, sum(bytes)::bigint as "uploadBytes",
          count(*) filter (where kind in ('analysis','project'))::int as analyses,
          count(*) filter (where kind = 'generation')::int as generations,
          count(*) filter (where kind = 'project')::int as projects, count(*) filter (where kind = 'clip')::int as clips,
          max(created_at) as "lastSeen" from events where user_id is not null group by user_id
          order by "uploadBytes" desc, generations desc, analyses desc, actions desc limit 30)
      select ${totals("projects")} as "totalProjects", ${totals("video_generation")} as "totalGenerations", ${totals("workflow_jobs")} as "totalWorkflowJobs",
        (select count(*)::int from events where kind = 'clip') as "videoClips",
        (select coalesce(jsonb_agg(d), '[]') from (select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as date,
          count(*) filter (where kind = 'upload')::int as uploads, sum(bytes)::bigint as "uploadBytes",
          count(*) filter (where kind in ('analysis','project'))::int as analyses,
          count(*) filter (where kind = 'generation')::int as generations from events group by 1) d) as daily,
        ${summary ? sql`'[]'::jsonb` : sql`(select coalesce(jsonb_agg(t), '[]') from (select s.user_id as "userId", s.actions, s.uploads, s."uploadBytes", s.analyses, s.generations, s.projects, s.clips, s."lastSeen",
          u.name, u.email, u.role, coalesce(u.banned,false) as banned, ${balance} as "creditBalance"
          from stats s join "user" u on u.id = s.user_id ${balances} order by s."uploadBytes" desc, s.generations desc, s.analyses desc, s.actions desc) t)`} as "topUsers",
        (select coalesce(jsonb_agg(a), '[]') from (select action, count(*)::int as value from events where kind = 'action' group by action order by value desc) a) as "actionCounts"`, []),
  ]);
  const u = users[0]; const v = visits[0]; const p = payments[0]; const s = usage[0];
  const daily = Array.from({ length: days }, (_, i): Metric => {
    const date = key(new Date(since.getTime() + i * DAY_MS));
    return { date, activeUsers: 0, signedInUsers: 0, uploads: 0, uploadBytes: 0, analyses: 0, generations: 0,
      ...v?.daily.find(row => row.date === date), ...s?.daily.find(row => row.date === date) };
  });
  return {
    period: { days, since: since.toISOString() },
    overview: { totalUsers: u?.totalUsers || 0, newUsersToday: u?.newUsersToday || 0, newUsers7d: u?.newUsers7d || 0, newUsers30d: u?.newUsers30d || 0,
      visitorToday: v?.visitorToday || 0, visitor7d: v?.visitor7d || 0, visitor30d: v?.visitor30d || 0,
      signedInToday: v?.signedInToday || 0, signedIn7d: v?.signedIn7d || 0, signedIn30d: v?.signedIn30d || 0,
      activeToday: v?.visitorToday || 0, active7d: v?.visitor7d || 0, active30d: v?.visitor30d || 0,
      purchasedUsers: p?.purchasedUsers || 0, nonPurchasedUsers: Math.max(0, (u?.totalUsers || 0) - (p?.purchasedUsers || 0)),
      totalProjects: s?.totalProjects || 0, totalGenerations: s?.totalGenerations || 0, totalWorkflowJobs: s?.totalWorkflowJobs || 0, videoClips: s?.videoClips || 0,
      uploadCount: daily.reduce((sum, row) => sum + row.uploads, 0), uploadBytes: daily.reduce((sum, row) => sum + row.uploadBytes, 0),
      analysisCount: daily.reduce((sum, row) => sum + row.analyses, 0), generationCount: daily.reduce((sum, row) => sum + row.generations, 0) },
    daily, topUsers: s?.topUsers || [], actionCounts: s?.actionCounts || [], purchasedUsers: p?.paidUsers || [], recentUsers: u?.recentUsers || [],
    dataHealth: { degraded: unavailable.length > 0, unavailable },
  };
}

export async function GET(request: NextRequest) {
  try {
    if (!await getAdminUserFromHeaders(request.headers)) return NextResponse.json({ error: "Admin access required" }, { status: 403, headers: privateHeaders });
    if (request.nextUrl.searchParams.get("probe") === "1") return NextResponse.json({ ok: true }, { headers: privateHeaders });
    const input = Number(request.nextUrl.searchParams.get("days") || 14);
    const days = Number.isFinite(input) ? Math.max(7, Math.min(60, Math.round(input))) : 14;
    const summary = request.nextUrl.searchParams.get("summary") === "1";
    const cacheKey = days * 2 + Number(summary);
    const saved = cache.get(cacheKey);
    if (saved && saved.expires > Date.now()) return NextResponse.json(saved.data, { headers: privateHeaders });
    let task = pending.get(cacheKey);
    if (!task) {
      task = loadOverview(days, summary).then(data => {
        if (!data.dataHealth.degraded) cache.set(cacheKey, { expires: Date.now() + 20_000, data });
        return data;
      }).finally(() => pending.delete(cacheKey));
      pending.set(cacheKey, task);
    }
    return NextResponse.json(await task, { headers: privateHeaders });
  } catch (error) {
    console.error("Admin overview error:", error);
    return NextResponse.json({ error: "后台统计暂不可用，请重试" }, { status: 503, headers: privateHeaders });
  }
}
