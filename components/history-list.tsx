"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, truncate } from "@/lib/utils";

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
}

interface HistoryListProps {
  refreshTrigger?: number;
}

export function HistoryList({ refreshTrigger }: HistoryListProps) {
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
    if (!confirm("确定要删除这条记录吗？")) return;

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
      content = `# ${record.mediaName}\n\n## Prompt\n${record.prompt}\n\n## Note\n${record.note || "无"}\n`;
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
            placeholder="搜索提示词..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button onClick={handleSearch}>搜索</Button>
        </div>

        {/* 历史记录列表 */}
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : records.length === 0 ? (
            <p className="text-center text-gray-400 py-8">暂无历史记录</p>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                onClick={() => setSelectedRecord(record)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedRecord?.id === record.id
                    ? "border-primary bg-primary/5"
                    : "hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">
                        {record.mediaType === "video" ? "📹" : "🖼️"}
                      </span>
                      <span className="font-medium text-sm truncate">
                        {record.mediaName || "未命名"}
                      </span>
                      {record.favorite && <span>⭐</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {record.corePrompt || truncate(record.prompt, 50)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
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
            >
              上一页
            </Button>
            <span className="flex items-center text-sm">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </div>

      {/* 右侧：详情 */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>详情</CardTitle>
            {selectedRecord && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleFavorite(selectedRecord.id, selectedRecord.favorite)}
                >
                  {selectedRecord.favorite ? "⭐" : "☆"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyPrompt(selectedRecord.prompt)}
                >
                  复制
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteRecord(selectedRecord.id)}
                >
                  删除
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {selectedRecord ? (
              <div className="space-y-4">
                {/* 元信息 */}
                <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                  <span>
                    类型: {selectedRecord.mediaType === "video" ? "视频" : "图片"}
                  </span>
                  <span>创建时间: {formatDate(selectedRecord.createdAt)}</span>
                  {selectedRecord.note && (
                    <span>备注: {selectedRecord.note}</span>
                  )}
                </div>

                {/* 提示词内容 */}
                <div>
                  <h4 className="font-medium mb-2">提示词内容</h4>
                  <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-lg max-h-[400px] overflow-y-auto">
                    {selectedRecord.prompt}
                  </pre>
                </div>

                {/* 备注编辑 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">备注</h4>
                    {!editingNote && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setNoteContent(selectedRecord.note || "");
                          setEditingNote(true);
                        }}
                      >
                        编辑
                      </Button>
                    )}
                  </div>
                  {editingNote ? (
                    <div className="space-y-2">
                      <Textarea
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        placeholder="添加备注..."
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveNote}>
                          保存
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingNote(false)}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500">
                      {selectedRecord.note || "暂无备注"}
                    </p>
                  )}
                </div>

                {/* 导出 */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRecord(selectedRecord, "txt")}
                  >
                    导出 TXT
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRecord(selectedRecord, "md")}
                  >
                    导出 MD
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRecord(selectedRecord, "json")}
                  >
                    导出 JSON
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-center text-gray-400 py-12">
                点击左侧记录查看详情
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
