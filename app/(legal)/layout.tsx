import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
    <SiteHeader user={null} variant="light" />
    {children}
    <SiteFooter />
  </div>;
}
