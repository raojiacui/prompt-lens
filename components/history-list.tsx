"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, truncate } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { GenerationHistory } from "@/components/reference-video/generation-history";
import { ProjectHistoryDetails } from "@/components/workflow/project-history-details";

interface HistoryRecord {
  id: string;
  mediaType: string;
  mediaName: string;
  corePrompt: string;
  prompt: string;
  note: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  language?: string;
  source?: "legacy" | "workflow";
  projectId?: string;
  status?: string;
  sceneCount?: number;
}

interface HistoryListProps {
  refreshTrigger?: number;
}

function analysisStatusLabel(status: string | undefined, zh: boolean) {
  const labels: Record<string, string> = zh
    ? { draft: "未开始", analyzing: "分析中", ready: "分析完成", partial: "部分完成", failed: "分析失败", archived: "已归档" }
    : { draft: "Not started", analyzing: "Analyzing", ready: "Ready", partial: "Partially completed", failed: "Failed", archived: "Archived" };
  return labels[status || ""] || status || "";
}

export function HistoryList({ refreshTrigger }: HistoryListProps) {
  const zh = useLocale() !== "en";
  const [tab, setTab] = useState<"analysis" | "generation">("analysis");
  return <div className="space-y-5">
    <div role="group" aria-label={zh ? "历史记录类型" : "History type"} className="flex flex-wrap gap-2">
      {(["analysis", "generation"] as const).map(value => <Button key={value} variant={tab === value ? "default" : "outline"} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === "analysis" ? (zh ? "分析历史" : "Analysis history") : (zh ? "生成历史" : "Generation history")}</Button>)}
    </div>
    {tab === "analysis" ? <AnalysisHistory refreshTrigger={refreshTrigger} /> : <GenerationHistory refreshKey={String(refreshTrigger ?? 0)} />}
  </div>;
}

function AnalysisHistory({ refreshTrigger }: HistoryListProps) {
  const t = useTranslations("history");
  const zh = useLocale() !== "en";
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<HistoryRecord | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteContent, setNoteContent] = useState("");

  const limit = 10;

  const fetchHistory = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (query) params.append("search", query);

      const res = await fetch(`/api/history?${params}`, { cache: "no-store", signal });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!Array.isArray(data.history)) throw new Error();
      if (signal?.aborted) return;
      setRecords(data.history);
      setTotal(data.total || 0);
      setError("");
    } catch {
      if (!signal?.aborted) setError(zh ? "分析历史暂时无法加载，请刷新重试。" : "Unable to load analysis history. Please refresh to retry.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, query, zh]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchHistory(controller.signal);
    return () => controller.abort();
  }, [fetchHistory, refreshTrigger]);

  const handleSearch = () => {
    setPage(1);
    setSelectedRecord(null);
    setQuery(search.trim());
    if (page === 1 && query === search.trim()) void fetchHistory();
  };

  const toggleFavorite = async (id: string, currentFavorite: boolean) => {
    try {
      const response = await fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, favorite: !currentFavorite }),
      });
      if (!response.ok) throw new Error();
      void fetchHistory();
      setSelectedRecord(record => record?.id === id ? { ...record, favorite: !currentFavorite } : record);
    } catch {
      setError(zh ? "收藏状态保存失败，请重试。" : "Unable to save favorite. Please retry.");
    }
  };

  const deleteRecord = async (id: string) => {
    if (!confirm(t("deleteConfirm"))) return;

    try {
      const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      void fetchHistory();
      if (selectedRecord?.id === id) {
        setSelectedRecord(null);
      }
    } catch {
      setError(zh ? "删除失败，请重试。" : "Unable to delete record. Please retry.");
    }
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
  };

  const saveNote = async () => {
    if (!selectedRecord) return;

    try {
      const response = await fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedRecord.id, note: noteContent }),
      });
      if (!response.ok) throw new Error();
      setEditingNote(false);
      void fetchHistory();
      setSelectedRecord({ ...selectedRecord, note: noteContent });
    } catch {
      setError(zh ? "备注保存失败，请重试。" : "Unable to save note. Please retry.");
    }
  };

  const exportRecord = (record: HistoryRecord, format: "txt" | "json" | "md") => {
    let content = "";
    const filename = `prompt_${record.id}.${format}`;

    if (format === "json") {
      content = JSON.stringify({ prompt: record.prompt, note: record.note }, null, 2);
    } else if (format === "md") {
      content = `# ${record.mediaName}\n\n## Prompt\n${record.prompt}\n\n## Note\n${record.note || t("exportNoteEmpty")}\n`;
    } else {
      content = record.prompt;
    }

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-3">
      {/* 左侧：列表 */}
      <div className="min-w-0 space-y-4 lg:col-span-1">
        {/* 搜索框 */}
        <div className="flex gap-2">
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="bg-[var(--color-bg-raised)]"
          />
          <Button onClick={handleSearch} className="bg-[#D97757] hover:bg-[#C96848]">
            {t("search")}
          </Button>
        </div>

        <Button variant="outline" size="sm" disabled={loading} onClick={() => void fetchHistory()}>{zh ? "刷新分析历史" : "Refresh analysis history"}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {/* 历史记录列表 */}
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : records.length === 0 && !error ? (
            <p className="text-center text-[var(--color-text-muted)] py-8">{t("noHistory")}</p>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                role="button"
                tabIndex={0}
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedRecord(record); setEditingNote(false); } }}
                onClick={() => { setSelectedRecord(record); setEditingNote(false); }}
                className={`p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                  selectedRecord?.id === record.id
                    ? "border-[#D97757] bg-[#D97757]/5"
                    : "border-[var(--color-border-default)] hover:border-[var(--color-accent-orange)]/30 hover:bg-[var(--color-bg-base)]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">
                        {record.mediaType === "video" ? "📹" : "🖼️"}
                      </span>
                      <span className="font-medium text-sm text-[var(--color-text-primary)] truncate" style={{ fontFamily: 'var(--font-heading)' }}>
                        {record.mediaName || t("unnamed")}
                      </span>
                      {record.favorite && <span className="text-[var(--color-accent-orange)]">⭐</span>}
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1 truncate">
                      {record.source === "workflow" ? `${analysisStatusLabel(record.status, zh)} · ${record.sceneCount || 0} ${zh ? "个镜头" : "shots"}` : record.corePrompt || truncate(record.prompt, 50)}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      {formatDate(record.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="border-[var(--color-border-default)] text-[var(--color-text-secondary)]"
            >
              {t("prevPage")}
            </Button>
            <span className="flex items-center text-sm text-[var(--color-text-secondary)]">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="border-[var(--color-border-default)] text-[var(--color-text-secondary)]"
            >
              {t("nextPage")}
            </Button>
          </div>
        )}
      </div>

      {/* 右侧：详情 */}
      <div className="min-w-0 lg:col-span-2">
        <Card className="bg-[var(--color-bg-raised)] border-[var(--color-border-default)]">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle style={{ fontFamily: 'var(--font-display)' }}>{t("detail")}</CardTitle>
            {selectedRecord && selectedRecord.source !== "workflow" && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleFavorite(selectedRecord.id, selectedRecord.favorite)}
                  className="border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-orange)] hover:border-[var(--color-accent-orange)]"
                >
                  {selectedRecord.favorite ? "⭐" : "☆"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyPrompt(selectedRecord.prompt)}
                  className="border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-orange)] hover:border-[var(--color-accent-orange)]"
                >
                  {t("copy")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteRecord(selectedRecord.id)}
                  className="border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-error)] hover:border-[var(--color-error)]"
                >
                  {t("delete")}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {selectedRecord?.source === "workflow" && selectedRecord.projectId ? <ProjectHistoryDetails key={selectedRecord.id} projectId={selectedRecord.projectId} /> : selectedRecord ? (
              <div className="space-y-4">
                {/* 元信息 */}
                <div className="flex flex-wrap gap-4 text-sm text-[var(--color-text-secondary)]">
                  <span>
                    {t("type")}: {selectedRecord.mediaType === "video" ? t("typeVideo") : t("typeImage")}
                  </span>
                  <span>{t("createdAt")}: {formatDate(selectedRecord.createdAt)}</span>
                  {selectedRecord.note && (
                    <span>{t("note")}: {selectedRecord.note}</span>
                  )}
                </div>

                {/* 提示词内容 */}
                <div>
                  <h4 className="font-medium text-[var(--color-text-primary)] mb-2" style={{ fontFamily: 'var(--font-heading)' }}>{t("promptContent")}</h4>
                  <pre className="whitespace-pre-wrap text-sm text-[var(--color-text-primary)] bg-[var(--color-bg-base)] p-4 rounded-lg max-h-[400px] overflow-y-auto font-mono leading-relaxed">
                    {selectedRecord.prompt}
                  </pre>
                </div>

                {/* 备注编辑 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-heading)' }}>{t("note")}</h4>
                    {!editingNote && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setNoteContent(selectedRecord.note || "");
                          setEditingNote(true);
                        }}
                        className="text-[var(--color-accent-orange)] hover:text-[var(--color-accent-orange-hover)]"
                      >
                        {t("editNote")}
                      </Button>
                    )}
                  </div>
                  {editingNote ? (
                    <div className="space-y-2">
                      <Textarea
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        placeholder={t("notePlaceholder")}
                        rows={3}
                        className="bg-[var(--color-bg-raised)] border-[var(--color-border-default)] focus:border-[var(--color-accent-orange)]"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveNote} className="bg-[#D97757] hover:bg-[#C96848]">
                          {t("save")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingNote(false)}
                          className="border-[var(--color-border-default)] text-[var(--color-text-secondary)]"
                        >
                          {t("cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[var(--color-text-secondary)]">
                      {selectedRecord.note || t("noNote")}
                    </p>
                  )}
                </div>

                {/* 导出 */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRecord(selectedRecord, "txt")}
                    className="border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-orange)] hover:border-[var(--color-accent-orange)]"
                  >
                    {t("exportTxt")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRecord(selectedRecord, "md")}
                    className="border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-orange)] hover:border-[var(--color-accent-orange)]"
                  >
                    {t("exportMd")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRecord(selectedRecord, "json")}
                    className="border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-orange)] hover:border-[var(--color-accent-orange)]"
                  >
                    {t("exportJson")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-center text-[var(--color-text-muted)] py-12">
                {t("selectToView")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
