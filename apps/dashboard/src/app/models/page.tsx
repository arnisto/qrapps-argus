import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function ModelsPage() {
  return (
    <StubPage
      href="/models"
      title="Models"
      subtitle="The LLM Gateway. Connect Gemini, OpenAI, Claude, Groq, or local Ollama and route per role (Classifier / Drafter / Embeddings / Fallback)."
      milestone="M5"
      body="Per-env model registry stored in the providers table with AES-GCM-encrypted keys. Default routing per role is editable inline; multi-model routing (failover, A/B) is a Pro feature flag."
    />
  );
}
