"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export function AgentQATab() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProvider] = useState<"deepseek" | "zhipu" | "openrouter">("deepseek");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          provider,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const data = await response.json();

      const assistantMessage: Message = {
        role: "assistant",
        content: data.content,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error: any) {
      const errorMessage: Message = {
        role: "assistant",
        content: `Error: ${error.message}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => setMessages([]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 左侧：聊天区 */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[#141413] flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
              <span className="w-10 h-10 rounded-xl bg-[#D97757]/10 flex items-center justify-center text-[#D97757]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 18.5c0 3.816-3.336 6.5-6.5 6.5a9.77 9.77 0 01-2.08-.332 5.976 5.976 0 01-1.537-2.333C2.174 18.5 1 15.75 1 12c0-4.556 4.03-8.25 9-8.25 3.136 0 5.74 1.54 7.52 3.937.577.774 1.084 1.63 1.512 2.548l.074.06z" />
                </svg>
              </span>
              AI 助手
            </CardTitle>
            {messages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearChat}
                className="border-[#C8C4BC] text-[#6B6860] hover:text-[#D97757] hover:border-[#D97757] rounded-lg text-xs"
              >
                清空对话
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col h-[500px]">
          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto space-y-4 mb-4">
            {messages.length === 0 && (
              <div className="text-center py-16 text-[#6B6860]">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#D8D5CC]/30 flex items-center justify-center">
                  <svg className="w-8 h-8 text-[#9C9890]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.405 14.405 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                  </svg>
                </div>
                <p className="text-sm">开始和 AI 助手对话吧</p>
                <p className="text-xs text-[#9C9890] mt-1">Shift+Enter 换行，Enter 发送</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3",
                    msg.role === "user"
                      ? "bg-[#D97757] text-white rounded-br-md"
                      : "bg-[#ECE9E0] text-[#141413] rounded-bl-md"
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-[#ECE9E0] rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2 text-[#6B6860]">
                    <Spinner size="sm" className="border-[#D97757]" />
                    <span className="text-sm">AI 思考中...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <div className="border-t border-[#D8D5CC] pt-4">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                rows={2}
                className="bg-white border-[#C8C4BC] focus:border-[#D97757] resize-none"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="h-auto bg-[#D97757] hover:bg-[#C96848] text-white rounded-xl px-4"
              >
                发送
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 右侧：设置 */}
      <Card className="bg-[#F5F3EC] border-[#D8D5CC] shadow-sm">
        <CardHeader>
          <CardTitle className="text-[#141413] flex items-center gap-3" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="w-10 h-10 rounded-xl bg-[#D8D5CC]/30 flex items-center justify-center text-[#6B6860]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.869.388.243.77.456 1.132.57l1.48.234c.64.098 1.005.65 1.005 1.277v.043c0 .624-.394.982-1.005 1.277l-1.48.234c-.363.114-.744.326-1.132.57-.332.183-.582.495-.645.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.593c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.063-.374-.313-.686-.645-.869-.388-.243-.77-.456-1.132-.57l-1.48-.234c-.64-.098-1.005-.65-1.005-1.277v-.043c0-.624.394-.982 1.005-1.277l1.48-.234c.363-.114.744-.326 1.132-.57.332-.183.582-.495.645-.869l.213-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </span>
            设置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="text-sm font-medium text-[#141413] block mb-2">AI 提供商</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as any)}
              className="w-full h-10 px-3 border border-[#C8C4BC] rounded-lg focus:border-[#D97757] outline-none bg-white text-[#141413]"
            >
              <option value="deepseek">DeepSeek</option>
              <option value="zhipu">智谱AI</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>

          <div className="border-t border-[#D8D5CC] pt-4">
            <h3 className="text-sm font-medium text-[#141413] mb-3">使用说明</h3>
            <ul className="text-sm text-[#6B6860] space-y-2">
              <li>• 选择 AI 提供商并输入消息</li>
              <li>• 支持多轮对话，保持上下文</li>
              <li>• Shift+Enter 换行，Enter 发送</li>
              <li>• 点击"清空对话"开始新对话</li>
            </ul>
          </div>

          <div className="border-t border-[#D8D5CC] pt-4">
            <h3 className="text-sm font-medium text-[#141413] mb-3">支持的模型</h3>
            <div className="space-y-2 text-sm text-[#6B6860]">
              <div className="flex items-center justify-between py-2 border-b border-[#D8D5CC]/50">
                <span>DeepSeek</span>
                <span className="text-xs bg-[#D97757]/10 text-[#D97757] px-2 py-0.5 rounded">deepseek-chat</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-[#D8D5CC]/50">
                <span>智谱AI</span>
                <span className="text-xs bg-[#D97757]/10 text-[#D97757] px-2 py-0.5 rounded">glm-4</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span>OpenRouter</span>
                <span className="text-xs bg-[#D97757]/10 text-[#D97757] px-2 py-0.5 rounded">claude-3-haiku</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
