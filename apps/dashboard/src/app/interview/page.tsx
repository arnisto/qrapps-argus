import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function InterviewPage() {
  return (
    <StubPage
      href="/interview"
      title="Interview"
      subtitle="The loop that fills knowledge gaps: Argus asks the team, the team answers, knowledge updates."
      milestone="M6"
      body="Each gap is a card with status (open / asked / filled / stale), the slot Argus was looking for, and an Ask the team button that posts to your configured Slack / WhatsApp / email so the right person can answer in seconds."
    />
  );
}
