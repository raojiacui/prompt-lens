"use client";

import { Trash2, FileVideo, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentAttachment } from "@/lib/agent/types";

interface Props {
  attachments: AgentAttachment[];
  onRemove?: (id: string) => void;
  size?: "sm" | "md";
}

function isImage(att: AgentAttachment) {
  return att.type.startsWith("image/");
}

export function AgentAttachmentPreview({ attachments, onRemove, size = "md" }: Props) {
  if (attachments.length === 0) return null;
  const box = size === "sm" ? "h-20 w-28" : "h-28 w-40";

  return (
    <div className="flex flex-wrap gap-3 px-5 pt-4">
      {attachments.map((att) => (
        <div
          key={att.id}
          className={cn(
            "group relative overflow-hidden rounded-xl border border-[#D8D5CC] bg-white shadow-sm",
            box
          )}
        >
          {isImage(att) && att.dataUrl ? (
            <img src={att.dataUrl} alt={att.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#F7EFE1] text-[#6B6860]">
              {att.type.startsWith("video/") ? (
                <FileVideo className="h-7 w-7" />
              ) : (
                <ImageIcon className="h-7 w-7" />
              )}
              <span className="max-w-[90%] truncate px-2 text-[11px]">{att.name}</span>
              {att.frames && att.frames.length > 0 && (
                <span className="text-[10px] text-[#9C9890]">{att.frames.length} frame(s)</span>
              )}
            </div>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              aria-label={`Remove ${att.name}`}
              className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-[#141413] shadow-sm transition-colors hover:bg-[#D97757] hover:text-white"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
