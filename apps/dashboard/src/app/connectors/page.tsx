import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function ConnectorsPage() {
  return (
    <StubPage
      href="/connectors"
      title="Connectors"
      subtitle="Knowledge and message sources — Postgres, Notion, Drive, Gmail, WhatsApp, etc."
      milestone="M5"
      body="Each connector lands as a card with status pill (Connected / Connecting / Available), last sync time, and Configure / Test buttons. Argus crawls schemas where it can and surfaces them as knowledge."
    />
  );
}
