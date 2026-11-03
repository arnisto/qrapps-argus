import { describe, expect, it } from 'vitest'
import { isDue, isReportDue } from './run-objective'

const now = new Date('2026-11-03T06:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString()

describe('isDue', () => {
  it('never runs an unconfirmed objective', () => {
    expect(isDue({ status: 'proposed', cadence: 'daily', last_run_at: null }, now)).toBe(false)
  })
  it('runs a confirmed objective that never ran', () => {
    expect(isDue({ status: 'confirmed', cadence: 'daily', last_run_at: null }, now)).toBe(true)
  })
  it('daily waits about 20 hours, tolerating cron drift', () => {
    expect(isDue({ status: 'confirmed', cadence: 'daily', last_run_at: hoursAgo(19) }, now)).toBe(false)
    expect(isDue({ status: 'confirmed', cadence: 'daily', last_run_at: hoursAgo(21) }, now)).toBe(true)
  })
  it('weekly waits six and a half days', () => {
    expect(isDue({ status: 'confirmed', cadence: 'weekly', last_run_at: hoursAgo(24 * 6) }, now)).toBe(false)
    expect(isDue({ status: 'confirmed', cadence: 'weekly', last_run_at: hoursAgo(24 * 7) }, now)).toBe(true)
  })
})

describe('isReportDue', () => {
  it('reports weekly', () => {
    expect(isReportDue({ last_report_at: null }, now)).toBe(true)
    expect(isReportDue({ last_report_at: hoursAgo(24 * 3) }, now)).toBe(false)
    expect(isReportDue({ last_report_at: hoursAgo(24 * 8) }, now)).toBe(true)
  })
})
