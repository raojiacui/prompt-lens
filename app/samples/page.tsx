import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/landing/site-header";
import { SamplesGallery } from "@/components/samples-gallery";

export const metadata: Metadata = {
  title: "样例 - Prompt Lens",
  description: "查看公开视频分析项目样例。",
};

export default async function SamplesPage() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList }).catch(() => null);

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <SiteHeader user={session?.user ?? null} variant="light" />
      <SamplesGallery />
    </div>
  );
}
