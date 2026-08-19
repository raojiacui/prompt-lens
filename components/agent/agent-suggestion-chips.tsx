"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  suggestions: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
  variant?: "default" | "overlay";
}

export function AgentSuggestionChips({ suggestions, onPick, disabled, variant = "default" }: Props) {
  const visibleSuggestions = suggestions.slice(0, 4);

  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-2 px-0 pb-0 pt-3 sm:grid-cols-2">
      {visibleSuggestions.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          onClick={() => onPick(s)}
          className={cn(
            "inline-flex min-h-8 w-full items-center gap-2 rounded-full px-3 py-1 text-left text-[11px] font-semibold leading-tight shadow-sm backdrop-blur-sm transition-all focus-visible:shadow-none sm:min-h-8 sm:px-3 md:text-xs",
            variant === "overlay"
              ? "border border-white/10 bg-[#7D705E]/80 text-white shadow-[0_8px_18px_rgba(22,18,12,0.16)] hover:-translate-y-0.5 hover:bg-[#756850]/90 hover:shadow-[0_10px_22px_rgba(22,18,12,0.2)] focus-visible:ring-2 focus-visible:ring-white/35"
              : "border border-[#D8D5CC]/80 bg-[#7D705E]/80 text-white shadow-[0_8px_18px_rgba(22,18,12,0.12)] hover:-translate-y-0.5 hover:bg-[#756850]/90 hover:shadow-[0_10px_22px_rgba(22,18,12,0.16)] focus-visible:ring-2 focus-visible:ring-[#141413]/20",
            "disabled:pointer-events-none disabled:opacity-50"
          )}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 fill-white text-white" />
          <span className="min-w-0 truncate">{s}</span>
        </button>
      ))}
    </div>
  );
}
