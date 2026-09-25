// Starts the in-process scheduler in local development (LOCAL_SCHEDULER=true).
// In production, Supabase Cron calls /api/cron/* instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.LOCAL_SCHEDULER !== 'true') return
  const { getSql, startLocalScheduler } = await import('@aktau/server')
  startLocalScheduler(getSql())
}
