import Link from 'next/link';
import { AcceptInviteForm } from './AcceptInviteForm';
import { BrandMark } from '@/components/shell/icons';
import { getMeServerSide } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

interface InvitePreview {
  invited_email: string;
  role: 'owner' | 'admin' | 'member';
  org: { slug: string; name: string };
  invited_by_email: string | null;
  expires_at: string;
}

const API_BASE = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

async function preview(token: string): Promise<
  | { ok: true; data: InvitePreview }
  | { ok: false; code: 'invitation_not_found' | 'expired' | 'already_accepted' }
> {
  const res = await fetch(
    `${API_BASE}/invitations/${encodeURIComponent(token)}`,
    { cache: 'no-store' },
  );
  if (res.ok) return { ok: true, data: (await res.json()) as InvitePreview };
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return { ok: false, code: (data?.error as 'expired') ?? 'invitation_not_found' };
}

export default async function InvitePage({
  params,
}: {
  params: { token: string };
}) {
  const result = await preview(params.token);
  const me = await getMeServerSide();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-bg text-text">
      <header className="px-5 sm:px-8 py-5">
        <Link href="/" className="inline-flex items-center gap-2 text-text">
          <BrandMark size={22} />
          <span className="font-semibold tracking-tight">Argus</span>
        </Link>
      </header>
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 pb-12">
        <div className="w-full max-w-[460px]">
          {!result.ok ? (
            <ErrorCard code={result.code} />
          ) : (
            <AcceptInviteForm
              token={params.token}
              invite={result.data}
              currentUser={
                me
                  ? { email: me.user.email, name: me.user.name }
                  : null
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}

function ErrorCard({
  code,
}: {
  code: 'invitation_not_found' | 'expired' | 'already_accepted';
}) {
  const COPY: Record<typeof code, { title: string; body: string }> = {
    invitation_not_found: {
      title: 'Invite link not found',
      body: "This link doesn't match a known invitation. It may have been mistyped or revoked.",
    },
    expired: {
      title: 'Invite expired',
      body: 'This invitation expired. Ask whoever sent it to send a fresh one — links are valid for 14 days.',
    },
    already_accepted: {
      title: 'Already used',
      body: 'This invitation has already been accepted. If that wasn’t you, sign in to your account and check Settings → Security for active sessions.',
    },
  };
  const m = COPY[code];
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-7 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">{m.title}</h1>
      <p className="text-text-2 text-sm mt-2 leading-relaxed">{m.body}</p>
      <Link
        href="/signin"
        className="inline-block mt-5 rounded-md bg-accent text-white font-semibold px-3.5 py-2 text-sm hover:opacity-90 transition"
      >
        Sign in to Argus
      </Link>
    </div>
  );
}
