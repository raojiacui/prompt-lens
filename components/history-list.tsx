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
            className="bg-white"
          />
          <Button onClick={handleSearch} className="bg-[#D97757] hover:bg-[#C96848]">
            搜索
          </Button>
        </div>

        {/* 历史记录列表 */}
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : records.length === 0 ? (
            <p className="text-center text-[#9C9890] py-8">暂无历史记录</p>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                onClick={() => setSelectedRecord(record)}
                className={`p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                  selectedRecord?.id === record.id
                    ? "border-[#D97757] bg-[#D97757]/5"
                    : "border-[#D8D5CC] hover:border-[#D97757]/30 hover:bg-[#ECE9E0]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">
                        {record.mediaType === "video" ? "📹" : "🖼️"}
                      </span>
                      <span className="font-medium text-sm text-[#141413] truncate" style={{ fontFamily: 'var(--font-heading)' }}>
                        {record.mediaName || "未命名"}
                      </span>
                      {record.favorite && <span className="text-[#D97757]">⭐</span>}
                    </div>
                    <p className="text-xs text-[#6B6860] mt-1 truncate">
                      {record.corePrompt || truncate(record.prompt, 50)}
                    </p>
                    <p className="text-xs text-[#9C9890] mt-1">
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
              className="border-[#C8C4BC] text-[#6B6860]"
            >
              上一页
            </Button>
            <span className="flex items-center text-sm text-[#6B6860]">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="border-[#C8C4BC] text-[#6B6860]"
            >
              下一页
            </Button>
          </div>
        )}
      </div>

      {/* 右侧：详情 */}
      <div className="lg:col-span-2">
        <Card className="bg-[#F5F3EC] border-[#D8D5CC]">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle style={{ fontFamily: 'var(--font-display)' }}>详情</CardTitle>
            {selectedRecord && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleFavorite(selectedRecord.id, selectedRecord.favorite)}
                  className="border-[#C8C4BC] text-[#6B6860] hover:text-[#D97757] hover:border-[#D97757]"
                >
                  {selectedRecord.favorite ? "⭐" : "☆"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyPrompt(selectedRecord.prompt)}
                  className="border-[#C8C4BC] text-[#6B6860] hover:text-[#D97757] hover:border-[#D97757]"
                >
                  复制
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteRecord(selectedRecord.id)}
                  className="border-[#C8C4BC] text-[#6B6860] hover:text-[#C0453A] hover:border-[#C0453A]"
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
                <div className="flex flex-wrap gap-4 text-sm text-[#6B6860]">
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
                  <h4 className="font-medium text-[#141413] mb-2" style={{ fontFamily: 'var(--font-heading)' }}>提示词内容</h4>
                  <pre className="whitespace-pre-wrap text-sm text-[#141413] bg-[#ECE9E0] p-4 rounded-lg max-h-[400px] overflow-y-auto font-mono leading-relaxed">
                    {selectedRecord.prompt}
                  </pre>
                </div>

                {/* 备注编辑 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-[#141413]" style={{ fontFamily: 'var(--font-heading)' }}>备注</h4>
                    {!editingNote && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setNoteContent(selectedRecord.note || "");
                          setEditingNote(true);
                        }}
                        className="text-[#D97757] hover:text-[#C96848]"
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
                        className="bg-white border-[#C8C4BC] focus:border-[#D97757]"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveNote} className="bg-[#D97757] hover:bg-[#C96848]">
                          保存
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingNote(false)}
                          className="border-[#C8C4BC] text-[#6B6860]"
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[#6B6860]">
                      {selectedRecord.note || "暂无备注"}
                    </p>
                  )}
                </div>

                {/* 导出 */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRecord(selectedRecord, "txt")}
                    className="border-[#C8C4BC] text-[#6B6860] hover:text-[#D97757] hover:border-[#D97757]"
                  >
                    导出 TXT
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRecord(selectedRecord, "md")}
                    className="border-[#C8C4BC] text-[#6B6860] hover:text-[#D97757] hover:border-[#D97757]"
                  >
                    导出 MD
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRecord(selectedRecord, "json")}
                    className="border-[#C8C4BC] text-[#6B6860] hover:text-[#D97757] hover:border-[#D97757]"
                  >
                    导出 JSON
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-center text-[#9C9890] py-12">
                点击左侧记录查看详情
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
