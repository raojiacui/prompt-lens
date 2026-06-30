"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  const [provider, setProvider] = useState("openrouter");
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
        body: JSON.stringify({ provider, apiKey: apiKey.trim() }),
      });

      if (res.ok) {
        setMessage({ type: "success", text: t("saveSuccess") });
        setApiKey("");
        fetchApiKeys();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || t("saveFailed") });
      }
    } catch (error) {
      setMessage({ type: "error", text: t("saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const deleteApiKey = async (id: string) => {
    if (!confirm(t("deleteConfirm"))) return;

    try {
      const res = await fetch(`/api/settings/api-key?id=${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchApiKeys();
      }
    } catch (error) {
      console.error("Failed to delete API key:", error);
    }
  };

  const providerLabel = (p: string) => {
    if (p === "zhipu") return t("zhipuName");
    if (p === "gemini") return t("geminiName");
    if (p === "kie") return t("kieName");
    return t("openrouterName");
  };

  return (
    <div className="space-y-6">
      {/* 添加 API Key */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC]">
        <CardHeader>
          <CardTitle style={{ fontFamily: 'var(--font-display)' }}>{t("addApiKey")}</CardTitle>
          <CardDescription>
            {t("addDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-[#141413] block mb-2">{t("provider")}</label>
              <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="bg-white">
                <option value="zhipu">{t("providerZhipuAnalyze")}</option>
                <option value="gemini">{t("providerGeminiAnalyze")}</option>
                <option value="openrouter">{t("providerOpenrouterAnalyze")}</option>
                <option value="kie">{t("providerKie")}</option>
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-[#141413] block mb-2">API Key</label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    provider === "zhipu"
                      ? t("placeholderZhipu")
                      : provider === "gemini"
                      ? t("placeholderGemini")
                      : t("placeholderOpenrouter")
                  }
                  className="bg-white"
                />
                <Button onClick={saveApiKey} disabled={saving} className="bg-[#D97757] hover:bg-[#C96848]">
                  {saving ? <Spinner size="sm" /> : t("saveApiKey")}
                </Button>
              </div>
            </div>
          </div>

          {message && (
            <div
              className={`p-3 rounded-lg ${
                message.type === "success"
                  ? "bg-[#5B8C5A]/10 text-[#5B8C5A]"
                  : "bg-[#C0453A]/10 text-[#C0453A]"
              }`}
            >
              {message.text}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 已保存的 API Key */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC]">
        <CardHeader>
          <CardTitle style={{ fontFamily: 'var(--font-display)' }}>{t("savedKeys")}</CardTitle>
          <CardDescription>{t("savedDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : apiKeys.length === 0 ? (
            <p className="text-center text-[#9C9890] py-8">
              {t("noKeys")}
            </p>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-4 border border-[#D8D5CC] rounded-xl bg-white"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>
                        {providerLabel(key.provider)}
                      </span>
                      {key.isActive && (
                        <span className="text-xs bg-[#5B8C5A]/10 text-[#5B8C5A] px-2 py-0.5 rounded">
                          {t("active")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[#6B6860] mt-1 font-mono">{key.apiKey}</p>
                    <p className="text-xs text-[#9C9890] mt-1">
                      {t("addedAt", { date: new Date(key.createdAt).toLocaleDateString("zh-CN") })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteApiKey(key.id)}
                    className="border-[#C8C4BC] text-[#6B6860] hover:text-[#C0453A] hover:border-[#C0453A]"
                  >
                    {t("delete")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* API 提供商说明 */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC]">
        <CardHeader>
          <CardTitle style={{ fontFamily: 'var(--font-display)' }}>{t("providerDocs")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>{t("zhipuRecommended")}</h4>
            <p className="text-sm text-[#6B6860] mt-2 leading-relaxed">
              {t("zhipuDesc")}{" "}
              <a
                href="https://open.bigmodel.cn/usercenter/apikeys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D97757] hover:underline"
              >
                {t("zhipuLink")}
              </a>{" "}
              {t("zhipuGetKey")}
            </p>
          </div>
          <div>
            <h4 className="font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>{t("geminiName")}</h4>
            <p className="text-sm text-[#6B6860] mt-2 leading-relaxed">
              {t("geminiDesc")}{" "}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D97757] hover:underline"
              >
                {t("geminiLink")}
              </a>{" "}
              {t("geminiGetKey")}
            </p>
          </div>
          <div>
            <h4 className="font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>{t("openrouterName")}</h4>
            <p className="text-sm text-[#6B6860] mt-2 leading-relaxed">
              {t("openrouterDesc")}{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D97757] hover:underline"
              >
                {t("openrouterLink")}
              </a>{" "}
              {t("openrouterGetKey")}
            </p>
          </div>
          <div>
            <h4 className="font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>{t("kieName")}</h4>
            <p className="text-sm text-[#6B6860] mt-2 leading-relaxed">
              {t("kieDesc")}{" "}
              <a
                href="https://api.kie.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D97757] hover:underline"
              >
                {t("kieLink")}
              </a>{" "}
              {t("kieGetKey")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
