import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { PromptInputDemo } from "@/components/landing/prompt-input-demo";
import { FeaturesSection } from "@/components/landing/features-section";
import { AdvantagesSection } from "@/components/landing/advantages-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import { FAQSection } from "@/components/landing/faq-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { CTASection } from "@/components/landing/cta-section";
import { SiteFooter } from "@/components/landing/site-footer";

export default async function HomePage() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList }).catch(() => null);
  const isAuthenticated = !!session?.user;

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <SiteHeader user={session?.user ?? null} />
      <main>
        <HeroSection isAuthenticated={isAuthenticated} />
        <PromptInputDemo />
        <FeaturesSection />
        <AdvantagesSection />
        <HowItWorksSection isAuthenticated={isAuthenticated} />
        <TestimonialsSection />
        <FAQSection />
        <PricingSection isAuthenticated={isAuthenticated} />
        <CTASection isAuthenticated={isAuthenticated} />
      </main>
      <SiteFooter />
    </div>
  );
}
