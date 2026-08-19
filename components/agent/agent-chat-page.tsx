"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, RefreshCw, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { agentApi } from "@/lib/agent/client";
import type { AgentRunDetail } from "@/lib/agent/types";
import { runStatusLabel } from "./agent-suggestions";
import { artifactToText } from "./agent-artifact-panel";

interface Props {
  runId: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled", "waiting_for_user"]);

export function AgentChatPage({ runId }: Props) {
  const router = useRouter();
  const [run, setRun] = useState<AgentRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadRun = useCallback(async () => {
    try {
      const { run: next } = await agentApi.getRun(runId);
      setRun(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this agent run.");
    }
  }, [runId]);

  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (!run || TERMINAL.has(run.status)) return;
    const timer = window.setTimeout(() => {
      void loadRun();
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [run, loadRun]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  const assistantBlocks = useMemo(() => {
    if (!run) return [];
    const blocks: Array<{ key: string; body: React.ReactNode }> = [];
    const zh = run.locale === "zh";

    blocks.push({
      key: "welcome",
      body: (
        <div className="space-y-5">
          <p className="font-bold">{zh ? "你好！" : "Hello!"} <span aria-hidden>👋</span></p>
          <p>
            {zh
              ? "我已经接收到你的目标，正在把它拆成可执行的步骤。"
              : "I have your goal and I am turning it into an executable workflow."}
          </p>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#F5F5F5] px-3 py-1 text-sm font-semibold text-[#636363]">
            {(run.status === "queued" || run.status === "planning" || run.status === "running") && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {runStatusLabel(run.status)}
          </div>
        </div>
      ),
    });

    if (run.steps.length > 0) {
      blocks.push({
        key: "steps",
        body: (
          <div className="space-y-4">
            <p className="font-bold">{zh ? "我会这样推进：" : "Here is the plan:"}</p>
            <ul className="space-y-3">
              {run.steps.map((step) => (
                <li key={step.id} className="flex gap-3">
                  <span className={cn(
                    "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                    step.status === "completed" ? "bg-[#5B8C5A]" : step.status === "running" ? "bg-[#5B2DFF]" : step.status === "failed" ? "bg-[#C0453A]" : "bg-[#D8D8D8]"
                  )} />
                  <span>
                    <span className="font-bold">{step.title}</span>
                    {step.outputSummary ? <span className="text-[#666]"> — {step.outputSummary}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ),
      });
    }

    if (run.artifacts.length > 0) {
      blocks.push({
        key: "artifacts",
        body: (
          <div className="space-y-4">
            <p className="font-bold">{zh ? "已经生成的内容：" : "Generated deliverables:"}</p>
            <div className="space-y-3">
              {run.artifacts.slice(0, 3).map((artifact) => (
                <details key={artifact.id} className="rounded-2xl bg-[#F7F7F7] px-4 py-3">
                  <summary className="cursor-pointer text-sm font-bold text-[#3F3F3F]">{artifact.title}</summary>
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-[#555]">{artifactToText(artifact)}</pre>
                </details>
              ))}
            </div>
          </div>
        ),
      });
    }

    if (run.errorMessage) {
      blocks.push({
        key: "error",
        body: <p className="text-[#9A332A]">{run.errorMessage}</p>,
      });
    }

    return blocks;
  }, [run]);

  const submitFollowUp = async () => {
    const goal = input.trim();
    if (!goal || submitting) return;
    setSubmitting(true);
    try {
      const locale = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
      const { run: next } = await agentApi.createRun({ userGoal: goal, locale });
      setInput("");
      router.replace(`/agent/${next.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send this message.");
    } finally {
      setSubmitting(false);
    }
  };

  const title = run?.goal || "Agent";

  return (
    <div className="min-h-screen bg-white text-[#2B2B2B] agent-chat-enter">
      <header className="fixed left-0 right-0 top-0 z-30 bg-white/90 px-6 py-4 backdrop-blur-sm md:px-8">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-[#BFDFFF] bg-white px-4 text-base font-bold text-[#0A2E63] shadow-sm transition-colors hover:bg-[#F7FBFF] focus-visible:ring-2 focus-visible:ring-[#8BC6FF]"
          >
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>
          <h1 className="max-w-[50vw] truncate text-xl font-bold text-[#303030]">{title}</h1>
        </div>
      </header>

      <main className="mx-auto flex min-h-screen w-full max-w-[900px] flex-col px-4 pb-7 pt-20 md:px-0">
        <section className="flex min-h-[calc(100vh-6.5rem)] flex-1 flex-col rounded-[24px] border border-[#E2E2E2] bg-white shadow-[0_10px_32px_rgba(25,25,25,0.04)]">
          <div className="flex items-center justify-between px-6 py-5 md:px-7">
            <h2 className="text-3xl font-extrabold tracking-normal text-[#2B2B2B]">Agent</h2>
            <button
              type="button"
              onClick={() => { setInput(""); void loadRun(); }}
              className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-base font-bold text-[#5D5D5D] transition-colors hover:bg-[#F5F5F5]"
            >
              <RefreshCw className="h-5 w-5" />
              Clear
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-7 pt-2 md:px-7">
            {error && (
              <div className="mb-6 rounded-2xl bg-[#FDF1ED] px-4 py-3 text-sm font-semibold text-[#9A332A]">{error}</div>
            )}

            {!run ? (
              <div className="flex h-80 items-center justify-center text-sm font-semibold text-[#777]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading agent chat...
              </div>
            ) : (
              <div className="space-y-8">
                <div className="flex justify-end">
                  <div className="max-w-[72%] rounded-2xl bg-[#F4F4F4] px-4 py-3 text-base font-bold leading-relaxed text-[#555]">
                    {run.goal}
                  </div>
                </div>

                {assistantBlocks.map((block) => (
                  <div key={block.key} className="max-w-[84%] text-[17px] font-semibold leading-8 text-[#585858]">
                    {block.body}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 pb-4 md:px-5">
            <div className="rounded-[18px] border-[3px] border-[#CFE7FF] bg-white px-3 py-3 shadow-sm focus-within:border-[#BFDFFF]">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submitFollowUp();
                  }
                }}
                rows={1}
                placeholder="Edit slides, change settings or @mention a source"
                className="block max-h-32 min-h-12 w-full resize-none bg-transparent px-1 text-xl font-medium leading-7 text-[#333] outline-none placeholder:text-[#B8B8B8] focus-visible:shadow-none"
              />
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#BFDFFF] text-[#0A2E63] transition-colors hover:bg-[#F7FBFF] focus-visible:ring-2 focus-visible:ring-[#BFDFFF]"
                  aria-label="Attach a file"
                >
                  <Plus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => void submitFollowUp()}
                  disabled={!input.trim() || submitting}
                  className={cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[#BFDFFF]",
                    input.trim() && !submitting ? "bg-[#A8D8FF] text-white hover:bg-[#8BC6FF]" : "bg-white text-[#BDBDBD] ring-1 ring-[#D5D5D5]"
                  )}
                  aria-label="Send message"
                >
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}