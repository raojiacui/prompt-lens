import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function listAnalysisHistory(userId: string, params: URLSearchParams) {
  const integer = (value: string | null, fallback: number, max: number) => {
    const number = Number(value ?? fallback);
    return Number.isSafeInteger(number) ? Math.max(1, Math.min(max, number)) : fallback;
  };
  const page = integer(params.get("page"), 1, 100_000);
  const limit = integer(params.get("limit"), 20, 100);
  const search = (params.get("search") || "").trim();
  // Treat search input as literal text, including SQL wildcard characters.
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const entries = sql`
    select h.id::text, 'legacy' as source, null::text as "projectId",
      h.media_type::text as "mediaType", h.media_name as "mediaName",
      h.core_prompt as "corePrompt", h.prompt, h.note, h.tags, h.favorite,
      h.language, h.created_at as "createdAt", 'completed' as status, 0 as "sceneCount"
    from analysis_history h where h.user_id = ${userId}
      and (${!search} or h.media_name ilike ${pattern} or h.prompt ilike ${pattern}
        or h.core_prompt ilike ${pattern} or h.note ilike ${pattern})
    union all
    select 'workflow:' || p.id::text, 'workflow', p.id::text,
      coalesce(p.metadata->>'mediaType', 'video'), p.title,
      p.description, '', null, '[]'::jsonb, false,
      coalesce(p.metadata->>'outputLanguage', 'zh'), p.created_at,
      case when p.status = 'ready' and p.metadata->>'partialAnalysis' = 'true' then 'partial' else p.status::text end,
      (select count(*)::integer from video_scenes s where s.project_id = p.id)
    from projects p where p.user_id = ${userId}
      and (${!search} or p.title ilike ${pattern} or p.description ilike ${pattern}
        or exists (select 1 from scene_versions s where s.project_id = p.id
          and s.project_version_id = coalesce(p.active_version_id,
            (select v.id from project_versions v where v.project_id = p.id order by v.version_number desc limit 1))
          and s.generation_prompt ilike ${pattern}))
  `;
  const filter = sql`(${params.get("favorite") !== "true"} or favorite = true)
    and (${!params.get("mediaType")} or "mediaType" = ${params.get("mediaType") || ""})`;
  const [history, total] = await Promise.all([
    db.execute(sql`select * from (${entries}) entries where ${filter}
      order by "createdAt" desc, id desc limit ${limit} offset ${(page - 1) * limit}`),
    db.execute(sql`select count(*)::integer as total from (${entries}) entries where ${filter}`),
  ]);
  return { history, total: Number(total[0]?.total || 0), page, limit };
}
