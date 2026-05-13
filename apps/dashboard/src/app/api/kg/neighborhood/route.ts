/**
 * GET /api/kg/neighborhood?focus=<id>&hops=<n>
 *
 * Returns a ring-bounded neighborhood around a focus node, capped to ~300
 * nodes by confidence so the radial viz never chokes on million-node tenants.
 *
 * Phase 1 (this PR): returns a hand-built 7-node sample so the brain page
 * is testable end-to-end before the entity extractor lands.
 *
 * Phase 2 (KG extractor PR): swap the body for the real recursive-CTE
 * query against kg_node / kg_edge — see docs/KNOWLEDGE_GRAPH.md §Phase 2.
 */

import { NextResponse } from 'next/server';

type Node = {
  data: {
    id: string;
    name: string;
    type: string;
    ring: number;
    evidence_count: number;
    typeColor: string;
  };
};

type Edge = {
  data: {
    id: string;
    source: string;
    target: string;
    relation: string;
    confidence: number;
    thickness: number;
  };
};

const TYPE_COLORS: Record<string, string> = {
  customer:  '#3b82f6',
  employee:  '#10b981',
  vendor:    '#f59e0b',
  invoice:   '#8b5cf6',
  deal:      '#ec4899',
  product:   '#14b8a6',
  shipment:  '#6366f1',
};

function color(type: string): string {
  return TYPE_COLORS[type] ?? '#9ca3af';
}

function makeMockGraph(focus: string): { nodes: Node[]; edges: Edge[] } {
  // 7-node sample anchored on "Acme Corp", a customer. Realistic shape:
  // a customer node + 4 ring-1 neighbors (an invoice, an employee, a
  // vendor, a shipment) + 2 ring-2 nodes (the employee's manager, the
  // vendor's parent company).
  const focusId = focus === 'root' ? 'acme' : focus;

  const nodes: Node[] = [
    { data: { id: 'acme',     name: 'Acme Corp',          type: 'customer', ring: 0, evidence_count: 142, typeColor: color('customer') }},
    { data: { id: 'inv-9241', name: 'INV-9241',           type: 'invoice',  ring: 1, evidence_count: 1,   typeColor: color('invoice')  }},
    { data: { id: 'jsmith',   name: 'John Smith',         type: 'employee', ring: 1, evidence_count: 38,  typeColor: color('employee') }},
    { data: { id: 'vendorx',  name: 'Vendor X',           type: 'vendor',   ring: 1, evidence_count: 17,  typeColor: color('vendor')   }},
    { data: { id: 'ship-771', name: 'Shipment 771',       type: 'shipment', ring: 1, evidence_count: 1,   typeColor: color('shipment') }},
    { data: { id: 'jdoe',     name: 'Jane Doe (Manager)', type: 'employee', ring: 2, evidence_count: 12,  typeColor: color('employee') }},
    { data: { id: 'vendory',  name: 'Vendor Y (Parent)',  type: 'vendor',   ring: 2, evidence_count: 6,   typeColor: color('vendor')   }},
  ];

  const edges: Edge[] = [
    { data: { id: 'e1', source: 'acme',    target: 'inv-9241', relation: 'billed_to', confidence: 1.0,  thickness: 3 }},
    { data: { id: 'e2', source: 'jsmith',  target: 'acme',     relation: 'works_at',  confidence: 0.95, thickness: 3 }},
    { data: { id: 'e3', source: 'acme',    target: 'vendorx',  relation: 'paid_to',   confidence: 0.82, thickness: 2 }},
    { data: { id: 'e4', source: 'acme',    target: 'ship-771', relation: 'shipped_to',confidence: 1.0,  thickness: 3 }},
    { data: { id: 'e5', source: 'jsmith',  target: 'jdoe',     relation: 'reports_to',confidence: 0.78, thickness: 2 }},
    { data: { id: 'e6', source: 'vendorx', target: 'vendory',  relation: 'subsidiary_of', confidence: 0.65, thickness: 1 }},
  ];

  // If the user clicks any node, we'd recenter; for the mock, we just
  // promote that node to ring 0 and demote 'acme' if it wasn't the focus.
  if (focusId !== 'acme') {
    for (const n of nodes) n.data.ring = n.data.id === focusId ? 0 : 1;
  }

  return { nodes, edges };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const focus = url.searchParams.get('focus') ?? 'root';
  // const hops = Number(url.searchParams.get('hops') ?? 2);  -- real impl will honor this

  return NextResponse.json(makeMockGraph(focus));
}
