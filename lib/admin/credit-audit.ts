import { sql } from "drizzle-orm";
import { adminQuery } from "./query";
import type { AdminDirectoryUser, AdminFinancialEntry, AdminFinancialPage } from "./user-directory-types";

export async function queryCreditAccounts(matches: ReturnType<typeof sql>, limit: number, offset: number) {
  const [result] = await adminQuery<{ users: AdminDirectoryUser[]; total: number }>(sql`
    with balances as (
      select u.id, u.email, u.name, u.role, u.banned,
        coalesce(c.balance,0) as "legacyBalance", coalesce(w.credits,0) as "commercialBalance",
        coalesce(w.held_credits,0) as "heldCredits",
        coalesce(c.balance,0)::bigint + coalesce(w.credits,0) as "creditBalance"
      from "user" u left join user_credits c on c.user_id=u.id left join commercial_wallets w on w.user_id=u.id
      where ${matches} and (coalesce(c.balance,0)>0 or coalesce(w.credits,0)>0 or coalesce(w.held_credits,0)>0)
    ), selected as (select * from balances order by "creditBalance" desc, id desc limit ${limit} offset ${offset}),
    legacy as (
      select l.user_id, sum(l.amount)::bigint as balance,
        coalesce(sum(l.amount) filter(where l.amount>0 and l.type in ('manual_grant','admin_adjustment')),0)::bigint as manual,
        coalesce(sum(l.amount) filter(where l.amount>0 and not coalesce((
          (l.type='payment_grant' and exists(select 1 from payment_orders o where o.user_id=l.user_id
            and o.status in ('paid','refunded') and o.provider::text=l.payment_provider
            and o.provider_order_id=l.payment_reference and o.credits=l.amount and o.package_id=l.package_id))
          or (l.type in ('manual_grant','admin_adjustment') and exists(select 1 from "user" a where a.id=l.actor_user_id
            and lower(a.email)='raojiacui@gmail.com' and a.email_verified and not a.is_anonymous))
          or (l.type='admin_adjustment' and l.metadata->>'taskId' is not null and exists(select 1 from credit_ledger prior
            where prior.user_id=l.user_id and prior.amount<0 and prior.metadata->>'taskId'=l.metadata->>'taskId'
            and -prior.amount>=l.amount))
        ),false)),0)::bigint as unverified
      from credit_ledger l where l.user_id in (select id from selected) group by l.user_id
    ), commercial as (
      select l.user_id, sum(l.credits)::bigint as balance,
        coalesce(sum(l.credits) filter(where l.credits>0 and not coalesce((
          (l.event_key like 'purchase:%' and exists(select 1 from payment_orders o where o.user_id=l.user_id
            and o.status in ('paid','refunded') and l.event_key='purchase:'||o.id::text and o.credits=l.credits
            and o.id::text=l.metadata->>'orderId'))
          or (l.event_key='refund-reject:'||(l.metadata->>'refundId') and exists(select 1 from commercial_ledger prior
            where prior.user_id=l.user_id and prior.event_key='refund-hold:'||(l.metadata->>'refundId') and -prior.credits=l.credits))
        ),false)),0)::bigint as unverified
      from commercial_ledger l where l.user_id in (select id from selected) group by l.user_id
    ), paid as (
      select user_id, count(*)::int as "orderCount", coalesce(sum(amount_cents) filter(where upper(currency)='CNY'),0)::bigint as "totalPaidCents",
        max(coalesce(paid_at,created_at)) as "lastPaidAt"
      from payment_orders where status='paid' and user_id in (select id from selected) group by user_id
    ), audited as (
      select s.*, coalesce(p."orderCount",0) as "orderCount", coalesce(p."totalPaidCents",0) as "totalPaidCents", p."lastPaidAt",
        coalesce(l.balance,0)+coalesce(c.balance,0) as "ledgerBalance", coalesce(l.manual,0) as "manualCredits",
        coalesce(l.unverified,0)+coalesce(c.unverified,0) as "unverifiedCredits",
        case when s."legacyBalance"<>coalesce(l.balance,0) or s."commercialBalance"::bigint+s."heldCredits"<>coalesce(c.balance,0) then 'balance_mismatch'
          when coalesce(l.unverified,0)+coalesce(c.unverified,0)>0 then 'unverified_source'
          when coalesce(l.manual,0)>0 then 'manual_grant' else 'ledger_consistent' end as "auditStatus"
      from selected s left join legacy l on l.user_id=s.id left join commercial c on c.user_id=s.id left join paid p on p.user_id=s.id
    ) select (select count(*)::int from balances) as total,
      coalesce(jsonb_agg(a order by a."creditBalance" desc,a.id desc),'[]') as users from audited a`);
  return { users: result?.users || [], total: result?.total || 0 };
}

export async function queryFinancialEntries(userId: string, kind: "orders" | "ledger", page: number, limit: number): Promise<AdminFinancialPage> {
  const source = kind === "orders" ? sql`
    select id,'order' as kind,created_at as "createdAt",status::text,package_name as "packageName",provider::text,
      provider_order_id as reference,amount_cents as "amountCents",currency,credits,null::text as note,null::text as "actorEmail",
      paid_at as "paidAt",coalesce(raw_payload->>'trade_no',raw_payload->>'tradeNo') as "tradeReference"
    from payment_orders where user_id=${userId}` : sql`
    select l.id,'legacy' as kind,l.created_at as "createdAt",l.type::text as status,null::text as "packageName",l.payment_provider as provider,
      l.payment_reference as reference,null::integer as "amountCents",null::text as currency,l.amount as credits,l.note,a.email as "actorEmail",
      null::timestamptz as "paidAt",null::text as "tradeReference"
    from credit_ledger l left join "user" a on a.id=l.actor_user_id where l.user_id=${userId}
    union all
    select id,'commercial' as kind,created_at as "createdAt",event_key as status,null::text as "packageName",null::text as provider,
      metadata->>'orderId' as reference,null::integer as "amountCents",null::text as currency,credits,null::text as note,null::text as "actorEmail",
      null::timestamptz as "paidAt",null::text as "tradeReference"
    from commercial_ledger where user_id=${userId}`;
  const [result] = await adminQuery<{ entries: AdminFinancialEntry[]; total: number }>(sql`
    with entries as (${source}), selected as (select * from entries order by "createdAt" desc,id desc limit ${limit} offset ${(page-1)*limit})
    select (select count(*)::int from entries) as total,coalesce(jsonb_agg(s order by s."createdAt" desc,s.id desc),'[]') as entries from selected s`);
  return { entries: result?.entries || [], total: result?.total || 0, page, limit };
}
