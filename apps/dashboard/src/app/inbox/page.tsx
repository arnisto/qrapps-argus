import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function InboxPage() {
  return (
    <StubPage
      href="/inbox"
      title="Inbox"
      subtitle="Inbound messages from your channels. Argus drafts grounded replies; you approve before anything sends."
      milestone="M5"
      body="Once we ship M5 you'll see every inbound message here — sender, channel, language, urgency, plus Argus's draft reply with confidence + citations. Approval is one click and nothing sends without it."
    />
  );
}
