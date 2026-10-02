import { sql } from "drizzle-orm";
import { adminQuery } from "@/lib/admin/query";
import { queryCreditAccounts } from "./credit-audit";
import { ADMIN_USAGE_TABLES, usageEvents, usageSourcesQuery, usageStats } from "@/lib/admin/usage";
import type { AdminDirectoryUser, AdminUserPage, AdminUserView } from "@/lib/admin/user-directory-types";

export async function queryUserDirectory(params: { view: AdminUserView; query: string; page: number; limit: number }): Promise<AdminUserPage> {
  const { view, query, page, limit } = params;
  const offset = (page - 1) * limit;
  const pattern = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const matches = query ? sql`(u.email ilike ${pattern} or u.name ilike ${pattern})` : sql`true`;
  const unavailable: string[] = [];
  let users: AdminDirectoryUser[] = [];
  let total = 0;

  if (view === "credits") {
    const result = await queryCreditAccounts(matches, limit, offset);
    users = result.users;
    total = result.total;
  } else if (view === "all") {
    const [rows, counts] = await Promise.all([
      adminQuery<AdminDirectoryUser>(sql`
        with selected as (select u.* from "user" u where ${matches} order by u.created_at desc, u.id desc limit ${limit} offset ${offset}),
        analyses as (select user_id, count(*)::int as total from analysis_history where user_id in (select id from selected) group by user_id)
        select s.id, s.email, s.name, s.image, s.role, s.email_verified as "emailVerified", s.is_anonymous as "isAnonymous",
          s.banned, s.ban_reason as "banReason", s.ban_expires as "banExpires", s.created_at as "createdAt", s.updated_at as "updatedAt",
          coalesce(a.total, 0) as "analysisCount" from selected s left join analyses a on a.user_id = s.id order by s.created_at desc, s.id desc`),
      adminQuery<{ count: number }>(sql`select count(*)::int as count from "user" u where ${matches}`),
    ]);
    users = rows;
    total = counts[0]?.count || 0;
  } else if (view === "paid") {
    const [result] = await adminQuery<{ users: AdminDirectoryUser[]; total: number }>(sql`
      with paid as (
        select o.user_id, count(*)::int as "orderCount", sum(o.amount_cents)::bigint as "totalPaidCents",
          max(coalesce(o.paid_at, o.created_at)) as "lastPaidAt",
          (array_agg(o.package_name order by coalesce(o.paid_at, o.created_at) desc, o.id desc))[1] as "latestPackageName"
        from payment_orders o join "user" u on u.id = o.user_id
        where o.status = 'paid' and ${matches} group by o.user_id
      ), selected as (
        select u.id, u.email, u.name, u.role, u.banned, p."orderCount", p."totalPaidCents", p."lastPaidAt", p."latestPackageName"
        from paid p join "user" u on u.id = p.user_id order by p."lastPaidAt" desc, u.id desc limit ${limit} offset ${offset}
      ) select (select count(*)::int from paid) as total, coalesce(jsonb_agg(s order by s."lastPaidAt" desc, s.id desc), '[]') as users from selected s`);
    users = result?.users || [];
    total = result?.total || 0;
  } else {
    const discovered = await adminQuery<{ name: string; exists: boolean }>(usageSourcesQuery());
    const available = new Set(discovered.filter(row => row.exists).map(row => row.name));
    for (const table of ADMIN_USAGE_TABLES) if (!available.has(table)) unavailable.push(table);
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 13);
    const balances = available.has("commercial_wallets") ? sql`left join commercial_wallets w on w.user_id = s.user_id`
      : available.has("user_credits") ? sql`left join user_credits w on w.user_id = s.user_id` : sql``;
    const balance = available.has("commercial_wallets") ? sql`coalesce(w.credits, 0)`
      : available.has("user_credits") ? sql`coalesce(w.balance, 0)` : sql`0`;
    const [result] = await adminQuery<{ users: AdminDirectoryUser[]; total: number }>(sql`
      with events as (${usageEvents(available, since)}), stats as (${usageStats()}),
      matched as (select s.* from stats s join "user" u on u.id = s.user_id where ${matches}),
      selected as (select * from matched order by "uploadBytes" desc, generations desc, analyses desc, actions desc, user_id desc limit ${limit} offset ${offset}),
      profiles as (select u.id, u.email, u.name, u.role, u.banned, s.actions, s.uploads, s."uploadBytes", s.analyses, s.generations,
        s.projects, s.clips, s."lastSeen", ${balance} as "creditBalance" from selected s join "user" u on u.id = s.user_id ${balances})
      select (select count(*)::int from matched) as total,
        coalesce(jsonb_agg(p order by p."uploadBytes" desc, p.generations desc, p.analyses desc, p.actions desc, p.id desc), '[]') as users from profiles p`);
    users = result?.users || [];
    total = result?.total || 0;
  }
  return { users, total, page, limit, view, query, dataHealth: { degraded: unavailable.length > 0, unavailable } };
}
