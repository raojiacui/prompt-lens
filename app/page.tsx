"use client";

import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { PromptInputDemo } from "@/components/landing/prompt-input-demo";
import { FeaturesSection } from "@/components/landing/features-section";
import { AdvantagesSection } from "@/components/landing/advantages-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import { FAQSection } from "@/components/landing/faq-section";
import { CTASection } from "@/components/landing/cta-section";
import { SiteFooter } from "@/components/landing/site-footer";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <SiteHeader />
      <main>
        <HeroSection />
        <PromptInputDemo />
        <FeaturesSection />
        <AdvantagesSection />
        <HowItWorksSection />
        <TestimonialsSection />
        <FAQSection />
        <CTASection />
      </main>
      <SiteFooter />
    </div>
  );
}
