"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";

interface ApiKey {
  id: string;
  provider: string;
  isActive: boolean;
  createdAt: string;
  apiKey: string;
}

export function ApiKeySettings() {
  const t = useTranslations("settings");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/api-key");
      const data = await res.json();
      setApiKeys(data.apiKeys || []);
    } catch (error) {
      console.error("Failed to fetch API keys:", error);
    } finally {
      setLoading(false);
    }
  };

  const saveApiKey = async () => {
    if (!apiKey.trim()) {
      setMessage({ type: "error", text: t("apiKeyRequired") });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "kie", apiKey: apiKey.trim() }),
      });

      if (res.ok) {
        setMessage({ type: "success", text: t("saveSuccess") });
        setApiKey("");
        fetchApiKeys();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || t("saveFailed") });
      }
    } catch {
      setMessage({ type: "error", text: t("saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const deleteApiKey = async (id: string) => {
    if (!confirm(t("deleteConfirm"))) return;

    try {
      const res = await fetch(`/api/settings/api-key?id=${id}`, { method: "DELETE" });
      if (res.ok) fetchApiKeys();
    } catch (error) {
      console.error("Failed to delete API key:", error);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-[var(--color-bg-raised)] border-[var(--color-border-default)]">
        <CardHeader>
          <CardTitle style={{ fontFamily: "var(--font-display)" }}>{t("addApiKey")}</CardTitle>
          <CardDescription>{t("addDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">{t("provider")}</label>
              <div className="flex h-11 items-center rounded-xl border border-[var(--color-border-default)] bg-white px-3 text-sm font-semibold text-[var(--color-text-primary)]">
                {t("providerKie")}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">API Key</label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t("placeholderKie")}
                  className="bg-[var(--color-bg-raised)]"
                />
                <Button onClick={saveApiKey} disabled={saving} className="bg-[var(--color-accent-orange)] hover:bg-[var(--color-accent-orange-hover)]">
                  {saving ? <Spinner size="sm" /> : t("saveApiKey")}
                </Button>
              </div>
            </div>
          </div>

          {message && (
            <div
              className={`rounded-lg p-3 ${
                message.type === "success"
                  ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
                  : "bg-[var(--color-error)]/10 text-[var(--color-error)]"
              }`}
            >
              {message.text}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[var(--color-bg-raised)] border-[var(--color-border-default)]">
        <CardHeader>
          <CardTitle style={{ fontFamily: "var(--font-display)" }}>{t("savedKeys")}</CardTitle>
          <CardDescription>{t("savedDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : apiKeys.length === 0 ? (
            <p className="py-8 text-center text-[var(--color-text-muted)]">{t("noKeys")}</p>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((key) => (
                <div key={key.id} className="flex items-center justify-between rounded-xl border border-[var(--color-border-default)] bg-white p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>
                        {t("kieName")}
                      </span>
                      {key.isActive && (
                        <span className="rounded bg-[var(--color-success)]/10 px-2 py-0.5 text-xs text-[var(--color-success)]">
                          {t("active")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-sm text-[var(--color-text-secondary)]">{key.apiKey}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {t("addedAt", { date: new Date(key.createdAt).toLocaleDateString("zh-CN") })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteApiKey(key.id)}
                    className="border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
                  >
                    {t("delete")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[var(--color-bg-raised)] border-[var(--color-border-default)]">
        <CardHeader>
          <CardTitle style={{ fontFamily: "var(--font-display)" }}>{t("providerDocs")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          <div>
            <h4 className="font-medium text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>{t("trialTitle")}</h4>
            <p className="mt-2">{t("trialDesc")}</p>
          </div>
          <div>
            <h4 className="font-medium text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>{t("kieName")}</h4>
            <p className="mt-2">
              {t("kieDesc")} {" "}
              <a href="https://api.kie.ai" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent-orange)] hover:underline">
                {t("kieLink")}
              </a>{" "}
              {t("kieGetKey")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--color-border-default)] bg-white p-4">
            <h4 className="font-medium text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-heading)" }}>{t("storageTitle")}</h4>
            <p className="mt-2">{t("storageDesc")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
