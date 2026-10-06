import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireReferenceVideoUser } from "@/lib/reference-video/auth";

export async function GET(request: Request) {
  const access = await requireReferenceVideoUser(request.headers);
  if (access.response) return access.response;
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  if (!Number.isSafeInteger(page)) return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  const limit = 20;
  const retained = process.env.NODE_ENV === "production";
  try {
    // Commercial rows include failed submissions without a provider task. Exclude their provider copies.
    const history = await db.execute(sql`
      select * from (
        select 'commercial:' || id::text as id, 'commercial:' || id::text as "taskId",
          input->'payload'->>'model' as model, input->'payload'->'input'->>'prompt' as prompt,
          input->>'durationSeconds' as duration, input->>'resolution' as resolution,
          state as status, result->>'videoUrl' as "videoUrl", result->>'error' as error,
          'platform' as payer,
          coalesce((result->>'chargedCredits')::integer, case when state = 'failed' then 0 else credits end) as credits,
          created_at as "createdAt"
        from commercial_tasks where user_id = ${access.user.id} and kind = 'generation'
          and state <> 'quoted' and coalesce(input->>'retentionExpired', 'false') <> 'true'
          and (${!retained} or created_at > now() - interval '7 days' or state in ('queued','running','review'))
        union all
        select id::text, task_id, model, prompt, duration::text, resolution, status,
          video_url, error, 'byok', 0, created_at
        from video_generation where user_id = ${access.user.id}
          and coalesce(raw_response->'billing'->>'commercialTaskId', '') = ''
          and (${!retained} or created_at > now() - interval '7 days' or status in ('pending','queued','processing','running'))
      ) entries order by "createdAt" desc, id desc limit ${limit + 1} offset ${(page - 1) * limit}
    `);
    return NextResponse.json({ history: history.slice(0, limit), page, hasMore: history.length > limit, retentionDays: retained ? 7 : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load generation history" }, { status: 500 });
  }
}
