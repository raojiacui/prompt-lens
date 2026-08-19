"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, truncate } from "@/lib/utils";
import { useTranslations } from "next-intl";

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
}

interface HistoryListProps {
  refreshTrigger?: number;
}

export function HistoryList({ refreshTrigger }: HistoryListProps) {
  const t = useTranslations("history");
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<HistoryRecord | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteContent, setNoteContent] = useState("");

  const limit = 10;

  useEffect(() => {
    fetchHistory();
  }, [page, refreshTrigger]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (search) params.append("search", search);

      const res = await fetch(`/api/history?${params}`);
      const data = await res.json();
      setRecords(data.history || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    fetchHistory();
  };

  const toggleFavorite = async (id: string, currentFavorite: boolean) => {
    try {
      await fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, favorite: !currentFavorite }),
      });
      fetchHistory();
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  };

  const deleteRecord = async (id: string) => {
    if (!confirm(t("deleteConfirm"))) return;

    try {
      await fetch(`/api/history?id=${id}`, { method: "DELETE" });
      fetchHistory();
      if (selectedRecord?.id === id) {
        setSelectedRecord(null);
      }
    } catch (error) {
      console.error("Failed to delete record:", error);
    }
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
  };

  const saveNote = async () => {
    if (!selectedRecord) return;

    try {
      await fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedRecord.id, note: noteContent }),
      });
      setEditingNote(false);
      fetchHistory();
      setSelectedRecord({ ...selectedRecord, note: noteContent });
    } catch (error) {
      console.error("Failed to save note:", error);
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
    <div className="grid lg:grid-cols-3 gap-6">
      {/* 左侧：列表 */}
      <div className="lg:col-span-1 space-y-4">
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

        {/* 历史记录列表 */}
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : records.length === 0 ? (
            <p className="text-center text-[var(--color-text-muted)] py-8">{t("noHistory")}</p>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                onClick={() => setSelectedRecord(record)}
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
                      {record.corePrompt || truncate(record.prompt, 50)}
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
      <div className="lg:col-span-2">
        <Card className="bg-[var(--color-bg-raised)] border-[var(--color-border-default)]">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle style={{ fontFamily: 'var(--font-display)' }}>{t("detail")}</CardTitle>
            {selectedRecord && (
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
            {selectedRecord ? (
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
