import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { intake as readIntake } from '@aktau/city-core'
import { checkReport, log, submitSignal } from '@aktau/server'
import { fail, handle, installationOf, isStaffRequest, json, limitedPerDevice, sql } from '@/lib/api'

// A report from the app. A resident's report passes the anti-spam check
// (rules + AI) and opens a candidate incident for a 109 operator; blocked
// reports are not stored. "Same problem" goes to /api/incidents/:id/confirm
// (a confirmation, not a duplicate report). Signed-in staff (e.g. a presenter
// reporting into a live session) skip the spam check and are never counted as
// residents.
const Photo = z.object({ media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(100).max(1_600_000).regex(/^[A-Za-z0-9+/=]+$/) })
const Body = z.object({
  text: z.string().trim().min(3).max(2000),
  attach_to: z.string().uuid().nullish(),
  lat: z.number().min(43).max(44.5).nullish(),
  lon: z.number().min(50).max(52).nullish(),
  photo: Photo.nullish(),
  // The resident saw the check's doubts and chose to send anyway.
  confirm: z.boolean().optional(),
  // Report into a live demo session (the session is the location).
  session_id: z.string().uuid().nullish(),
})

export const POST = handle('incident-signal', async (req: NextRequest) => {
  const rl = await limitedPerDevice(req, 'signal', 12, 300, 600)
  if (rl) return rl
  const b = Body.parse(await req.json())
  const installation_id = installationOf(req)
  const staff = await isStaffRequest(req)
  if (b.session_id && !staff) return fail(403, 'staff_only', 'Only the presenter can report into a live session.')

  if (b.attach_to) {
    if (installation_id) {
      const [already] = await sql()<{ n: number }[]>`select count(*)::int n from incident_signals where incident_id = ${b.attach_to} and installation_id = ${installation_id}`
      if (already && already.n > 0) return fail(409, 'already_confirmed', 'You have already reported this incident.')
    }
    const r = await submitSignal(sql(), { text: b.text, channel: 'APP', attach_to: b.attach_to, lat: b.lat, lon: b.lon, installation_id, actor: 'resident', photo: b.photo ?? null, origin: staff ? 'staff' : 'resident' })
    return json({ signal_id: r.signal_id, incident_id: r.incident_id })
  }

  if (staff) {
    const r = await submitSignal(sql(), {
      text: b.text, channel: 'APP', create: true, lat: b.lat, lon: b.lon, installation_id, actor: staff.actor, photo: b.photo ?? null,
      origin: 'staff', session_id: b.session_id ?? null, public_title: b.session_id ? b.text.split(/[.!?\n]/)[0]!.trim() : null,
    })
    return json({ signal_id: r.signal_id, incident_id: r.incident_id, check: { outcome: 'pass', code: 'staff' } })
  }

  const check = await checkReport(sql(), { text: b.text, intake: readIntake(b.text), photo: b.photo ?? null, installation_id })
  if (check.outcome === 'block') {
    log('info', 'report.blocked', { code: check.code, rules: check.rules, ai: check.ai?.verdict ?? null, ms: check.ms })
    return fail(422, 'report_blocked', check.code, { check: { code: check.code, reasons: check.reasons, duplicate_of: check.duplicate_of } })
  }
  if (check.outcome === 'confirm' && !b.confirm) {
    return fail(409, 'report_needs_confirmation', check.code, { check: { code: check.code, reasons: check.reasons } })
  }
  const r = await submitSignal(sql(), { text: b.text, channel: 'APP', create: true, lat: b.lat, lon: b.lon, installation_id, actor: 'resident', photo: b.photo ?? null, check, sent_anyway: check.outcome === 'confirm' })
  return json({ signal_id: r.signal_id, incident_id: r.incident_id, check: { outcome: check.outcome, code: check.code } })
})
