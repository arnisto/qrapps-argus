import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { getMeServerSide } from '@/lib/auth-server';
import {
  listMembersServerSide,
  listInvitationsServerSide,
} from '@/lib/members-server';
import { InviteForm } from './InviteForm';
import { MembersTable } from './MembersTable';
import { InvitationsTable } from './InvitationsTable';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const me = (await getMeServerSide())!;
  const activeOrg = me.orgs[0]!;
  const data = await listMembersServerSide(activeOrg.slug);
  const invitations = await listInvitationsServerSide(activeOrg.slug);

  return (
    <AppLayout redirectTarget="/members">
      <PageShell
        title="Members"
        subtitle={
          <>
            Who's in <strong>{activeOrg.name}</strong>, plus pending invitations.
            Invite by email; the link is shareable and works for 14 days.
          </>
        }
      >
        {!data ? (
          <div className="rounded-2xl border border-border bg-surface shadow-card p-6 text-sm text-text-2">
            Couldn't load members.
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
              <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-2 border-b border-border pb-3 mb-4">
                Invite a teammate
              </h2>
              <InviteForm orgSlug={activeOrg.slug} yourRole={data.your_role} />
            </section>

            <section className="mt-5 rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
              <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-2 border-b border-border pb-3 mb-4">
                Active members ({data.members.length})
              </h2>
              <MembersTable
                orgSlug={activeOrg.slug}
                members={data.members}
                yourRole={data.your_role}
                yourUserId={me.user.id}
              />
            </section>

            {invitations.length > 0 ? (
              <section className="mt-5 rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
                <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-2 border-b border-border pb-3 mb-4">
                  Pending invitations ({invitations.length})
                </h2>
                <InvitationsTable
                  orgSlug={activeOrg.slug}
                  invitations={invitations}
                  canRevoke={data.your_role !== 'member'}
                />
              </section>
            ) : null}
          </>
        )}
      </PageShell>
    </AppLayout>
  );
}
