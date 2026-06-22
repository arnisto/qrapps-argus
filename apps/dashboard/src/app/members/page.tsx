import { StubPage } from '@/components/shell/StubPage';
export const dynamic = 'force-dynamic';
export default function MembersPage() {
  return (
    <StubPage
      href="/members"
      title="Members"
      subtitle="Who's in this organization, what they do, and which envs they own."
      milestone="M6"
      body="Invite by email, set role (owner / admin / member), assign to environments, see open-ticket counts, and surface skills so Argus can route to the right person."
    />
  );
}
