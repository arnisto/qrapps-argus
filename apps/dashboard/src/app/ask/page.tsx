import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function AskPage() {
  return (
    <StubPage
      href="/ask"
      title="Ask Argus"
      subtitle="Your company brain — grounded answers with citations from the knowledge core."
      milestone="M5"
      body="Streaming chat backed by /v1/chat/completions on your active environment. Every answer carries source chips you can click; ungrounded questions surface the gap so the team can fill it via Interview."
    />
  );
}
