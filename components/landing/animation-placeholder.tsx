"use client";

interface AnimationPlaceholderProps {
  label?: string;
  className?: string;
}

export function AnimationPlaceholder({ label, className = "" }: AnimationPlaceholderProps) {
  return (
    <div
      className={`relative rounded-2xl border-2 border-dashed border-[#D8D5CC] bg-[#F5F3EC]/60 flex items-center justify-center overflow-hidden ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#F5F3EC] to-transparent" />
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-1/4 left-1/4 w-1/2 h-1/2 rounded-full bg-[#D97757]/10 blur-2xl" />
        <div className="absolute bottom-1/4 right-1/4 w-1/3 h-1/3 rounded-full bg-[#6A9BCC]/10 blur-2xl" />
      </div>
      <div className="relative text-center px-6">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-[#D8D5CC]/50 flex items-center justify-center">
          <svg
            className="w-6 h-6 text-[#9C9890]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
            />
          </svg>
        </div>
        <p className="text-sm text-[#9C9890]">{label || "动画占位"}</p>
      </div>
    </div>
  );
}
