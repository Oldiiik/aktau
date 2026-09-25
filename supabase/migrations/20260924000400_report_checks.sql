-- Resident reports: an optional / required photo and the anti-spam check.
--
-- photo         { image: data URL (JPEG, resized in the browser), sha256, bytes }
--               Private like raw_text: 109 sees it, the public map never does.
-- check_result  { outcome, code, flags, reasons, rules, ai: { verdict, is_city_problem,
--               reasons, photo, photo_note, engine } | null, ms }
--               The check blocks only obvious spam (with the reason shown to the
--               resident, who can edit and resend) and never a report about danger.
--               Anything doubtful reaches 109 flagged; an operator decides.
alter table incident_signals add column photo jsonb, add column check_result jsonb;
create index incident_signals_photo_hash_idx on incident_signals ((photo->>'sha256')) where photo is not null;
create index incident_signals_installation_time_idx on incident_signals (installation_id, created_at desc) where installation_id is not null;
