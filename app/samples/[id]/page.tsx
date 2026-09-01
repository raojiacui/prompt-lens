import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/landing/site-header";
import { SampleProjectDetail } from "@/components/sample-project-detail";
import { PUBLIC_WORKFLOW_SAMPLES } from "@/lib/samples/public-workflow-samples";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const sample = PUBLIC_WORKFLOW_SAMPLES.find((item) => item.id === id);

  return {
    title: `${sample?.title || "样例"} - Prompt Lens`,
    description: "查看公开视频分析项目拆解。",
  };
}

export default async function SampleDetailPage({ params }: Props) {
  const [{ id }, headersList] = await Promise.all([params, headers()]);
  const session = await auth.api.getSession({ headers: headersList }).catch(() => null);

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <SiteHeader user={session?.user ?? null} variant="light" />
      <SampleProjectDetail sampleId={id} />
    </div>
  );
}
