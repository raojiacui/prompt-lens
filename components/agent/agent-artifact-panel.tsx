"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  FileText,
  Film,
  ListOrdered,
  Route,
  ShieldAlert,
  Sparkles,
  Star,
  StarOff,
  Wand2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentArtifact, AgentArtifactType, AgentRunDetail } from "@/lib/agent/types";
import { agentApi } from "@/lib/agent/client";

interface Props {
  run: AgentRunDetail;
  onChanged?: () => void;
}

const TYPE_META: Record<AgentArtifactType, { label: string; icon: typeof FileText; accent: string }> = {
  brief: { label: "Creative Brief", icon: Sparkles, accent: "text-[#D97757]" },
  research_report: { label: "Research Report", icon: FileText, accent: "text-[#3B6FB6]" },
  video_prompt: { label: "Video Prompt", icon: Film, accent: "text-[#D97757]" },
  shot_list: { label: "Shot List", icon: ListOrdered, accent: "text-[#5B8C5A]" },
  workflow: { label: "Workflow Plan", icon: Route, accent: "text-[#7A5BA6]" },
  risk_notes: { label: "Risk Notes", icon: ShieldAlert, accent: "text-[#C0453A]" },
  next_actions: { label: "Next Actions", icon: Wand2, accent: "text-[#D97757]" },
  history_lookup: { label: "History Lookup", icon: FileText, accent: "text-[#6B6860]" },
  summary: { label: "Summary", icon: Sparkles, accent: "text-[#141413]" },
  other: { label: "Artifact", icon: FileText, accent: "text-[#6B6860]" },
};

/** 把任意 artifact content 序列化为可复制文本 */
export function artifactToText(artifact: AgentArtifact): string {
  const c = artifact.content as Record<string, unknown>;
  const lines: string[] = [`# ${artifact.title}`, ""];

  const pushValue = (label: string, value: unknown) => {
    if (value == null) return;
    if (typeof value === "string") {
      lines.push(`## ${label}`, value, "");
    } else if (Array.isArray(value)) {
      lines.push(`## ${label}`);
      value.forEach((v, i) => {
        if (typeof v === "string") lines.push(`${i + 1}. ${v}`);
        else lines.push(`${i + 1}. ${JSON.stringify(v)}`);
      });
      lines.push("");
    } else if (typeof value === "object") {
      lines.push(`## ${label}`, "```json", JSON.stringify(value, null, 2), "```", "");
    }
  };

  pushValue("Summary", c.summary);
  pushValue("Main Prompt", c.mainPrompt);
  pushValue("Negative Prompt", c.negativePrompt);
  if (Array.isArray(c.shotList)) {
    lines.push("## Shot List");
    (c.shotList as Array<Record<string, unknown>>).forEach((s, i) => {
      lines.push(`${i + 1}. [${s.duration || ""}] ${s.description || ""} — ${s.camera || ""}`);
    });
    lines.push("");
  }
  if (Array.isArray(c.shots)) {
    lines.push("## Shots");
    (c.shots as Array<Record<string, unknown>>).forEach((s, i) => {
      lines.push(`${i + 1}. ${JSON.stringify(s)}`);
    });
    lines.push("");
  }
  pushValue("Style Notes", c.styleNotes);
  pushValue("Opportunities", c.opportunities);
  pushValue("Creative Angles", c.creativeAngles);
  pushValue("Risk Notes", c.riskNotes);
  if (Array.isArray(c.steps)) pushValue("Workflow Steps", c.steps);
  if (c.recommendedSettings && typeof c.recommendedSettings === "object") {
    pushValue("Recommended Settings", c.recommendedSettings);
  }
  if (Array.isArray(c.platformAdvice)) pushValue("Platform Advice", c.platformAdvice);
  if (Array.isArray(c.keywords)) pushValue("Keywords", c.keywords);

  // 如果上面都没覆盖，兜底输出 JSON
  if (lines.length <= 2) {
    lines.push("```json", JSON.stringify(c, null, 2), "```");
  }
  return lines.join("\n");
}

type ToastKind = "success" | "error";
interface Toast {
  kind: ToastKind;
  message: string;
}

export function AgentArtifactPanel({ run, onChanged }: Props) {
  const artifacts = run.artifacts;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  if (artifacts.length === 0) {
    return null;
  }

  const flash = (kind: ToastKind, message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 2400);
  };

  const copy = async (artifact: AgentArtifact) => {
    const text = artifactToText(artifact);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(artifact.id);
      window.setTimeout(() => setCopiedId(null), 1500);
      flash("success", "Copied to clipboard");
    } catch {
      // clipboard 可能被浏览器策略阻止（非安全上下文），降级提示
      flash("error", "Copy failed — clipboard blocked by browser");
    }
  };

  const toggleFavorite = async (artifact: AgentArtifact) => {
    const next = !artifact.favorite;
    setPendingId(artifact.id);
    try {
      await agentApi.setArtifactFavorite(run.id, artifact.id, next);
      onChanged?.();
      flash("success", next ? "Saved to favorites" : "Removed from favorites");
    } catch (e) {
      // 失败时回滚由 onChanged 拉取的最新状态兜底；这里给错误提示
      flash("error", e instanceof Error ? e.message : "Could not update favorite");
      onChanged?.();
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[#141413]" style={{ fontFamily: "var(--font-heading)" }}>
        Deliverables
      </h3>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-sm",
            toast.kind === "success"
              ? "border-[#5B8C5A]/30 bg-[#EEF6EE] text-[#356034]"
              : "border-[#C0453A]/30 bg-[#FDF1ED] text-[#8A3329]"
          )}
        >
          {toast.kind === "success" ? (
            <Check className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {artifacts.map((artifact) => {
          const meta = TYPE_META[artifact.type] || TYPE_META.other;
          const Icon = meta.icon;
          const isPending = pendingId === artifact.id;
          return (
            <div
              key={artifact.id}
              className="flex flex-col rounded-2xl border border-[#E4E2DD] bg-white/80 p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className={cn("h-4 w-4 shrink-0", meta.accent)} />
                  <span className="truncate text-sm font-semibold text-[#141413]">{artifact.title}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(artifact)}
                    disabled={isPending}
                    aria-label={artifact.favorite ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={artifact.favorite}
                    title={artifact.favorite ? "Remove from favorites" : "Add to favorites"}
                    className={cn(
                      "rounded-md p-1.5 transition-colors disabled:opacity-50",
                      artifact.favorite
                        ? "text-[#D97757] hover:bg-[#FDF1ED]"
                        : "text-[#9C9890] hover:bg-[#F5F3EC] hover:text-[#D97757]"
                    )}
                  >
                    {isPending ? (
                      <span className="block h-4 w-4 animate-pulse rounded-full bg-current opacity-40" />
                    ) : artifact.favorite ? (
                      <Star className="h-4 w-4 fill-current" />
                    ) : (
                      <StarOff className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(artifact)}
                    aria-label="Copy artifact"
                    title="Copy"
                    className="rounded-md p-1.5 text-[#9C9890] transition-colors hover:bg-[#F5F3EC] hover:text-[#D97757]"
                  >
                    {copiedId === artifact.id ? (
                      <Check className="h-4 w-4 text-[#5B8C5A]" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <ArtifactContent artifact={artifact} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArtifactContent({ artifact }: { artifact: AgentArtifact }) {
  const c = artifact.content as Record<string, unknown>;

  if (artifact.type === "video_prompt") {
    return (
      <div className="space-y-2 text-sm">
        {typeof c.mainPrompt === "string" && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9C9890]">Main prompt</div>
            <p className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[#F8F8F7] p-2.5 text-[13px] leading-relaxed text-[#141413]">
              {c.mainPrompt}
            </p>
          </div>
        )}
        {typeof c.negativePrompt === "string" && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9C9890]">Negative prompt</div>
            <p className="mt-0.5 rounded-lg bg-[#F8F8F7] p-2.5 text-[12px] italic text-[#6B6860]">{c.negativePrompt}</p>
          </div>
        )}
      </div>
    );
  }

  if (artifact.type === "research_report" || artifact.type === "summary") {
    return (
      <div className="space-y-2 text-sm">
        {typeof c.summary === "string" && (
          <p className="text-[13px] leading-relaxed text-[#3A3A37]">{c.summary}</p>
        )}
        {Array.isArray(c.opportunities) && c.opportunities.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#5B8C5A]">Opportunities</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[#3A3A37]">
              {(c.opportunities as string[]).slice(0, 4).map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (artifact.type === "shot_list" && Array.isArray(c.shots)) {
    return (
      <ol className="space-y-1.5 text-[12px]">
        {(c.shots as Array<Record<string, unknown>>).slice(0, 5).map((s, i) => (
          <li key={i} className="rounded-lg bg-[#F8F8F7] p-2">
            <div className="font-semibold text-[#141413]">
              {String(s.duration || `Shot ${i + 1}`)} — {String(s.description || "")}
            </div>
            {s.camera ? <div className="text-[#6B6860]">📷 {String(s.camera)}</div> : null}
          </li>
        ))}
      </ol>
    );
  }

  if (artifact.type === "workflow" && Array.isArray(c.steps)) {
    return (
      <ol className="space-y-1 text-[12px]">
        {(c.steps as string[]).map((s, i) => (
          <li key={i} className="flex gap-2 rounded-lg bg-[#F8F8F7] p-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#D97757]/15 text-[11px] font-bold text-[#D97757]">
              {i + 1}
            </span>
            <span className="text-[#3A3A37]">{s}</span>
          </li>
        ))}
      </ol>
    );
  }

  if (artifact.type === "risk_notes" && Array.isArray(c.riskNotes)) {
    return (
      <ul className="space-y-1 text-[12px]">
        {(c.riskNotes as string[]).map((r, i) => (
          <li key={i} className="flex gap-2 rounded-lg bg-[#FDF1ED] p-2 text-[#8A3329]">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (artifact.type === "next_actions" && Array.isArray(c.actions)) {
    return (
      <div className="flex flex-wrap gap-2">
        {(c.actions as Array<Record<string, unknown>>).map((a, i) => (
          <span
            key={i}
            className="rounded-full border border-[#E4E2DD] bg-[#F8F8F7] px-3 py-1 text-[12px] font-medium text-[#3A3A37]"
          >
            {String(a.label || "Action")}
          </span>
        ))}
      </div>
    );
  }

  // 兜底：摘要文本
  const text = artifactToText(artifact);
  return (
    <p className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[#F8F8F7] p-2.5 text-[12px] leading-relaxed text-[#5F5F5B]">
      {text.length > 400 ? text.slice(0, 400) + "…" : text}
    </p>
  );
}
