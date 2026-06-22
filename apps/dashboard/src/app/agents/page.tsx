import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function AgentsPage() {
  return (
    <StubPage
      href="/agents"
      title="Agents & tools"
      subtitle="The pipeline behind every reply: Classify → Retrieve → Draft → Approve · human → Send."
      milestone="M6"
      body="Each agent step has its own model + tools + WHEN-fires rules. Approve · human is the load-bearing safety stop. Tools (DB read, web fetch, search, etc.) carry their own permission gates."
    />
  );
}
