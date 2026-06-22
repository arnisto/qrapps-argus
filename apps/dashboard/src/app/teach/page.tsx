import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function TeachPage() {
  return (
    <StubPage
      href="/teach"
      title="Teach Argus"
      subtitle="Drop files into the knowledge core or answer questions to fill gaps."
      milestone="M5"
      body="Two cards side-by-side: file upload (dashed dropzone, PDF / MD / TXT / HTML) and answered Q&A. Each chunk is embedded with gemini-embedding-001 (768d) and indexed into the per-env chunks table with HNSW cosine ANN."
    />
  );
}
