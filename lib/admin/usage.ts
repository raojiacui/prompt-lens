import { sql, type SQL } from "drizzle-orm";

export const ADMIN_USAGE_TABLES = ["projects", "video_generation", "workflow_jobs", "analysis_history", "audio_analysis", "video_clip", "operation_logs", "commercial_wallets", "user_credits"];

export function usageSourcesQuery() {
  return sql`select name, to_regclass('public.' || name) is not null as exists
    from unnest(array[${sql.join(ADMIN_USAGE_TABLES.map(name => sql`${name}`), sql`, `)}]::text[]) as name`;
}

export function usageEvents(available: Set<string>, since: Date): SQL {
  const sources: SQL[] = [];
  for (const [table, kind] of [["projects", "project"], ["analysis_history", "analysis"], ["audio_analysis", "analysis"], ["video_generation", "generation"], ["video_clip", "clip"]]) {
    if (available.has(table)) sources.push(sql`select user_id, created_at, ${kind}::text as kind, 0::bigint as bytes, null::text as action
      from ${sql.identifier(table)} where created_at >= ${since.toISOString()}::timestamptz`);
  }
  if (available.has("operation_logs")) {
    sources.push(sql`select user_id, created_at, 'action'::text as kind, 0::bigint as bytes, action::text
      from operation_logs where created_at >= ${since.toISOString()}::timestamptz`);
    sources.push(sql`select user_id, created_at, 'upload'::text as kind,
      case when metadata->>'size' ~ '^[0-9]{1,15}$' then (metadata->>'size')::bigint else 0 end as bytes, null::text as action
      from operation_logs where created_at >= ${since.toISOString()}::timestamptz
      and action::text = 'file.upload' and coalesce(metadata->>'phase', '') <> 'requested'`);
  }
  return sources.length ? sql.join(sources, sql` union all `) : sql`
    select null::uuid as user_id, now() as created_at, ''::text as kind, 0::bigint as bytes, null::text as action where false`;
}

export function usageStats(): SQL {
  return sql`select user_id, count(*) filter (where kind = 'action')::int as actions,
    count(*) filter (where kind = 'upload')::int as uploads, sum(bytes)::bigint as "uploadBytes",
    count(*) filter (where kind in ('analysis','project'))::int as analyses,
    count(*) filter (where kind = 'generation')::int as generations,
    count(*) filter (where kind = 'project')::int as projects, count(*) filter (where kind = 'clip')::int as clips,
    max(created_at) as "lastSeen" from events where user_id is not null group by user_id`;
}
