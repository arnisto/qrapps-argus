import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function DeveloperApiPage() {
  return (
    <StubPage
      href="/developer-api"
      title="Developer API"
      subtitle="OpenAI-compatible chat completions with grounded citations injected — drop into any client by swapping baseURL."
      milestone="M5"
      body="ak_live_… keys (shown once, sha256-hashed at rest), per-env base URL, cURL / Python / JavaScript quickstarts side-by-side with the grounded JSON response shape including argus_citations[]."
    />
  );
}
