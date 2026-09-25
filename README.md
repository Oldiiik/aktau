# Aktau — your city, in one place

A city-information platform for Aktau, Kazakhstan. The screens are deliberately
calm; underneath is a structured, source-traceable city-state system.

```
MULTIPLE FRAGMENTED SOURCES → INGEST → PRESERVE RAW → EXTRACT → NORMALIZE
→ VERIFY / DEDUPLICATE → CITY STATE → PERSONALIZE → HOME / MAP / ASK / WIDGET / NOTIFICATIONS
```

**The database is the source of truth. An LLM is never the source of truth.**
Every fact on screen can be traced back through the evidence chain on the event
page: source announcement → raw record → extracted structure → city event → updates.

## What is real

| Surface | Data | Status |
|---|---|---|
| Weather | Open-Meteo forecast (model), cached 10 min | live |
| Observations | **Kazhydromet** WMO WIS2 node, SYNOP station Aktau `0-398-0-38111` | live, official |
| Caspian | Open-Meteo Marine — labelled "modelled", never "safe to swim" | live |
| Swimming (`/map?layer=swim`) | Official beaches: akimat act № 171 (rev. № 99, 26.06.2026); prohibited stretches: Mangistau police, 09.07.2026. Transcribed by hand with item numbers (`supabase/seed/06_coast_zones.sql`); shore from OSM coastline. "Can I swim here?" by GPS or map tap. Temporary status (open / restricted / closed) only from an authority via `PATCH /api/admin/caspian/:id` | verified 24 Sep 2026 |
| Air quality | Open-Meteo / CAMS — labelled model estimate | live |
| City news (`/news`) | **Lada.kz**: Aktau, Kazakhstan and world stories (headline, publisher's summary, photo); full articles open on the publisher's own page inside the app, text is never copied | live, every 15 min |
| Utility notices | **Lada.kz** news sitemap + NewsArticle JSON-LD (e.g. real AUES outage 22 Sep, 3 notices, houses 41–46В) | live discovery → human review |
| Akimat, 109, MAEK, KZhSA, AUES | no safe automated feed (gov.kz API refuses automated clients — we do not bypass it) | manual ingestion panel |
| Microdistricts | 68 districts, 63 real OSM polygons | seeded from OSM |
| Buildings | 3,476 addressed buildings ("14 микрорайон, 21") | seeded from OSM |
| Places | OSM Overpass (daily, cached); 2GIS when `DGIS_API_KEY` is set | live |
| 109 reports from the app | Photo required for visible problems (lights, waste, roads, yards, facades), optional for outages, never for gas or danger. Anti-spam gate before 109: rules (gibberish, adverts, resent text, bursts, reused photo) then AI review of text + photo (`packages/server/src/report-check.ts`). Obvious spam is refused with the reason; doubts ask "send anyway?" and reach 109 flagged; imminent danger always passes; AI down = fail-open | live |
| What's on (`/afisha`) | **Kinoafisha** (sessions in Aktau's cinemas: time, format, language, price from), **Sxodim** and **inaktau.kz** (schema.org Event), **Topbilet** (Open Graph): concerts, stand-up, theatre, festivals. One show listed on two sites is one card with both links; tickets are bought from the publisher. Parks, museums, the embankment from OSM. Ticketon is not used: it sends automated clients to a Queue-it waiting room | live, every 3 h |
| Pilot simulation (`/copilot/pilot`) | 1,000–25,000 generated resident reports with a known answer, through the real engine on the real city map ([below](#pilot-simulation-10000-reports)) | staff, on demand |
| Demo scenarios | injected through the real pipeline, stored `is_demo = true`, labelled DEMO everywhere | explicit |

## Ask: the Aktau assistant

`/ask` is a chat assistant for almost anything a resident needs ("where can I fix
my glasses?", "is there a pharmacy open now?", "will there be power tomorrow?",
"what happened in Aktau today?", or a photo of a broken street light). It is a tool-using agent (`packages/server/src/assistant.ts`)
whose tools read Aktau's own data first:

| Tool | Reads |
|---|---|
| `find_places` | ~1,000 OSM places cached daily (all shops, crafts, services); any other OSM tag is looked up live and stored |
| `city_status` · `city_events` | the user's home picture, reviewed city notices |
| `incidents_109` | open and recently fixed 109 incidents |
| `search_news` | stored Lada.kz stories |
| `weather` | forecast, Kazhydromet observation, Caspian, air |
| `swimming` | official beaches / prohibited stretches (Caspian Safety), sea conditions, "can I swim here" from the user's GPS |
| `whats_on` | films and today's / tomorrow's sessions, concerts, stand-up, theatre, festivals (Afisha) |
| `prepare_109_report` | drafts a report; the user reviews and sends it |
| `web_search` | only when city data has nothing |

The user can attach a photo (resized in the browser; a broken light becomes a drafted 109 report),
share their current location for "near me" (used for that answer, not stored), and dictate by voice.

Every tool result streams to the client as a card (places with call / route / 2GIS,
notices, incidents, news). Engines: Claude when `ANTHROPIC_API_KEY` is set; otherwise Gemini when `GEMINI_API_KEY` is set
(`packages/server/src/assistant-gemini.ts`: same tools and prompt, Flash models with failover; web search
needs a Gemini tier with Google Search grounding). Set `ANTHROPIC_API_KEY` to enable Claude (model `ANTHROPIC_MODEL`,
default `claude-opus-5`; `ASSISTANT_EFFORT` default `medium`). Without a key it runs in
basic mode: place questions via a keyword → OSM-tag map, city questions via the
deterministic Ask engine.

## Design

Design system v2 (`apps/web/src/app/globals.css`): Geologica (display, numerals) +
Geist (text), one blue accent taken from the logo, semantic status colours only, no glows, sentence-case
labels, real photographs of Aktau from Wikimedia Commons (credited in You → Data sources).

Logo: `design/logo-source.webp` (the lighthouse over the Caspian). `python3 scripts/brand-assets.py`
builds everything from it: the in-app round mark and favicons (`apps/web/public/images/logo-mark*.png`),
full-bleed home-screen / PWA icons incl. an Android maskable one (`app-icon-*.png`), and the iOS
`AppIcon` asset catalog (wired into the project by `apps/ios/gen-xcodeproj.py`).

## Repository

```
apps/web          Next.js 16 (App Router) — public app, /news, /copilot (109), /admin console, /api
apps/ios          SwiftUI host app + WidgetKit extension + Live Activity (no WebView)
packages/types    shared contracts + Zod schemas (strict extraction schema)
packages/city-core   pure rules: doesEventAffectLocation, freshness, derived service
                     status, Aktau Now, Ask intents, notifications, widget, advisories
packages/normalization  RU/KK deterministic parser, grounding, optional LLM stage, dedup, Asia/Aqtau time
packages/source-ranking authority hierarchy + conflict resolution
packages/connectors     Open-Meteo ×3, Kazhydromet WIS2, Lada, Overpass, Nominatim, 2GIS, data.egov.kz,
                        Kinoafisha, Sxodim, inaktau.kz, Topbilet, manual
packages/server   service layer: ingestion, publishing, lifecycle, notifications, Now/Ask/Map/Widget
packages/i18n     kk / ru / en presentation (facts interpolated verbatim)
packages/ui       design tokens (Figma: Aktau · Foundations)
supabase/         migrations (PostGIS, RLS, cron), seed (OSM snapshots + generated SQL), local shim
tests/e2e.test.ts one coherent system: raw AUES text → … → Ask → resolution, on real Postgres+PostGIS
tests/pilot.test.ts  a simulated week of reports; the same reports through the real DB give the same incidents
```

## Run locally (no Docker)

```bash
npm install
cp .env.example .env
```

```bash
npm run db
```

Starts **PGlite** — PostgreSQL 18 compiled to WASM, with PostGIS — on `127.0.0.1:54329`
and applies the same migrations Supabase uses (first boot also seeds OSM data).

```bash
npm run dev
```

App: <http://localhost:3000> · News: `/news` · 109 Copilot: `/copilot` · Admin: `/admin`.

Accounts are optional for residents and required for staff. Create the first admin:

```bash
npm run account -- create you@example.com --role admin
```

| Role | Gets |
|---|---|
| resident | the app; places, alerts and inbox follow the account across devices |
| operator | + **109 Copilot** (in the sidebar / You) |
| admin | + the **admin console** (`/admin`), incl. *Accounts* to grant roles |

Sessions are signed cookies (`SESSION_SECRET`); every privileged request re-checks
the account in the database, so a role change or disable takes effect at once.
`ADMIN_TOKEN` remains a Bearer token for scripted API access only.
With `LOCAL_SCHEDULER=true` the connectors run in-process on the production schedule.

```bash
npm test
```

Extraction on the real Lada/AUES article, fixtures A/B/C, grounding
(the LLM cannot add an ETA/house/district), matching incl. the building
exception, freshness, dedup, conflict resolution, timezone, notification dedup,
the full 11-step end-to-end flow, RLS, and the civic loop
(`packages/city-core/test/civic.test.ts`, `tests/civic-loop.test.ts`: scope,
priority, confirmations, commitment, completion, verification, reopen,
recurrence, merge, a live demo session, "only us" reports), the pilot simulation
(`tests/pilot.test.ts`) and the afisha parsers and pipeline (`tests/afisha.test.ts`).

## Flagship demo (≈3 min)

1. **You → Personalize** → type `14 21` (local index, no geocoder) → Home shows
   *"Everything around you looks normal."* with live weather + Kazhydromet observation.
2. **/admin → Demo scenarios → "AUES: 14 mkr, houses 19–23"** — or paste any
   announcement in **Ingest**. The structured preview shows service, type,
   microdistrict 14, houses 19–23, 13:30–17:30, authority AUES, "all fields grounded".
3. **Approve & publish.** Within seconds (SSE realtime):
   Home → *"1 upcoming change affects your home."* · Map highlights only houses 19–23 ·
   bell shows a delivered notification · widget state changes.
4. **Ask** → *"Will I have electricity tomorrow at 3 PM?"* →
   *"No — a planned interruption affecting your building is scheduled from 13:30 to 17:30."* Source: AUES.
5. Open the event → **Where did this come from?** — the full evidence chain.
6. **/admin → Events** → *Started*, then paste `АУЭС: ориентировочное время восстановления … — 18:30`
   (tick *Demo item*) → it merges as an UPDATE: Home turns red *"A change near home"*,
   history shows *Estimate updated → 18:30*. **Resolve** → *"Back to normal."*
7. Second demo: `water_no_eta` scenario — the widget and Home say
   *"Restoration time not announced."* — never an invented time.

A resident of 14 mkr **house 42** sees the same event as *"In your microdistrict"* and
gets **no** notification: the source limited it to houses 19–23.

## The civic loop: one city incident, many residents

A report no longer ends in "we sent it". One physical problem is one incident;
everyone it affects can see it, confirm it, follow it and check the result.

```
report ─► intake + matching (service · place · distance · kind · wording · time)
       ─► "already reported?" → confirm instead of a duplicate
       ─► affected scope (radius · buildings · microdistricts · road · polygon · city · demo session)
       ─► residents in the scope see it on Home, live: "Это затрагивает вас?"
       ─► confirmations (one per person, with where they stood; never a like)
       ─► priority recomputed and explained (safety first; a crowd cannot outrank a hazard)
       ─► 109 assigns a team ─► the team commits to a deadline (changes need a reason; history kept)
       ─► work started ─► completion (what was done; an "after" photo for visible fixes)
       ─► the people who reported or confirmed verify: yes / partly / no (+ optional ratings)
       ─► verified (quorum, ≥ 60% "yes, fully") · reopened (≥ half "no", at least 2) · operator decides
       ─► "the problem came back" → a new incident linked to the previous repair
```

- **Pure rules** in `packages/city-core/src/civic.ts` (`inferScope`, `incidentAffects`,
  `assessPriority`, `verificationOutcome`); the service layer is `packages/server/src/incidents.ts`
  (`confirmIncident`, `nearbyFor`, `incidentAction`, `verifyIncident`, `mergeIncident`, `reportReturned`).
- **Who is told "this affects your home".** An outage reported at a house starts with that house and
  grows as other houses report or confirm (within 500 m of the first report, or 300 m of a house already
  in it). "No water in my flat" / «только у нас» / «пәтерде» starts with nobody else: the house joins when
  a second flat reports without "only us" or a neighbour presses "me too". A danger warns a 200–250 m
  radius; a problem you can see from the street, its own radius; an unclassified report is never put to
  neighbours.
- **Who sees what.** The server decides who is affected (`GET /api/me/nearby`, from the saved home).
  Only meaningful steps reach residents (assigned, accepted with a deadline, deadline changed, work
  started, "is it fixed?", verified, reopened, merged). Routing suggestions, spam checks and quality
  checks stay with 109.
- **Sources.** Every timeline step carries its source (resident · 109 · official notice · operator ·
  responsible team · automatic · AI suggestion). A cause is shown only when a team, an official notice
  or an operator stated it; otherwise "Официально не подтверждена".
- **Realtime.** Triggers write `realtime_outbox` in the same transaction; one tail per server process
  fans out over SSE (`packages/server/src/realtime.ts`) and replays from `Last-Event-ID`. Clients
  refetch canonical state; after a dropped connection they show "Переподключение…" and resync.
- **Analytics** (109 Copilot, real incidents, 30 days): active, overdue, time to assign, time to fix,
  verified by residents, reopened, recurring, fixed the first time.

### Live jury demo (QR)

1. 109 Copilot (right rail) or /admin → Demo → **Create a session** → the presenter screen
   `/live/{code}/present` opens with a QR code. On a laptop served as `localhost` the QR uses the
   laptop's LAN address; set `PUBLIC_BASE_URL` for a tunnel or a deployed URL.
2. The audience scans: `/live/{code}`, no sign-up, no GPS ("Вы подключены к текущей локации").
3. The presenter publishes one harmless problem (or uses `/report?session={code}`): every phone
   shows "Новая проблема здесь · Вы тоже столкнулись?" at once. The counter grows as people confirm.
4. Assign → Demo IT Team · ETA 10 min · Work started · Submit completion, from the presenter screen or
   the same incident in 109 Copilot. Phones follow each step live, then answer "Проблема решена?".
5. The final tally: residents who took part, resident signals, 1 shared incident, 1 team, 1 verified result.

The session is just another scope: the same incident, confirmation, operator, completion and
verification code runs for it. Tested with 40 simulated phones on the local database: every step
reached every phone in about a second.

## Pilot simulation (10,000 reports)

109 Copilot → **Симуляция пилота** (`/copilot/pilot`, also linked from /admin → Demo): press
**Запустить: 10 000 обращений** and a generated week in Aktau goes through the engine in about two seconds.

- **A known answer.** `packages/server/src/pilot-scenario.ts` generates ≈326 real problems on the 3,476
  real buildings (network outages over groups of houses or whole microdistricts, one-flat problems,
  street problems at a point, dangers) and ≈29,000 residents, 85% with a saved home. Reports are
  written the way people write them: Russian, Kazakh, English and mixed; the app, call transcripts,
  WhatsApp, Instagram and Көмек 109; about 150 phrasings, a dozen address formats, typos, Latin
  transliteration, resends and 4% spam.
- **The same engine.** Every report runs through the production rules in `packages/city-core`
  (intake, "already reported?", scope, priority, routing, spam rules, verification). What the
  database does is mirrored rule for rule in `packages/server/src/pilot.ts`, and `tests/pilot.test.ts`
  replays the same reports through the real PostGIS pipeline and gets the same incidents.
- **Checked against the answer:** reports → incidents (B-cubed), who was told vs who was affected
  (by outages, street, dangers, one building), understanding by language, spam and resends, dangers
  made critical, routing, verification by residents, recurrences, and every mistake with its cause.
- **Reproducible.** A week is a seed («Повторить неделю №…»). The city loads in a stable order, so a
  seed is the same week on any copy of the database. Real incidents are never touched; only the
  summary is cached.

Averages over 8 weeks of 10,000 reports each:

| | average (range) |
|---|---|
| cards for the 109 operator | ≈ 390 (373–412) for 326 real problems: 96% fewer than reports |
| reports in their own problem's incident | 98.5% (96.9–99.0) |
| service understood · house understood | 99.8% · 99.4% |
| "affects your home" was right | 92.6% overall · outages 99.7% · street 99.1% · one building or flat 83.9% |
| affected residents who were told | 86.1% overall · outages 98.8% · dangers 89.3% · street 83.5% |
| dangers made critical at once | 98.9%; real reports stopped by the spam filter: 0 |
| right team suggested | 91.6% (88.7–93.5) |

Not modelled: the AI review of reports (rules only), operator corrections, residents answering
"no, this is a different problem"; each of these would only remove errors. Real reports are more
varied than any template, so a pilot's numbers will differ.

## Architecture notes

- **Deterministic first, LLM second, grounding always.** `packages/normalization`
  parses dates, times, microdistricts, house lists (incl. `46Б`, ranges), service,
  authority and reason in Russian and Kazakh. The optional Claude stage
  (`ANTHROPIC_API_KEY`) is used only for hard gaps, returns a schema-constrained
  structure, and every value is checked against the source text; anything
  ungrounded is dropped and the candidate goes to review.
- **Review before publish.** Extraction output waits in `event_candidates`.
  `AUTO_PUBLISH_OFFICIAL=true` allows error-free, rules-only, high-confidence
  candidates from official sources to publish themselves.
- **One event, many sources.** Duplicates merge as CONFIRMING / UPDATE /
  CONTRADICTING evidence; the newest claim wins unless it is far less
  authoritative; every change is a `city_event_updates` row (ordered by `seq`).
- **Freshness.** An outage whose ETA passed without an update is shown as
  *not recently confirmed*; services are "Normal" only if the sources that would
  report a problem were checked recently — otherwise *Not confirmed*.
- **Location matching** — building → microdistrict → geometry → radius →
  `DIRECT | AREA | NEARBY | NO` (`packages/city-core/src/matching.ts`).
- **One engine.** `getAktauNow` feeds Home, the widget, Ask context and
  notification copy. Home is a single `/api/now` call.
- **Realtime.** Triggers write `realtime_outbox`; `/api/stream` (SSE) tails it —
  identical on PGlite and Supabase (tables are also added to `supabase_realtime`).
- **Maps.** MapLibre GL with GeoJSON fill/line/circle/symbol layers; tiles from
  `NEXT_PUBLIC_MAP_STYLE_URL` (default OSM raster with attribution; no prefetching).
- **Security.** No secrets in `NEXT_PUBLIC_*`; RLS on every table; public reads
  only approved state + curated views; admin session is an HMAC cookie; rate
  limits on Ask, search, ingestion and anonymous writes; logs never contain
  precise locations or push tokens.

## API

| | |
|---|---|
| `GET /api/now` | aggregated Home payload (location, Aktau Now, priority event, services, weather, today) |
| `GET /api/around-me?lat&lon&radius` | nearby incidents + open places, ranked by urgency then distance |
| `GET /api/events` · `GET /api/events/:id` | events / detail with updates + evidence |
| `GET /api/services` · `GET /api/weather` | derived service states · forecast + observation side by side |
| `GET /api/map/events` · `GET /api/map/areas` | GeoJSON |
| `GET /api/places/search?q` · `GET /api/areas/search?q` | local index → cached places → 2GIS → Nominatim |
| `POST /api/ask` | `{ intent, answer_type, message, detail, confidence, data, sources, event_ids, updated_at }` |
| `POST /api/assistant` | Aktau assistant, streamed as NDJSON events (text, tool status, cards) |
| `GET /api/news` · `?scope=aktau\|kazakhstan\|world&before=ISO` | News front page (stories, official word, 109 fixes, weather) · older stories |
| `GET /api/afisha` | What's on: films with sessions per cinema, shows (one card per show across sites), places to go, sources |
| `GET\|POST /api/ops/pilot` | the last pilot simulation · run one: `{ reports: 500–50000, days: 1–30, seed? }`, streamed as NDJSON progress + result (staff) |
| `POST /api/auth/signin` · `/signup` · `/signout` | accounts (sign-up always creates a resident) |
| `GET /api/admin/users` · `PATCH /api/admin/users/:id` | admin: list accounts, change role, disable |
| `GET /api/widget/state` | `{ status, headline, detail, event_id, deep_link, weather, updated_at, refresh_after }` |
| `POST /api/device/register` · `/api/me/*` | anonymous installation, saved places, preferences, inbox |
| `GET /api/stream` | SSE change feed (replays from `Last-Event-ID`) |
| `GET /api/me/nearby` | incidents that concern this device: in its home's scope, nearby, followed, or in a joined live session, with what to ask |
| `POST /api/incidents/:id/confirm` | `{ state: confirmed \| not_affected, note?, photo? }`: one confirmation per person |
| `POST /api/incidents/:id/verify` | `{ answer: yes \| partial \| no, quality?, speed?, comment?, photo? }`: people who reported or confirmed |
| `POST /api/incidents/:id/returned` | "the problem came back": a new incident linked to this repair |
| `POST /api/ops/incidents/:id` | route (team) · commit (deadline, reason when changed) · dispatch · complete · request_evidence · escalate · merge · scope · reopen · resolve · close_rejected · title |
| `GET\|POST /api/ops/live` · `PATCH\|DELETE /api/ops/live/:code` | live demo sessions (staff) |
| `GET\|POST /api/live/:code` | a live session's state for this device · join |
| `POST /api/admin/ingest` · `POST /api/admin/candidates/:id` · `POST /api/admin/events/:id/approve` · `PATCH /api/admin/events/:id` | editor workflow (audited) |
| `POST /api/cron/:job` | `weather · observations · air-marine · notices · media · places · afisha · lifecycle` (Bearer `CRON_SECRET`) |

Deep links: `aktau://event/{id}` ↔ `/event/{id}` (widget, notifications, map, Ask).

## Deploy (Supabase + Vercel)

1. Create a Supabase project. Apply schema + seed:
   `DATABASE_URL=<session-pooler URL> npm run db:migrate` (or `supabase db push`, then run the seed files).
2. Vercel → import the repo, root `apps/web`, env: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_TOKEN`,
   `CRON_SECRET`, optional `ANTHROPIC_API_KEY`, `DGIS_API_KEY`, `DEMO_MODE`, `LOCAL_SCHEDULER=false`.
3. In Supabase SQL: `select vault.create_secret('<https://your-app>', 'app_base_url');`
   `select vault.create_secret('<CRON_SECRET>', 'cron_secret');` then
   `select public.aktau_schedule_jobs();` to register the 8 schedules (the latest definition is in
   `20260925000100_afisha.sql`; do not re-run the older cron migration, it has no afisha job).

## iOS

`apps/ios` — open `Aktau.xcodeproj` (regenerate with `python3 gen-xcodeproj.py`).
The widget renders `/api/widget/state` verbatim, refreshes at the backend's
`refresh_after` (next known transition, ≤ 30 min), caches the last payload in the
App Group, and taps open `aktau://event/{id}`. A Live Activity is started only for
ACTIVE incidents that directly affect the user, updated on ETA changes, and ended
on resolution. Push (FCM → APNs) deliveries are recorded as `PENDING` until a sender
is configured; in-app deliveries are complete.

## Not built (on purpose)

Own routing, own POI database, own weather model, live bus GPS (no legitimate
feed), predicted ETAs, microservices. The React Native app is replaced by a
native SwiftUI host for the widget; any client can consume the same API.

Map & place data © OpenStreetMap contributors (ODbL). Weather: Open-Meteo.
Observations: RSE Kazhydromet via WMO WIS2.
