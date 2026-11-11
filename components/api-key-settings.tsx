"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowUpRight, Check, KeyRound, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { INFISTAR_REGISTRATION_URL, MODEL_VERIFICATION_URL, USER_PROVIDERS, type UserProvider } from "@/lib/ai/providers";

type ApiKey = { id: string; provider: UserProvider; isActive: boolean; apiKey: string; decryptError?: boolean };
type Notice = { type: "success" | "error"; text: string };

export function ApiKeySettings() {
  const t = useTranslations("settings");
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [preferred, setPreferred] = useState<UserProvider | null>(null);
  const [drafts, setDrafts] = useState<Record<UserProvider, string>>({ infistar: "", kie: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Partial<Record<UserProvider | "global", Notice>>>({});
  const notify = (provider: UserProvider | "global", notice: Notice) => setNotices(value => ({ ...value, [provider]: notice }));
  async function refresh() {
    const response = await fetch("/api/settings/api-key", { cache: "no-store" });
    if (!response.ok) throw new Error(t("loadFailed"));
    const body = await response.json();
    setKeys(body.apiKeys || []); setPreferred(body.preferredProvider || null);
  }
  useEffect(() => {
    void refresh().catch(() => notify("global", { type: "error", text: t("loadFailed") })).finally(() => setLoading(false));
    // Configuration is loaded when the settings panel mounts.
  }, []);
  async function action(provider: UserProvider, kind: "save" | "prefer" | "test" | "delete", id?: string) {
    const apiKey = drafts[provider].trim();
    if (kind === "save" && !apiKey) { notify(provider, { type: "error", text: t("apiKeyRequired") }); return; }
    if (kind === "delete" && !window.confirm(t("deleteConfirm"))) return;
    setBusy(`${provider}:${kind}`); setNotices(value => ({ ...value, [provider]: undefined }));
    try {
      const response = await fetch(kind === "test" ? "/api/settings/api-key/test" : `/api/settings/api-key${kind === "delete" ? `?id=${encodeURIComponent(id!)}` : ""}`, {
        method: kind === "delete" ? "DELETE" : kind === "prefer" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(kind === "delete" ? {} : { body: JSON.stringify({ provider, ...(kind === "save" || kind === "test" ? { apiKey: apiKey || undefined } : {}) }) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("saveFailed"));
      if (kind !== "test") {
        if (kind === "save") setDrafts(value => ({ ...value, [provider]: "" }));
        await refresh(); window.dispatchEvent(new Event("promptlens:provider-change"));
      }
      notify(provider, { type: "success", text: t(kind === "test" ? "testSuccess" : kind === "prefer" ? "preferenceSaved" : kind === "delete" ? "deleted" : "saveSuccess") });
    } catch (error) { notify(provider, { type: "error", text: error instanceof Error ? error.message : t("saveFailed") }); }
    finally { setBusy(null); }
  }
  return <div className="space-y-6">
    <div className="max-w-2xl"><h2 className="text-xl font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>{t("apiKey")}</h2><p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{t("addDesc")}</p></div>
    {notices.global && <p role="alert" className="text-sm text-[var(--color-error)]">{notices.global.text}</p>}
    {USER_PROVIDERS.map(provider => {
      const saved = keys.filter(key => key.provider === provider);
      const key = saved[0]; const current = preferred === provider;
      const name = provider === "infistar" ? "无限星河 Infistar" : "KIE";
      const notice = notices[provider];
      return <Card key={provider} className={`overflow-hidden bg-[var(--color-bg-raised)] ${provider === "infistar" ? "border-[var(--color-accent-orange)]/35" : "border-[var(--color-border-default)]"}`}>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3"><Image src={provider === "infistar" ? "/partners/infistar-logo.jpg" : "/partners/kie-logo.png"} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl object-contain" /><CardTitle className="text-lg" style={{ fontFamily: "var(--font-heading)" }}>{name}</CardTitle>{provider === "infistar" && <span className="rounded-md bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800">{t("recommended")}</span>}</div>
            {current && <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-success)]"><Check size={14} />{t("preferred")}</span>}
          </div>
          <CardDescription className="leading-6">{t(provider === "infistar" ? "infistarDesc" : "kieDesc")}</CardDescription>
          <a href={provider === "infistar" ? INFISTAR_REGISTRATION_URL : "https://kie.ai/"} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-[var(--color-accent-orange)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">{t(provider === "infistar" ? "infistarRegister" : "kieGetKeyLink")}<ArrowUpRight size={15} /></a>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Spinner size="sm" />{t("loadingKeys")}</div> : key && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-base)] px-4 py-3">
            <div className="flex items-center gap-2 text-sm"><KeyRound size={16} className="text-[var(--color-text-muted)]" /><span className="font-mono">{key.apiKey}</span>{key.decryptError && <span className="text-xs text-[var(--color-error)]">{t("resaveRequired")}</span>}</div>
            <div className="flex flex-wrap gap-2">{!current && !key.decryptError && <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void action(provider, "prefer")}>{t("setPreferred")}</Button>}{saved.map(record => <Button key={record.id} size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void action(provider, "delete", record.id)} aria-label={`${t("delete")} ${name} ${record.apiKey}`}>{t("delete")}</Button>)}</div>
          </div>}
          <label htmlFor={`key-${provider}`} className="block text-sm font-medium text-[var(--color-text-primary)]">{key ? t("replaceKey") : t("enterApiKey")}</label>
          <div className="flex flex-col gap-2 sm:flex-row"><Input id={`key-${provider}`} type="password" autoComplete="off" spellCheck={false} value={drafts[provider]} onChange={event => setDrafts(value => ({ ...value, [provider]: event.target.value }))} placeholder={t(provider === "infistar" ? "placeholderInfistar" : "placeholderKie")} disabled={loading || Boolean(busy)} className="min-w-0 flex-1 bg-[var(--color-bg-base)]" /><div className="flex gap-2"><Button variant="outline" className="flex-1 sm:flex-none" disabled={loading || Boolean(busy) || (!drafts[provider].trim() && (!key || key.decryptError))} onClick={() => void action(provider, "test")}>{busy === `${provider}:test` ? <Spinner size="sm" /> : t("testConnection")}</Button><Button className="flex-1 bg-[var(--color-accent-orange)] hover:bg-[var(--color-accent-orange-hover)] sm:flex-none" disabled={loading || Boolean(busy) || !drafts[provider].trim()} onClick={() => void action(provider, "save")}>{busy === `${provider}:save` ? <Spinner size="sm" /> : t("saveApiKey")}</Button></div></div>
          {notice && <p role={notice.type === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${notice.type === "error" ? "bg-[var(--color-error)]/10 text-[var(--color-error)]" : "bg-[var(--color-success)]/10 text-[var(--color-success)]"}`}>{notice.text}</p>}
        </CardContent>
      </Card>;
    })}
    <a href={MODEL_VERIFICATION_URL} target="_blank" rel="noopener noreferrer" className="group flex items-start justify-between gap-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-raised)] p-5 transition-colors hover:border-[var(--color-accent-orange)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"><div className="flex gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-[var(--color-accent-orange)]" size={22} /><div><h3 className="font-medium text-[var(--color-text-primary)]">{t("verificationTitle")}</h3><p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{t("verificationDesc")}</p><p className="mt-2 text-xs text-[var(--color-text-muted)]">{t("verificationPrivacy")}</p></div></div><ArrowUpRight aria-hidden="true" size={18} className="shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-orange)]" /></a>
    <Card className="border-[var(--color-border-default)] bg-[var(--color-bg-raised)]"><CardHeader><CardTitle className="text-base">{t("providerDocs")}</CardTitle></CardHeader><CardContent className="space-y-5 text-sm leading-6 text-[var(--color-text-secondary)]">{["routing", "trial", "storage"].map(section => <div key={section}><h3 className="font-medium text-[var(--color-text-primary)]">{t(`${section}Title`)}</h3><p className="mt-1">{t(`${section}Desc`)}</p></div>)}</CardContent></Card>
  </div>;
}
