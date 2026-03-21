"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

interface ApiKey {
  id: string;
  provider: string;
  isActive: boolean;
  createdAt: string;
  apiKey: string;
}

export function ApiKeySettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [provider, setProvider] = useState("zhipu");
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
      setMessage({ type: "error", text: "请输入 API Key" });
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
        setMessage({ type: "success", text: "API Key 保存成功" });
        setApiKey("");
        fetchApiKeys();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "保存失败" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "保存失败，请重试" });
    } finally {
      setSaving(false);
    }
  };

  const deleteApiKey = async (id: string) => {
    if (!confirm("确定要删除这个 API Key 吗？")) return;

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

  return (
    <div className="space-y-6">
      {/* 添加 API Key */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC]">
        <CardHeader>
          <CardTitle style={{ fontFamily: 'var(--font-display)' }}>添加 API Key</CardTitle>
          <CardDescription>
            选择一个 API 提供商并输入您的 API Key。您的 API Key 将安全地存储在数据库中。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-[#141413] block mb-2">提供商</label>
              <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="bg-white">
                <option value="zhipu">智谱AI (glm-4v)</option>
                <option value="gemini">Google Gemini</option>
                <option value="openrouter">OpenRouter</option>
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
                      ? "输入智谱AI API Key (格式: xxx.xxx)"
                      : provider === "gemini"
                      ? "输入 Google API Key (格式: AIza...)"
                      : "输入 OpenRouter API Key"
                  }
                  className="bg-white"
                />
                <Button onClick={saveApiKey} disabled={saving} className="bg-[#D97757] hover:bg-[#C96848]">
                  {saving ? <Spinner size="sm" /> : "保存"}
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
          <CardTitle style={{ fontFamily: 'var(--font-display)' }}>已保存的 API Key</CardTitle>
          <CardDescription>已配置的 API 提供商列表</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : apiKeys.length === 0 ? (
            <p className="text-center text-[#9C9890] py-8">
              尚未配置任何 API Key
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
                        {key.provider === "zhipu"
                          ? "智谱AI"
                          : key.provider === "gemini"
                          ? "Google Gemini"
                          : "OpenRouter"}
                      </span>
                      {key.isActive && (
                        <span className="text-xs bg-[#5B8C5A]/10 text-[#5B8C5A] px-2 py-0.5 rounded">
                          启用中
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[#6B6860] mt-1 font-mono">{key.apiKey}</p>
                    <p className="text-xs text-[#9C9890] mt-1">
                      添加于 {new Date(key.createdAt).toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteApiKey(key.id)}
                    className="border-[#C8C4BC] text-[#6B6860] hover:text-[#C0453A] hover:border-[#C0453A]"
                  >
                    删除
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
          <CardTitle style={{ fontFamily: 'var(--font-display)' }}>API 提供商说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>智谱AI (推荐)</h4>
            <p className="text-sm text-[#6B6860] mt-2 leading-relaxed">
              国内访问，无需代理。访问{" "}
              <a
                href="https://open.bigmodel.cn/usercenter/apikeys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D97757] hover:underline"
              >
                智谱AI开放平台
              </a>{" "}
              获取 API Key。
            </p>
          </div>
          <div>
            <h4 className="font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>Google Gemini</h4>
            <p className="text-sm text-[#6B6860] mt-2 leading-relaxed">
              需要代理/VPN。访问{" "}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D97757] hover:underline"
              >
                Google AI Studio
              </a>{" "}
              获取 API Key。
            </p>
          </div>
          <div>
            <h4 className="font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>OpenRouter</h4>
            <p className="text-sm text-[#6B6860] mt-2 leading-relaxed">
              支持多种模型。访问{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D97757] hover:underline"
              >
                OpenRouter
              </a>{" "}
              获取 API Key。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
