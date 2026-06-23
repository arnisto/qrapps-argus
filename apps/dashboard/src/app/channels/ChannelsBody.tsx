'use client';

import { Marketplace } from '@/components/marketplace/Marketplace';
import type { CatalogEntry, ConnectedRow } from '@/lib/connectors-server';

/**
 * Channels-specific wiring of the shared <Marketplace> primitive.
 *
 * Filter chips are tag-based here ("Outbound", "Inbound") instead of
 * kind-based — every entry on this page is kind='channel'; what
 * matters to the operator is the direction of traffic.
 *
 * Per-subtype card actions:
 *   · slack → "Send test message" — calls /test-send to post a Block-Kit
 *             "Argus connected ✓" card to the default channel.
 */
export function ChannelsBody({
  envSlug,
  catalog,
  connected,
}: {
  envSlug: string;
  catalog: CatalogEntry[];
  connected: ConnectedRow[];
}) {
  return (
    <Marketplace
      envSlug={envSlug}
      catalog={catalog}
      connected={connected}
      searchPlaceholder="Search channels — slack, email, sms…"
      connectedHeadline="Connected channels"
      kindFilters={[
        { value: 'all', label: 'All', matches: () => true },
        {
          value: 'outbound',
          label: 'Outbound',
          matches: (e) => e.tags.includes('outbound') || e.tags.includes('send'),
        },
        {
          value: 'inbound',
          label: 'Inbound',
          matches: (e) => e.tags.includes('inbound'),
        },
      ]}
      cardActions={{
        slack: [
          {
            label: 'Send test',
            tone: 'primary',
            onAct: async (row) => {
              const res = await fetch(
                `/be/envs/${encodeURIComponent(envSlug)}/env-connectors/${row.id}/test-send`,
                { method: 'POST', credentials: 'include' },
              );
              if (!res.ok) {
                const data = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(data?.error ?? `HTTP ${res.status}`);
              }
            },
          },
        ],
      }}
    />
  );
}
