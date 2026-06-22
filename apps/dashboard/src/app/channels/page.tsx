import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function ChannelsPage() {
  return (
    <StubPage
      href="/channels"
      title="Channels"
      subtitle="Where replies go: WhatsApp Business, Instagram DM, Email, Slack, plus the approval surfaces themselves."
      milestone="M6"
      body="Each channel is a card with its own connect/configure flow. The 'Approval required' callout is permanent — nothing fires outbound without a human green-light unless you flip the env into auto-pilot."
    />
  );
}
