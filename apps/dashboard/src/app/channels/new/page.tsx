import Link from 'next/link';
import { ChannelForm } from '@/components/ChannelForm';
import { createChannel } from '../actions';
import type { AlertChannelType } from '@/lib/api';

const VALID_TYPES: AlertChannelType[] = ['slack', 'discord', 'webhook'];

export default function NewChannelPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const type = (
    VALID_TYPES.includes(searchParams.type as AlertChannelType)
      ? (searchParams.type as AlertChannelType)
      : null
  );

  if (!type) {
    return (
      <div className="max-w-2xl">
        <Link href="/channels" className="text-sm text-argus-accent hover:underline">
          ← Back to channels
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">New channel</h1>
        <p className="mt-1 text-sm text-argus-muted">Pick a channel type to continue.</p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ChannelTypeCard
            href="/channels/new?type=slack"
            title="Slack"
            description="Incoming webhook to a Slack channel. Mrkdwn body."
          />
          <ChannelTypeCard
            href="/channels/new?type=discord"
            title="Discord"
            description="Incoming webhook with embed body."
          />
          <ChannelTypeCard
            href="/channels/new?type=webhook"
            title="Generic webhook"
            description="HMAC-signed JSON POST to any URL. For Zapier / n8n / custom backends."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link href="/channels/new" className="text-sm text-argus-accent hover:underline">
        ← Back to type picker
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        New {type} channel
      </h1>
      <div className="mt-6 rounded border border-argus-border bg-argus-panel p-6">
        <ChannelForm initialType={type} action={createChannel} submitLabel="Create channel" />
      </div>
    </div>
  );
}

function ChannelTypeCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded border border-argus-border bg-argus-panel p-4 transition hover:border-argus-accent/40"
    >
      <div className="font-medium text-slate-100">{title}</div>
      <p className="mt-1 text-xs text-argus-muted">{description}</p>
    </Link>
  );
}
