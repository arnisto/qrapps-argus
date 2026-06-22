import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, type AlertChannel } from '@/lib/api';
import { ChannelForm } from '@/components/ChannelForm';
import { updateChannel, deleteChannel } from '../actions';

export default async function EditChannelPage({ params }: { params: { id: string } }) {
  let channel: AlertChannel;
  try {
    const res = await api<{ alert_channel: AlertChannel }>(`/v1/alert-channels/${params.id}`);
    channel = res.alert_channel;
  } catch {
    return notFound();
  }

  return (
    <div className="max-w-3xl">
      <Link href="/channels" className="text-sm text-argus-accent hover:underline">
        ← Back to channels
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{channel.name}</h1>
      <p className="mt-1 font-mono text-xs text-argus-muted">
        {channel.id} · {channel.type}
      </p>

      <div className="mt-6 rounded border border-argus-border bg-argus-panel p-6">
        <ChannelForm
          initial={channel}
          action={updateChannel.bind(null, channel.id)}
          submitLabel="Save changes"
        />
      </div>

      <form
        action={deleteChannel.bind(null, channel.id)}
        className="mt-6 rounded border border-argus-danger/40 bg-argus-panel p-4"
      >
        <p className="text-sm text-slate-300">
          Delete this channel. Cascades to dispatched-alert rows. Investigators that reference it
          will silently skip (the dispatcher logs <code>alert.channel.missing_or_disabled</code>).
        </p>
        <button
          type="submit"
          className="mt-3 rounded border border-argus-danger px-3 py-1.5 text-sm text-argus-danger hover:bg-argus-danger/10"
        >
          Delete channel
        </button>
      </form>
    </div>
  );
}
