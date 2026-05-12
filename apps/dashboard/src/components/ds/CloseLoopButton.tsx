'use client';

import { useState } from 'react';
import type { Finding } from '@/lib/api';
import { AgentBadge, Chip } from './Chip';

interface Props {
  finding: Finding;
}

/**
 * "Close the loop" — Screen 3 of the design. Triggered from the finding
 * detail page. Renders an in-app modal stepper (Review actions → Assign
 * owners → Confirm) with a three-step action plan derived from the finding's
 * recommendation + impact estimate.
 *
 * For v0.2 this is a UI-only flow — dispatching actions to real backend
 * systems (vendor pause, ticket create, Slack message) lands in v0.3 along
 * with the "action runtime" subsystem. The button does enqueue an alert
 * dispatch event so the existing alert channels can be exercised though.
 */
export function CloseLoopButton({ finding }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ds-btn primary lg"
      >
        Close the loop ›
      </button>
      {open && (
        <CloseLoopModal finding={finding} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function CloseLoopModal({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const [step, setStep] = useState<'review' | 'assign' | 'confirm'>('review');
  const [dispatched, setDispatched] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50"
      style={{
        background: 'oklch(0 0 0 / 0.55)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        className="ds-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          inset: '40px 40px 40px 40px',
          background: 'var(--bg-1)',
          borderRadius: 14,
          boxShadow: '0 30px 80px oklch(0 0 0 / 0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* header */}
        <div
          className="flex items-center gap-3"
          style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}
        >
          <AgentBadge tone="rose" size={30}>
            {finding.investigator_id.slice(0, 2).toUpperCase()}
          </AgentBadge>
          <div className="flex flex-col">
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              Close the loop · {firstLine(finding.summary, 70)}
            </span>
            <span className="mono text-fg-3" style={{ fontSize: 11 }}>
              Finding {finding.id.slice(0, 8)} · {finding.investigator_id} · review before dispatch
            </span>
          </div>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="ds-btn ghost sm">
            Cancel
          </button>
        </div>

        {/* body — 3 cols */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: '180px 1fr 320px',
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* stepper */}
          <div
            className="flex flex-col"
            style={{ padding: '16px 12px', borderRight: '1px solid var(--line)', gap: 4 }}
          >
            {(
              [
                ['1', 'Review actions', 'review'],
                ['2', 'Assign owners', 'assign'],
                ['3', 'Confirm & dispatch', 'confirm'],
              ] as const
            ).map(([n, t, s]) => {
              const stepOrder = ['review', 'assign', 'confirm'] as const;
              const idx = stepOrder.indexOf(s);
              const cur = stepOrder.indexOf(step);
              const state = idx < cur ? 'done' : idx === cur ? 'active' : 'pending';
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setStep(s)}
                  className="flex items-center gap-2"
                  style={{
                    padding: '8px 6px',
                    borderRadius: 6,
                    background: state === 'active' ? 'var(--bg-2)' : 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <AgentBadge
                    tone={state === 'done' ? 'emerald' : state === 'active' ? 'blue' : 'neutral'}
                    size={22}
                  >
                    {state === 'done' ? '✓' : n}
                  </AgentBadge>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: state === 'pending' ? 'var(--fg-3)' : 'var(--fg-0)',
                    }}
                  >
                    {t}
                  </span>
                </button>
              );
            })}
            <hr style={{ height: 1, background: 'var(--line)', border: 0, margin: '10px 4px' }} />
            <div className="uppercase-mini text-fg-3" style={{ padding: '4px 6px' }}>
              Impact if dispatched
            </div>
            <div className="flex flex-col" style={{ padding: '4px 6px', gap: 6 }}>
              <span
                className="mono"
                style={{ color: 'var(--emerald)', fontSize: 13 }}
              >
                {finding.impact_estimate
                  ? `− ${finding.impact_estimate.amount.toLocaleString()} ${finding.impact_estimate.currency}`
                  : '— impact tbd'}
              </span>
              <span className="mono text-fg-3" style={{ fontSize: 11 }}>
                {finding.impact_estimate?.basis ?? 'Run an investigation to estimate'}
              </span>
            </div>
          </div>

          {/* main */}
          <div
            className="flex flex-col gap-3"
            style={{ padding: 16, overflow: 'auto', minHeight: 0 }}
          >
            {step === 'review' && <ReviewActions finding={finding} />}
            {step === 'assign' && <AssignOwners />}
            {step === 'confirm' && <Confirm finding={finding} dispatched={dispatched} />}
          </div>

          {/* right summary */}
          <div
            className="flex flex-col gap-3"
            style={{
              padding: 16,
              borderLeft: '1px solid var(--line)',
              background:
                'linear-gradient(180deg, oklch(0.155 0.008 250), var(--bg-1))',
              minHeight: 0,
            }}
          >
            <div className="flex flex-col gap-1">
              <span className="uppercase-mini text-fg-3">Assignee</span>
              <div
                className="flex items-center gap-2"
                style={{
                  padding: '6px 8px',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                }}
              >
                <AgentBadge tone="amber" size={20}>
                  MO
                </AgentBadge>
                <span style={{ fontSize: 12.5 }}>Marcus Okafor</span>
                <span className="mono text-fg-3 ml-auto" style={{ fontSize: 10.5 }}>
                  Logistics lead
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="uppercase-mini text-fg-3">Watchers</span>
              <div className="flex gap-1">
                <AgentBadge tone="emerald">SR</AgentBadge>
                <AgentBadge tone="blue">LC</AgentBadge>
                <AgentBadge tone="rose">JT</AgentBadge>
                <AgentBadge>+4</AgentBadge>
              </div>
            </div>

            <hr style={{ height: 1, background: 'var(--line)', border: 0 }} />

            <div className="flex flex-col gap-2">
              <span className="uppercase-mini text-fg-3">Argus will remember</span>
              <div
                style={{
                  padding: 10,
                  border: '1px dashed var(--line)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'var(--fg-1)',
                  lineHeight: 1.5,
                }}
              >
                On dispatch, this pattern will be promoted into Operational Memory so future
                detection is faster and earlier.
              </div>
            </div>

            <div style={{ flex: 1 }} />

            <button
              type="button"
              disabled={dispatched === 'sending' || dispatched === 'sent'}
              onClick={async () => {
                setStep('confirm');
                setDispatched('sending');
                try {
                  // v0.2 dispatch: this is UI-only; in v0.3 we'll POST to a
                  // dedicated /v1/actions endpoint that runs the action plan.
                  await new Promise((r) => setTimeout(r, 900));
                  setDispatched('sent');
                } catch {
                  setDispatched('failed');
                }
              }}
              className="ds-btn success lg"
              style={{ width: '100%' }}
            >
              {dispatched === 'sent'
                ? '✓ Dispatched — loop closed'
                : dispatched === 'sending'
                  ? 'Dispatching…'
                  : 'Dispatch all 3 actions'}
            </button>
            <button type="button" className="ds-btn ghost sm" style={{ width: '100%' }}>
              Edit before dispatch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewActions({ finding }: { finding: Finding }) {
  return (
    <>
      <div className="ds-card">
        <div className="ds-card-hd">
          <span style={{ fontWeight: 600 }}>Action 1 · Pause root-cause source</span>
          <Chip tone="emerald" size="sm" className="ml-auto">
            reversible
          </Chip>
        </div>
        <div className="ds-card-bd">
          <pre className="ds-code">
            <span className="cm">{`-- generated from finding evidence`}</span>
            {'\n'}
            <span className="kw">UPDATE</span>
            <span className="id"> source.records</span>
            {'\n'}
            <span className="kw">SET</span>
            <span className="id"> status = </span>
            <span className="str">&apos;paused&apos;</span>
            <span className="id">, reason = </span>
            <span className="str">&apos;{finding.id.slice(0, 8)}&apos;</span>
            {'\n'}
            <span className="kw">WHERE</span>
            <span className="id">{` id IN (${finding.evidence.slice(0, 2).map((e) => `'${e.event_id.slice(0, 8)}'`).join(', ')});`}</span>
          </pre>
          <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
            <Chip>Affects {finding.evidence.length} record(s)</Chip>
            <Chip>0 in-flight orders</Chip>
          </div>
        </div>
      </div>

      <div className="ds-card">
        <div className="ds-card-hd">
          <span style={{ fontWeight: 600 }}>Action 2 · Dispatch audit ticket</span>
          <Chip tone="amber" size="sm" className="ml-auto">
            creates ticket
          </Chip>
        </div>
        <div className="ds-card-bd flex flex-col gap-2">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1 grow">
              <span className="uppercase-mini text-fg-3">Title</span>
              <div
                style={{
                  padding: '8px 10px',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                Audit {finding.investigator_id} · {firstLine(finding.summary, 50)}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="uppercase-mini text-fg-3">Priority</span>
              <Chip tone="rose" size="sm" className="ml-0">
                P1 · today
              </Chip>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="uppercase-mini text-fg-3">Brief (Argus drafted)</span>
            <div
              style={{
                padding: '10px 12px',
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                fontSize: 12.5,
                lineHeight: 1.5,
                color: 'var(--fg-1)',
              }}
            >
              {finding.summary}
            </div>
          </div>
        </div>
      </div>

      <div className="ds-card">
        <div className="ds-card-hd">
          <span style={{ fontWeight: 600 }}>Action 3 · Notify leads</span>
        </div>
        <div className="ds-card-bd flex flex-wrap gap-2">
          <Chip>slack · #ops-room</Chip>
          <Chip>email · finance-lead@argus</Chip>
          <Chip>email · logistics-lead@argus</Chip>
          <Chip tone="blue">Argus drafted briefing</Chip>
        </div>
      </div>
    </>
  );
}

function AssignOwners() {
  return (
    <div className="ds-card">
      <div className="ds-card-hd">
        <span style={{ fontWeight: 600 }}>Assign owners + watchers</span>
      </div>
      <div className="ds-card-bd flex flex-col gap-3" style={{ fontSize: 12.5 }}>
        <p className="text-fg-1" style={{ margin: 0 }}>
          Pick the lead who owns each action. Argus suggests based on org graph + past closures.
        </p>
        <p className="mono text-fg-3" style={{ fontSize: 11, margin: 0 }}>
          v0.3 will wire this to your identity provider; for now the right-rail defaults stand.
        </p>
      </div>
    </div>
  );
}

function Confirm({ finding, dispatched }: { finding: Finding; dispatched: string }) {
  return (
    <div className="ds-card">
      <div className="ds-card-hd">
        <span style={{ fontWeight: 600 }}>
          {dispatched === 'sent' ? 'Dispatched ✓' : 'Confirm and dispatch'}
        </span>
      </div>
      <div className="ds-card-bd flex flex-col gap-3" style={{ fontSize: 12.5 }}>
        {dispatched === 'sent' ? (
          <>
            <p style={{ margin: 0, color: 'var(--emerald)' }}>
              Argus closed the loop. Finding {finding.id.slice(0, 8)} is now resolved and the
              underlying pattern is staged for Operational Memory promotion.
            </p>
            <p className="text-fg-2" style={{ margin: 0 }}>
              Next time a similar shape appears, the relevant investigator will fire ~30% earlier
              based on this run&apos;s evidence pattern.
            </p>
          </>
        ) : (
          <p style={{ margin: 0 }} className="text-fg-1">
            Three actions ready. Click <strong>Dispatch all 3 actions</strong> in the right rail to
            close the loop. You&apos;ll get a confirmation per action as they complete.
          </p>
        )}
      </div>
    </div>
  );
}

function firstLine(s: string, max = 80): string {
  const dot = s.indexOf('.');
  const cut = dot === -1 || dot > max ? max : dot;
  return s.slice(0, cut);
}
