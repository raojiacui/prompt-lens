"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const testimonials = [
  { quote: "Prompt Lens turned our reference videos into Sora-ready prompts and saved us hours of trial and error.", name: "Alex Chen", role: "AI Video Creator", avatar: "/avatars/face-1.jpg" },
  { quote: "The audio-to-prompt feature is a game changer for music videos and ads where rhythm needs to match the visuals.", name: "Jordan Lee", role: "Independent Filmmaker", avatar: "/avatars/face-2.jpg" },
  { quote: "Since the team started managing prompt templates in Prompt Lens, our brand videos have become much more consistent.", name: "Sam Taylor", role: "Creative Director", avatar: "/avatars/face-3.jpg" },
  { quote: "I love how fast it extracts structured prompts from any AI video. My workflow feels 10x smoother.", name: "Mia Rodriguez", role: "Motion Designer", avatar: "/avatars/face-4.jpg" },
  { quote: "Finally a tool that understands AI video references and turns them into reusable creative direction.", name: "Noah Kim", role: "Content Strategist", avatar: "/avatars/face-5.jpg" },
  { quote: "The video generation integration is seamless. From prompt to preview in just a few clicks.", name: "Emma Wilson", role: "Digital Marketer", avatar: "/avatars/face-6.jpg" },
  { quote: "We use Prompt Lens daily to reverse-engineer top-performing AI clips and adapt them for our clients.", name: "Liam Brown", role: "Agency Producer", avatar: "/avatars/face-7.jpg" },
  { quote: "Being able to transcribe audio and instantly turn dialogue into visual prompts is pure magic.", name: "Olivia Davis", role: "Video Editor", avatar: "/avatars/face-8.jpg" },
  { quote: "Prompt Lens helped me build a personal prompt library that I can reuse across every project.", name: "Ethan Miller", role: "Solo Creator", avatar: "/avatars/face-9.jpg" },
  { quote: "The analysis depth settings let me choose quick summaries or detailed shot lists exactly when I need them.", name: "Ava Garcia", role: "AI Artist", avatar: "/avatars/face-10.jpg" },
  { quote: "Our whole studio now shares prompts through Prompt Lens. Collaboration has never been this easy.", name: "William Martinez", role: "Studio Lead", avatar: "/avatars/face-11.jpg" },
  { quote: "I was surprised by how accurately it captures camera movement, lighting, and mood from a single clip.", name: "Sophia Anderson", role: "Cinematographer", avatar: "/avatars/face-12.jpg" },
  { quote: "A must-have for anyone building AI video pipelines at scale.", name: "James Thomas", role: "Product Manager", avatar: "/avatars/face-13.jpg" },
  { quote: "The interface is clean and the results are immediate. It fits perfectly into my iterative creative process.", name: "Isabella Jackson", role: "Brand Designer", avatar: "/avatars/face-14.jpg" },
  { quote: "I generate dozens of variations a week. Prompt Lens keeps every prompt organized and reusable.", name: "Benjamin White", role: "Generative Artist", avatar: "/avatars/face-15.jpg" },
  { quote: "It bridges the gap between reference and output better than any other tool we have tried.", name: "Charlotte Harris", role: "Art Director", avatar: "/avatars/face-16.jpg" },
  { quote: "Audio analysis turned hours of manual transcription into minutes of actionable insight.", name: "Lucas Martin", role: "Podcast Producer", avatar: "/avatars/face-17.jpg" },
  { quote: "Prompt Lens is the missing link between inspiration and final render.", name: "Amelia Thompson", role: "3D Animator", avatar: "/avatars/face-18.jpg" },
  { quote: "I recommend it to every creator who wants tighter control over their AI video outputs.", name: "Henry Robinson", role: "YouTuber", avatar: "/avatars/face-19.jpg" },
  { quote: "The history and export features make it simple to document and refine prompts over time.", name: "Evelyn Clark", role: "Creative Technologist", avatar: "/avatars/face-20.jpg" },
];

function StarRating() {
  return (
    <div className="flex gap-1 mb-4">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className="w-4 h-4 text-[var(--color-text-primary)]"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

export function TestimonialsSection() {
  const t = useTranslations("home");
  const [cardWidth, setCardWidth] = useState(45);
  const [activeIndex, setActiveIndex] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  // Clone last and first items for an infinite center-focused loop.
  const displayItems = [
    testimonials[testimonials.length - 1],
    ...testimonials,
    testimonials[0],
  ];

  const updateCardWidth = useCallback(() => {
    if (window.innerWidth < 768) setCardWidth(85);
    else if (window.innerWidth < 1024) setCardWidth(65);
    else setCardWidth(45);
  }, []);

  useEffect(() => {
    updateCardWidth();
    window.addEventListener("resize", updateCardWidth);
    return () => window.removeEventListener("resize", updateCardWidth);
  }, [updateCardWidth]);

  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setActiveIndex((prev) => prev + 1);
    }, 6000);
    return () => clearInterval(interval);
  }, [isPaused]);

  useEffect(() => {
    if (activeIndex === displayItems.length - 1) {
      const timeout = setTimeout(() => {
        setIsTransitioning(false);
        setActiveIndex(1);
      }, 700);
      return () => clearTimeout(timeout);
    }
    if (activeIndex === 0) {
      const timeout = setTimeout(() => {
        setIsTransitioning(false);
        setActiveIndex(displayItems.length - 2);
      }, 700);
      return () => clearTimeout(timeout);
    }
    if (!isTransitioning) {
      const timeout = setTimeout(() => setIsTransitioning(true), 50);
      return () => clearTimeout(timeout);
    }
  }, [activeIndex, displayItems.length, isTransitioning]);

  const translateX = 50 - activeIndex * cardWidth - cardWidth / 2;

  const goPrev = () => setActiveIndex((prev) => prev - 1);
  const goNext = () => setActiveIndex((prev) => prev + 1);

  return (
    <section id="testimonials" className="py-16 md:py-24 lg:py-32 bg-[#F2EBE0]/50 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
            {t("testimonialsTag")}
          </p>
          <h2 className="text-3xl md:text-4xl font-normal font-serif-display text-[var(--color-text-primary)]">
            {t("testimonialsTitle")}
          </h2>
        </div>
      </div>

      <div
        className="relative w-screen left-1/2 -translate-x-1/2"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "flex",
              isTransitioning && "transition-transform duration-700 ease-out"
            )}
            style={{ transform: `translateX(${translateX}%)` }}
          >
            {displayItems.map((item, i) => {
              const isActive = i === activeIndex;
              return (
                <div
                  key={`${item.name}-${i}`}
                  className={cn(
                    "flex-shrink-0 px-3 transition-all duration-700",
                    isActive ? "scale-100 opacity-100 z-10" : "scale-95 opacity-60"
                  )}
                  style={{ width: `${cardWidth}%` }}
                >
                  <div className="bg-[var(--color-bg-raised)] rounded-2xl p-6 md:p-8 border border-[var(--color-border-subtle)] h-full">
                    <StarRating />
                    <blockquote className="text-[var(--color-text-secondary)] mb-6 leading-relaxed">
                      "{item.quote}"
                    </blockquote>
                    <div className="flex items-center gap-3">
                      <img
                        src={item.avatar}
                        alt={item.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      <div>
                        <p className="font-medium text-[var(--color-text-primary)]">{item.name}</p>
                        <p className="text-sm text-[var(--color-text-secondary)]">{item.role}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            type="button"
            onClick={goPrev}
            className="w-11 h-11 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-raised)] text-[var(--color-text-secondary)] flex items-center justify-center hover:bg-[#F5EDE2] transition-colors"
            aria-label="Previous testimonial"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="w-11 h-11 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-raised)] text-[var(--color-text-secondary)] flex items-center justify-center hover:bg-[#F5EDE2] transition-colors"
            aria-label="Next testimonial"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>
  );
}
