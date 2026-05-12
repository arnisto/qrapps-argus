import { Card } from '@/components/ds/Card';
import { Chip } from '@/components/ds/Chip';
import { BigMemoryGraph } from '@/components/ds/BigMemoryGraph';

/**
 * Memory explorer — Screen 5 of the design. Operational graph on the left
 * with a node-detail sidebar on the right. v0.2 ships this as a static
 * presentation of what Operational Memory will look like once the runtime
 * subsystem lands in v0.3.
 *
 * Roadmap:
 *  - v0.3 adds a `memory_nodes` table and a "promote pattern" mechanic that
 *    fires when an investigator closes a loop (the "Argus will remember"
 *    footer in Close-the-loop hints at this).
 *  - v0.4 hooks the graph to a vector index so investigators can query
 *    "have we seen this pattern before?".
 */
export default function MemoryPage() {
  return (
    <>
      {/* breadcrumb + tabs */}
      <div
        className="flex items-center gap-3"
        style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', fontSize: 12 }}
      >
        <span className="text-fg-3">Memory</span>
        <span className="text-fg-3">›</span>
        <span className="font-medium">Operational graph</span>
        <Chip tone="blue" size="sm" className="ml-1.5">
          v12 · improving
        </Chip>
        <div className="flex-1" />
        <div className="ds-tabs">
          <span className="ds-tab active">Graph</span>
          <span className="ds-tab">Timeline</span>
          <span className="ds-tab">Rules</span>
        </div>
        <button type="button" className="ds-btn sm">
          Export memory…
        </button>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr 360px',
          minHeight: 'calc(100vh - 120px)',
        }}
      >
        {/* canvas */}
        <div
          style={{
            position: 'relative',
            background: 'linear-gradient(180deg, oklch(0.155 0.008 250), var(--bg-0))',
            borderRight: '1px solid var(--line)',
          }}
        >
          <BigMemoryGraph />
          {/* legend */}
          <div
            style={{
              position: 'absolute',
              left: 16,
              bottom: 16,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              padding: '6px 10px',
              background: 'color-mix(in oklch, var(--bg-1) 88%, transparent)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              backdropFilter: 'blur(6px)',
            }}
          >
            <span className="uppercase-mini text-fg-3">Nodes</span>
            <Chip tone="rose" size="sm">
              risk
            </Chip>
            <Chip tone="amber" size="sm">
              watch
            </Chip>
            <Chip tone="blue" size="sm">
              concept
            </Chip>
            <Chip tone="emerald" size="sm">
              resolved rule
            </Chip>
          </div>
          {/* metric tiles */}
          <div
            style={{
              position: 'absolute',
              right: 16,
              top: 16,
              display: 'flex',
              gap: 8,
            }}
          >
            {[
              ['Hops', '4.2', '+0.7'],
              ['Recall', '89%', '+4pp'],
              ['Halluc', '0.6%', '−0.3pp'],
            ].map(([l, v, d]) => (
              <div
                key={l}
                style={{
                  padding: '8px 12px',
                  background: 'color-mix(in oklch, var(--bg-1) 90%, transparent)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  backdropFilter: 'blur(6px)',
                }}
              >
                <div className="uppercase-mini text-fg-3">{l}</div>
                <div className="flex items-baseline gap-2">
                  <span className="mono font-semibold" style={{ fontSize: 16 }}>
                    {v}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 10.5, color: 'var(--emerald)' }}
                  >
                    {d}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* node detail panel */}
        <NodeDetail />
      </div>
    </>
  );
}

/**
 * Sidebar showing details of the currently-selected node. v0.2 hard-codes
 * the "Weekend re-stock" rule from the design — the same node visually
 * selected in `BigMemoryGraph`. v0.3 will wire this to a real selected-state
 * via a client component + querystring.
 */
function NodeDetail() {
  return (
    <div
      className="flex flex-col gap-3"
      style={{ padding: 16, background: 'var(--bg-1)' }}
    >
      <div className="flex flex-col gap-2">
        <span className="uppercase-mini text-fg-3">Selected node</span>
        <div className="flex items-center gap-2">
          <Chip tone="emerald">rule</Chip>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Weekend re-stock rule</span>
        </div>
        <span className="mono text-fg-3" style={{ fontSize: 11 }}>
          memory.v12 · stabilised May 5 · referenced 31× since
        </span>
      </div>

      <hr style={{ height: 1, background: 'var(--line)', border: 0 }} />

      <div className="flex flex-col gap-2">
        <span className="uppercase-mini text-fg-3">Definition</span>
        <pre className="ds-code" style={{ fontSize: 11.5 }}>
          <span className="cm">{`-- promoted from 6 consecutive weekly observations`}</span>
          {'\n'}
          <span className="kw">RULE</span>
          <span className="id"> weekend_restock</span>{' '}
          <span className="kw">WHEN</span>
          {'\n'}
          <span className="id"> category </span>
          <span className="kw">IN</span>
          <span className="id"> (</span>
          <span className="str">&apos;pantry&apos;</span>
          <span className="id">, </span>
          <span className="str">&apos;cleaning&apos;</span>
          <span className="id">)</span>
          {'\n'}
          <span className="id"> </span>
          <span className="kw">AND</span>
          <span className="id"> dow </span>
          <span className="kw">IN</span>
          <span className="id"> (</span>
          <span className="num">6</span>
          <span className="id">,</span>
          <span className="num">7</span>
          <span className="id">)</span>
          {'\n'}
          <span className="kw">EXPECT</span>
          <span className="id"> variance ≈ baseline × </span>
          <span className="num">1.7</span>
          <span className="id">;</span>
        </pre>
      </div>

      <div className="flex flex-col gap-2">
        <span className="uppercase-mini text-fg-3">Provenance</span>
        <div className="flex flex-col gap-1">
          {[
            ['Apr 06', 'First observation · pantry SKUs'],
            ['Apr 13', 'Re-observed · added cleaning'],
            ['Apr 27', 'Promoted to candidate rule'],
            ['May 05', 'Stabilised · memory v12'],
          ].map(([d, t]) => (
            <div key={d} className="flex items-center gap-2">
              <span className="mono text-fg-3" style={{ fontSize: 11, width: 52 }}>
                {d}
              </span>
              <span style={{ fontSize: 12.5 }}>{t}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="uppercase-mini text-fg-3">Connected to</span>
        <div className="flex flex-wrap gap-2">
          <Chip size="sm">
            <span className="dot" style={{ background: 'var(--blue)' }} />
            damage tickets
          </Chip>
          <Chip size="sm">
            <span className="dot" style={{ background: 'var(--blue)' }} />
            margin model
          </Chip>
          <Chip size="sm">
            <span className="dot" style={{ background: 'var(--emerald)' }} />
            logistics audit
          </Chip>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <button type="button" className="ds-btn sm">
        Open in workbench
      </button>
      <p className="mono text-fg-3" style={{ margin: 0, fontSize: 10.5 }}>
        Operational Memory subsystem ships in v0.3 — this graph is a preview of the explorer that
        will surface real promoted patterns.
      </p>
    </div>
  );
}
