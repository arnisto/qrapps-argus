import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function PipelinesPage() {
  return (
    <StubPage
      href="/pipelines"
      title="Pipelines"
      subtitle="Kanban view of tickets moving through your team's stages — Marketing, Sales, RH, or custom."
      milestone="M6"
      body="Each ticket carries a priority dot, source pill, and Argus's read on whether it's ready to advance. Auto-pilot toggle promotes tickets without you when Argus is confident."
    />
  );
}
