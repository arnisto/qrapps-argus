import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function SettingsPage() {
  return (
    <StubPage
      href="/settings"
      title="Settings"
      subtitle="Org-level: name, owner, default env, retention, guardrail enforcement. Per-user: profile, password, sessions."
      milestone="M6"
      body="Org tab + Account tab + Security (active sessions). All values shown as Mono pills so it's clear what's a current value vs. a default. Guardrail toggles show their enforced state inline."
    />
  );
}
