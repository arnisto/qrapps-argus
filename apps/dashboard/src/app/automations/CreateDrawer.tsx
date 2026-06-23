'use client';

import { useEffect, useState } from 'react';

type Freq = 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'hourly' | 'custom';

interface ScheduleState {
  freq: Freq;
  time: string; // 'HH:MM'
  weekday: number; // 0..6 sun..sat (for weekly)
  dayOfMonth: number; // 1..28 (for monthly, capped to safe range)
  customCron: string;
  tz: string;
}

function scheduleToCron(s: ScheduleState): string {
  const parts = s.time.split(':').map((x) => parseInt(x, 10));
  const h = parts[0] !== undefined && !isNaN(parts[0]) ? parts[0] : 9;
  const m = parts[1] !== undefined && !isNaN(parts[1]) ? parts[1] : 0;
  switch (s.freq) {
    case 'hourly':
      return `${m} * * * *`;
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekdays':
      return `${m} ${h} * * 1-5`;
    case 'weekly':
      return `${m} ${h} * * ${s.weekday}`;
    case 'monthly':
      return `${m} ${h} ${s.dayOfMonth} * *`;
    case 'custom':
      return s.customCron;
  }
}

const COMMON_TZ = [
  'UTC',
  'Africa/Tunis',
  'Europe/Paris',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
];

const SUGGESTIONS = [
  'Every Monday 9am Tunis time, pull last week\'s order totals from Postgres and summarise to Slack #leadership.',
  'Every weekday 8am, count new signups in the last 24h and post to Slack #growth.',
  'Every hour, check error rate from postgres connector and alert Slack #ops if it exceeds 5%.',
  'First of every month, email a P&L summary to finance from the billing Postgres.',
];

export function CreateDrawer({
  envSlug,
  onClose,
  onCreated,
}: {
  envSlug: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [schedule, setSchedule] = useState<ScheduleState>({
    freq: 'weekly',
    time: '09:00',
    weekday: 1, // Monday
    dayOfMonth: 1,
    customCron: '0 9 * * 1',
    tz: 'UTC',
  });
  const [useCustomCron, setUseCustomCron] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const cron = useCustomCron ? schedule.customCron : scheduleToCron(schedule);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const create = await fetch(
        `/be/envs/${encodeURIComponent(envSlug)}/automations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: name || 'New automation',
            prompt_text: prompt,
            schedule_cron: cron,
            schedule_tz: schedule.tz,
          }),
        },
      );
      if (!create.ok) {
        const data = (await create.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        setError(data?.message ?? data?.error ?? `HTTP ${create.status}`);
        return;
      }
      const { automation } = (await create.json()) as { automation: { id: string } };
      // Fire-and-forget compile so the operator's first preview is fast.
      void fetch(
        `/be/envs/${encodeURIComponent(envSlug)}/automations/${automation.id}/compile`,
        { method: 'POST', credentials: 'include' },
      );
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40"
        onClick={onClose}
      />
      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[520px] bg-surface z-50 shadow-2xl overflow-y-auto border-l border-border">
        <header className="sticky top-0 z-10 bg-surface border-b border-border px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-text">New automation</div>
            <div className="text-2xs text-text-3 mt-0.5">
              Describe the task. Argus compiles a plan; you preview before activating.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-surface-2 text-text-2 transition flex items-center justify-center"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <form id="create-form" onSubmit={submit} className="px-5 py-4 space-y-5">
          {/* name */}
          <Field label="Name (optional)" hint="Auto-derived from the prompt if blank.">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekly orders summary"
              className="w-full rounded-md bg-surface-2 border border-border px-3 py-2 text-sm outline-none focus:border-accent focus:shadow-focus transition"
            />
          </Field>

          {/* prompt */}
          <Field
            label="Prompt"
            hint="Tell Argus what to do. Reference your connectors by name or subtype."
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              required
              placeholder="Every Monday 9am Tunis time, pull last week's order totals from Postgres and post a summary to Slack #leadership."
              className="w-full rounded-md bg-surface-2 border border-border px-3 py-2 text-sm outline-none focus:border-accent focus:shadow-focus transition resize-y font-mono"
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {SUGGESTIONS.map((s, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => setPrompt(s)}
                  className="text-2xs text-text-2 hover:text-text bg-inset hover:bg-surface-2 px-2 py-1 rounded-sm transition text-left max-w-full truncate"
                >
                  {s.slice(0, 50)}…
                </button>
              ))}
            </div>
          </Field>

          {/* schedule */}
          <Field label="Schedule" hint={`Persists in env timezone. Next runs are previewed below.`}>
            {!useCustomCron ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={schedule.freq}
                    onChange={(e) =>
                      setSchedule((s) => ({ ...s, freq: e.target.value as Freq }))
                    }
                    className="rounded-md bg-surface-2 border border-border px-3 py-2 text-sm outline-none focus:border-accent transition"
                  >
                    <option value="hourly">Every hour</option>
                    <option value="daily">Every day</option>
                    <option value="weekdays">Every weekday</option>
                    <option value="weekly">Every week</option>
                    <option value="monthly">Every month</option>
                  </select>
                  <input
                    type="time"
                    value={schedule.time}
                    onChange={(e) => setSchedule((s) => ({ ...s, time: e.target.value }))}
                    className="rounded-md bg-surface-2 border border-border px-3 py-2 text-sm outline-none focus:border-accent transition"
                  />
                </div>
                {schedule.freq === 'weekly' ? (
                  <select
                    value={schedule.weekday}
                    onChange={(e) =>
                      setSchedule((s) => ({ ...s, weekday: parseInt(e.target.value, 10) }))
                    }
                    className="w-full rounded-md bg-surface-2 border border-border px-3 py-2 text-sm outline-none focus:border-accent transition"
                  >
                    {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                      (d, i) => (
                        <option key={i} value={i}>
                          On {d}
                        </option>
                      ),
                    )}
                  </select>
                ) : null}
                {schedule.freq === 'monthly' ? (
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={schedule.dayOfMonth}
                    onChange={(e) =>
                      setSchedule((s) => ({ ...s, dayOfMonth: parseInt(e.target.value, 10) }))
                    }
                    className="w-full rounded-md bg-surface-2 border border-border px-3 py-2 text-sm outline-none focus:border-accent transition"
                    placeholder="Day of month (1-28)"
                  />
                ) : null}
              </div>
            ) : (
              <input
                type="text"
                value={schedule.customCron}
                onChange={(e) =>
                  setSchedule((s) => ({ ...s, customCron: e.target.value }))
                }
                placeholder="0 9 * * 1"
                className="w-full rounded-md bg-surface-2 border border-border px-3 py-2 text-sm outline-none focus:border-accent transition font-mono"
              />
            )}
            <div className="mt-2 flex items-center gap-3">
              <select
                value={schedule.tz}
                onChange={(e) => setSchedule((s) => ({ ...s, tz: e.target.value }))}
                className="flex-1 rounded-md bg-surface-2 border border-border px-3 py-2 text-2xs font-mono outline-none focus:border-accent transition"
              >
                {COMMON_TZ.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label className="text-2xs flex items-center gap-1.5 text-text-2 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={useCustomCron}
                  onChange={(e) => setUseCustomCron(e.target.checked)}
                  className="rounded"
                />
                Use cron expression
              </label>
            </div>
            <div className="mt-2 font-mono text-2xs text-text-3">
              cron: <span className="text-text-2">{cron}</span>
              <span className="ml-3">tz: {schedule.tz}</span>
            </div>
          </Field>

          {error ? (
            <div className="rounded-md bg-red-soft border border-red/40 text-red text-2xs font-mono p-2.5">
              {error}
            </div>
          ) : null}

          <div className="text-2xs text-text-3 leading-snug">
            Saves as <span className="font-semibold text-text-2">draft</span>. The plan
            compiles in the background. Once it&apos;s ready, click Preview to dry-run
            it (no Slack post fires), then Activate to schedule the first real run.
          </div>
        </form>

        <footer className="sticky bottom-0 z-10 bg-surface border-t border-border px-5 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-text-2 hover:text-text px-3 py-2 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="create-form"
            disabled={submitting || prompt.length < 10}
            className="rounded-md bg-accent text-white text-sm font-semibold px-3 py-2 hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating…' : 'Save draft'}
          </button>
        </footer>
      </aside>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-2xs font-semibold uppercase tracking-wider text-text-2 mb-1">
        {label}
      </label>
      {children}
      {hint ? <div className="text-2xs text-text-3 mt-1">{hint}</div> : null}
    </div>
  );
}
