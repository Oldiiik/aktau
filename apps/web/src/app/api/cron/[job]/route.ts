import type { NextRequest } from 'next/server'
import { runJob } from '@aktau/server'
import { fail, handle, json, requireCron, sql } from '@/lib/api'

const JOBS = ['weather', 'observations', 'air-marine', 'notices', 'media', 'places', 'afisha', 'lifecycle'] as const

// Called by Supabase Cron (pg_cron + pg_net) with Authorization: Bearer CRON_SECRET.
export const POST = handle('cron', async (req: NextRequest, ctx: { params: Promise<{ job: string }> }) => {
  if (!requireCron(req)) return fail(401, 'unauthorized', 'Bad cron secret')
  const { job } = await ctx.params
  if (!(JOBS as readonly string[]).includes(job)) return fail(404, 'unknown_job', job)
  return json({ job, results: await runJob(sql(), job as (typeof JOBS)[number]) })
})
