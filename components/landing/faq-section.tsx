"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Minus } from "lucide-react";

const faqKeys = ["faq1", "faq2", "faq3", "faq4", "faq5"] as const;

export function FAQSection() {
  const t = useTranslations("home");
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section id="faq" className="py-16 md:py-24 lg:py-32 bg-[var(--color-bg-base)]">
      <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          <div className="lg:col-span-4">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
              {t("faqTag")}
            </p>
            <h2 className="text-3xl md:text-4xl font-normal font-serif-display text-[var(--color-text-primary)]">
              {t("faqTitle")}
            </h2>
          </div>

          <div className="lg:col-span-8 space-y-0">
            {faqKeys.map((key, index) => {
              const isOpen = openIndex === index;
              return (
                <div
                  key={key}
                  className="border-b border-[var(--color-border-subtle)]"
                >
                  <button
                    className="w-full flex items-center justify-between py-5 text-left group"
                    onClick={() => setOpenIndex(isOpen ? -1 : index)}
                    aria-expanded={isOpen}
                  >
                    <span className="text-base md:text-lg font-medium text-[var(--color-text-primary)] pr-4">
                      {t(`${key}Q`)}
                    </span>
                    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#EDE5D8] text-[var(--color-text-secondary)] flex items-center justify-center group-hover:bg-[#E0D6C6] transition-colors">
                      {isOpen ? (
                        <Minus className="w-4 h-4" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </span>
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ${
                      isOpen ? "max-h-96 opacity-100 pb-5" : "max-h-0 opacity-0"
                    }`}
                  >
                    <p className="text-[var(--color-text-secondary)] leading-relaxed">
                      {t(`${key}A`)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
