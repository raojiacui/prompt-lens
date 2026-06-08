"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function PixelDeskPet({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClass = {
    sm: "w-8",
    md: "w-12",
    lg: "w-24",
  }[size];

  return (
    <div
      className={cn("pixel-desk-pet relative", sizeClass)}
      style={{ aspectRatio: "241 / 153" }}
      aria-hidden="true"
    >
      <div className="absolute left-[14.5%] top-[33.3%] w-[9.2%] h-[15%] bg-[#D08B70]" />
      <div className="absolute left-[76.3%] top-[33.3%] w-[9.2%] h-[15%] bg-[#D08B70]" />
      <div className="absolute left-[23.7%] top-[11.1%] w-[52.7%] h-[49%] bg-[#D08B70]" />
      <div className="absolute left-[23.7%] top-[49.7%] w-[52.7%] h-[14.4%] bg-[#D08B70]" />
      <div className="absolute left-[31.9%] top-[25.5%] w-[5%] h-[15%] bg-[#070707]" />
      <div className="absolute left-[60.2%] top-[25.5%] w-[5%] h-[15%] bg-[#070707]" />
      <div className="absolute left-[28.6%] top-[63.4%] w-[5.8%] h-[17%] bg-[#D08B70]" />
      <div className="absolute left-[37.8%] top-[63.4%] w-[5.8%] h-[17%] bg-[#D08B70]" />
      <div className="absolute left-[60.2%] top-[63.4%] w-[5.8%] h-[17%] bg-[#D08B70]" />
      <div className="absolute left-[70.9%] top-[63.4%] w-[5.8%] h-[17%] bg-[#D08B70]" />
      <div className="absolute left-[28.6%] top-[79.7%] w-[43.2%] h-[7.2%] bg-[#8A8984]" />
    </div>
  );
}

export function FloatingChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<"deepseek" | "zhipu" | "openrouter">("deepseek");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: userMessage }],
          provider: selectedProvider,
        }),
      });

      if (!res.ok) throw new Error("Failed to get response");

      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${error.message}` },
      ]);
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

  return (
    <>
      {/* 悬浮桌宠按钮 - 右下角 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "fixed bottom-6 right-6 z-50 shadow-lg transition-all duration-300 flex items-center justify-center",
          isOpen ? "w-10 h-10 rounded-full" : "w-28 h-20 pixel-pet-idle hover:scale-105"
        )}
        style={{
          filter: isOpen ? undefined : "drop-shadow(0 8px 14px rgba(20, 20, 19, 0.18))",
          boxShadow: isOpen ? "0 4px 20px rgba(217, 119, 87, 0.4)" : "none",
          background: isOpen ? "#D97757" : "transparent",
        }}
        aria-label={isOpen ? "关闭 AI 助手" : "打开 AI 助手"}
      >
        {isOpen ? (
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <PixelDeskPet size="lg" />
        )}
      </button>

      {/* 聊天对话框 */}
      {isOpen && (
        <div
          className="fixed bottom-24 right-6 z-50 w-80 md:w-96 bg-[#F5F3EC] rounded-2xl shadow-2xl border border-[#D8D5CC] overflow-hidden"
          style={{
            boxShadow: "0 8px 40px rgba(0, 0, 0, 0.15)",
          }}
        >
          {/* 头部 */}
          <div className="bg-[#D97757] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
                <PixelDeskPet size="md" />
              </div>
              <span className="text-white font-medium">AI 助手</span>
            </div>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value as any)}
              className="bg-white/20 text-white text-xs px-2 py-1 rounded border border-white/30 outline-none"
            >
              <option value="deepseek">DeepSeek</option>
              <option value="zhipu">智谱AI</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>

          {/* 消息区域 */}
          <div className="h-80 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-[#9C9890] text-sm py-8">
                <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-[#D97757]/10 flex items-center justify-center overflow-hidden">
                  <PixelDeskPet size="lg" />
                </div>
                <p>有什么可以帮你的？</p>
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
                    "max-w-[80%] px-3 py-2 rounded-xl text-sm",
                    msg.role === "user"
                      ? "bg-[#D97757] text-white rounded-br-md"
                      : "bg-[#ECE9E0] text-[#141413] rounded-bl-md"
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-[#ECE9E0] px-3 py-2 rounded-xl rounded-bl-md flex items-center gap-2">
                  <PixelDeskPet size="sm" />
                  <Spinner size="sm" className="border-[#D97757]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区域 */}
          <div className="p-3 border-t border-[#D8D5CC] bg-white/50">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                className="flex-1 min-h-[40px] max-h-[80px] resize-none border-[#D8D5CC] focus:border-[#D97757]"
                rows={1}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="bg-[#D97757] hover:bg-[#C96848] text-white px-3"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
