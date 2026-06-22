import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function AuditPage() {
  return (
    <StubPage
      href="/audit"
      title="Audit log"
      subtitle="Append-only · immutable. Every approve / answer / draft / ask / edit / escalate / reject, with actor + model + cost."
      milestone="M6"
      body="Columns: When (Mono) · Actor · Action chip · Detail · Model. The 'append-only · immutable' badge is real — no UPDATE / DELETE paths in code, surface-level enforced by a trigger on the table."
    />
  );
}
