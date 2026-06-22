import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function KnowledgePage() {
  return (
    <StubPage
      href="/knowledge"
      title="Knowledge core"
      subtitle="Every fact Argus knows, where it came from, when it was last refreshed."
      milestone="M5"
      body="Cards per fact-type, recent facts list with source / time / confidence in Mono, and a freshness bar chart (Fresh / Aging / Stale) so you know what's drifting before the model relies on it."
    />
  );
}
