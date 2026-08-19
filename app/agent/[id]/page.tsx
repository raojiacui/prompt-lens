import { AgentChatPage } from "@/components/agent/agent-chat-page";

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function AgentRunChatRoute({ params }: PageProps) {
  const { id } = await params;
  return <AgentChatPage runId={id} />;
}