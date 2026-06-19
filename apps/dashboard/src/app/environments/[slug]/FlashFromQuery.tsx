'use client';

import { useSearchParams } from 'next/navigation';

const MESSAGES: Record<string, { text: string; tone: 'ok' }> = {
  saved: { text: 'Changes saved.', tone: 'ok' },
  created: { text: 'Environment created.', tone: 'ok' },
};

export function FlashFromQuery() {
  const sp = useSearchParams();
  const code = sp.get('ok');
  if (!code) return null;
  const m = MESSAGES[code];
  if (!m) return null;
  return (
    <div className="mt-4 text-sm text-emerald bg-emerald/10 border border-emerald/30 rounded-md px-3 py-2">
      {m.text}
    </div>
  );
}
