/**
 * The Brain — radial knowledge-graph viz.
 *
 * Concentric layout, not force-directed. Rings = hop distance from the
 * focused entity. Click any node to recenter. Click an edge to open
 * the SQL receipt panel (trust pipeline: every edge in the graph cites
 * the query that proved it).
 *
 * Phase 1: this page reads from the mock /api/kg/neighborhood endpoint
 * which returns a 7-node sample. Phase 2 swaps the endpoint body to a
 * real recursive-CTE query against kg_node / kg_edge.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

// react-cytoscapejs touches the DOM on mount, so it must be client-only.
const CytoscapeComponent = dynamic(() => import('react-cytoscapejs'), { ssr: false });

type Graph = {
  nodes: Array<{ data: { id: string; name: string; type: string; ring: number; evidence_count: number; typeColor: string } }>;
  edges: Array<{ data: { id: string; source: string; target: string; relation: string; confidence: number; thickness: number } }>;
};

export default function BrainPage() {
  const [focus, setFocus] = useState<string>('root');
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/kg/neighborhood?focus=${encodeURIComponent(focus)}&hops=2`)
      .then((r) => r.json())
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], edges: [] }));
  }, [focus]);

  const selectedEdge = graph.edges.find((e) => e.data.id === selectedEdgeId);

  return (
    <div className="flex h-screen w-full">
      <div className="relative flex-1 bg-neutral-950">
        <header className="absolute left-4 top-4 z-10 rounded-md bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 backdrop-blur">
          <div className="font-medium">🧠 The Brain</div>
          <div className="text-xs text-neutral-400">
            Focus: <span className="font-mono">{focus}</span> · {graph.nodes.length} nodes · {graph.edges.length} edges
          </div>
        </header>

        <CytoscapeComponent
          elements={[...graph.nodes, ...graph.edges]}
          layout={{
            name: 'concentric',
            minNodeSpacing: 80,
            concentric: (n: { data: (k: string) => unknown }) => -(n.data('ring') as number), // ring 0 outermost weight
            levelWidth: () => 1,
            animate: true,
          }}
          style={{ width: '100%', height: '100%' }}
          stylesheet={[
            {
              selector: 'node',
              style: {
                'background-color': 'data(typeColor)',
                label: 'data(name)',
                color: '#e5e5e5',
                'font-size': 11,
                'font-family': 'ui-sans-serif, system-ui',
                'text-valign': 'bottom',
                'text-margin-y': 8,
                width: (n: { data: (k: string) => unknown }) => 18 + Math.min(24, Math.log2((n.data('evidence_count') as number) + 1) * 4),
                height: (n: { data: (k: string) => unknown }) => 18 + Math.min(24, Math.log2((n.data('evidence_count') as number) + 1) * 4),
                'border-width': 2,
                'border-color': '#0a0a0a',
              },
            },
            {
              selector: 'edge',
              style: {
                width: 'data(thickness)',
                'line-color': '#525252',
                'target-arrow-color': '#525252',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                opacity: 0.7,
                label: 'data(relation)',
                'font-size': 9,
                color: '#a3a3a3',
                'text-rotation': 'autorotate',
                'text-background-color': '#0a0a0a',
                'text-background-opacity': 0.7,
                'text-background-padding': '2px',
              },
            },
            {
              selector: 'edge:selected',
              style: { 'line-color': '#3b82f6', 'target-arrow-color': '#3b82f6', opacity: 1 },
            },
            {
              selector: 'node:selected',
              style: { 'border-color': '#3b82f6', 'border-width': 3 },
            },
          ]}
          cy={(cy) => {
            cy.removeAllListeners();
            cy.on('tap', 'node', (e: { target: { id: () => string } }) => setFocus(e.target.id()));
            cy.on('tap', 'edge', (e: { target: { id: () => string } }) => setSelectedEdgeId(e.target.id()));
            cy.on('tap', (e: { target: unknown }) => {
              // tap on empty canvas clears edge selection
              if (e.target === cy) setSelectedEdgeId(null);
            });
          }}
        />
      </div>

      {selectedEdge && (
        <aside className="w-80 border-l border-neutral-800 bg-neutral-900 p-4 text-neutral-100">
          <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Edge</div>
          <div className="mb-1 text-sm">
            <span className="font-mono text-neutral-300">{selectedEdge.data.source}</span>
            <span className="mx-2 text-neutral-500">→</span>
            <span className="font-mono text-neutral-300">{selectedEdge.data.target}</span>
          </div>
          <div className="mb-4 text-sm text-neutral-400">
            relation: <span className="font-medium text-neutral-200">{selectedEdge.data.relation}</span>
          </div>

          <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Confidence</div>
          <div className="mb-4 text-2xl font-light text-neutral-100">
            {(selectedEdge.data.confidence * 100).toFixed(0)}<span className="text-base text-neutral-500">%</span>
          </div>

          <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Receipts</div>
          <div className="rounded border border-dashed border-neutral-700 p-3 text-xs text-neutral-500">
            Query receipts not yet wired. Phase 2 will list every SQL that proved this edge, with a click-to-view-rows action.
            <br />
            <br />
            See <span className="font-mono">docs/KNOWLEDGE_GRAPH.md §Trust pipeline</span>.
          </div>

          <button
            onClick={() => setSelectedEdgeId(null)}
            className="mt-4 text-xs text-neutral-400 hover:text-neutral-200"
          >
            close ✕
          </button>
        </aside>
      )}
    </div>
  );
}
