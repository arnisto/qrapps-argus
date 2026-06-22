import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function SecurityPage() {
  return (
    <StubPage
      href="/security"
      title="Security"
      subtitle="Inbound + outbound interceptors. PII redaction, prompt-injection guards, jailbreak detection, hold-for-review."
      milestone="M6"
      body="Five inbound rules (Block / Sanitize / Flag / Tag) and five outbound rules (Redact / Block / Hold / Flag), each with a toggle and a 'caught N this week' counter so you can see what's working."
    />
  );
}
