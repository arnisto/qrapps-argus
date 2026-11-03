import Link from 'next/link'
import { loadCompany } from '@/lib/company'
import { Badge, Card, Empty, when } from '@/components/ui'
import type { Report } from '@/lib/db-types'

export const metadata = { title: 'Reports' }

export default async function ReportsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { supabase, company } = await loadCompany(slug)
  const { data: reports } = await supabase
    .from('reports')
    .select('id, title, status, period_start, period_end, created_at')
    .eq('company_id', company.id)
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<Report[]>()

  return (
    <>
      <h1 className="text-2xl font-semibold">Reports</h1>
      <Card>
        {reports?.length ? (
          <ul className="divide-y divide-line">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/c/${slug}/reports/${r.id}`} className="font-medium underline">
                    {r.title}
                  </Link>
                  <span className="block text-xs text-muted">
                    {when(r.period_start)} to {when(r.period_end)}
                  </span>
                </div>
                <Badge tone={r.status === 'verified' ? 'ok' : 'bad'}>{r.status === 'verified' ? 'verified' : 'failed the check'}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No report yet.</Empty>
        )}
      </Card>
    </>
  )
}
