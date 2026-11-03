import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { isDue, runObjective, type RunResult } from '@/lib/jobs/run-objective'
import type { Objective } from '@/lib/db-types'

// Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`. Hobby plans run cron once a day.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_PER_TICK = 5

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function tick(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data: objectives, error } = await db
    .from('objectives')
    .select('id, status, cadence, last_run_at')
    .eq('status', 'confirmed')
    .order('last_run_at', { ascending: true, nullsFirst: true })
    .limit(50)
    .returns<Array<Pick<Objective, 'id' | 'status' | 'cadence' | 'last_run_at'>>>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const due = (objectives ?? []).filter((o) => isDue(o)).slice(0, MAX_PER_TICK)
  const results: Array<RunResult & { objectiveId: string }> = []
  for (const o of due) {
    results.push({ objectiveId: o.id, ...(await runObjective(db, o.id, { trigger: 'cron' })) })
  }
  return NextResponse.json({ ran: results.length, results })
}

export const GET = tick
export const POST = tick
