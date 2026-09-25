-- Caspian Safety registry for the city of Aktau (runs after 05_coastline.sql).
--
-- LEGAL status is transcribed by hand from the authorities, verified 2026-09-24:
--   OFFICIAL    Постановление акимата Мангистауской области от 31.07.2019 № 171
--               «Об установлении мест для массового отдыха, туризма и спорта на
--               водных объектах…», приложение в редакции от 26.06.2026 № 99
--               (Эталонный контрольный банк НПА РК). Items 2, 3, 11–13, 15, 19–21
--               were removed by № 99 and are NOT listed here.
--   PROHIBITED  Департамент полиции Мангистауской области, «Где в Актау и
--               Мангистау запрещено купаться», gov.kz, 09.07.2026.
--
-- The act lists names only. Locations: OSM (© OpenStreetMap contributors, ODbL)
-- or the place's own 2GIS card; 'approximate' when the name does not match
-- exactly; 'unmapped' when no map source names it. Unmapped entries are listed
-- in the app but never drawn and never used to answer "can I swim here?".
-- When the act is amended: update this list, the revision date, and verified_at.

insert into coast_zones (slug, legal_status, name, name_ru, name_kk, official_text, source_authority, source_title, source_url, source_ref, source_revision, verified_at, location_confidence, location_source, location_note, anchor, sort) values
('flamingo', 'OFFICIAL', 'Flamingo beach', 'Пляж «Фламинго»', '«Фламинго» жағажайы', 'пляж «Фламинго»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 1', '2026-06-26', '2026-09-24',
 'approximate', '2GIS: «Фламинго»', 'A place named «Фламинго» in the southern resort zone; not confirmed as this beach.', ST_SetSRID(ST_MakePoint(51.319415, 43.440215), 4326)::geography, 1),
('dostar', 'OFFICIAL', 'Dostar beach', 'Пляж «Достар»', '«Достар» жағажайы', 'пляж «Достар»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 4', '2026-06-26', '2026-09-24',
 'mapped', 'OSM way 633231283 (natural=beach, "dostar beach"); 2GIS «Достар, пляж»', null, ST_SetSRID(ST_MakePoint(51.21068, 43.61898), 4326)::geography, 4),
('guna', 'OFFICIAL', 'GUNA beach', 'Пляж «GUNA»', '«GUNA» жағажайы', 'пляж «GUNA»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 5', '2026-06-26', '2026-09-24',
 'mapped', '2GIS: «Guna»', null, ST_SetSRID(ST_MakePoint(51.281081, 43.542068), 4326)::geography, 5),
('serebryanye-peski', 'OFFICIAL', 'Silver Sands beach', 'Пляж «Серебряные пески»', '«Серебряные пески» жағажайы', 'пляж «Серебрянные пески»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 6', '2026-06-26', '2026-09-24',
 'mapped', '2GIS: «Серебряные пески»', null, ST_SetSRID(ST_MakePoint(51.285418, 43.534774), 4326)::geography, 6),
('stigl', 'OFFICIAL', 'Stigl beach', 'Пляж «Stigl»', '«Stigl» жағажайы', 'пляж «Stigl»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 7', '2026-06-26', '2026-09-24',
 'mapped', '2GIS: «Stigl»', null, ST_SetSRID(ST_MakePoint(51.275421, 43.55588), 4326)::geography, 7),
('komarova', 'OFFICIAL', 'Komarova beach', 'Пляж «Комарова»', '«Комарова» жағажайы', 'пляж «Комарова»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 8', '2026-06-26', '2026-09-24',
 'approximate', '2GIS: «Комарово»', 'Map name «Комарово» differs from the act («Комарова»).', ST_SetSRID(ST_MakePoint(51.286863, 43.531542), 4326)::geography, 8),
('montazhnik', 'OFFICIAL', 'Montazhnik beach', 'Пляж «Монтажник»', '«Монтажник» жағажайы', 'пляж «Монтажник»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 9', '2026-06-26', '2026-09-24',
 'unmapped', null, 'Not found in OSM or 2GIS.', null, 9),
('blue-marine', 'OFFICIAL', 'Blue Marine beach', 'Пляж «Blue Marine»', '«Blue Marine» жағажайы', 'пляж «Blue Marine»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 10', '2026-06-26', '2026-09-24',
 'mapped', '2GIS: «Blue Marine»', null, ST_SetSRID(ST_MakePoint(51.282792, 43.538875), 4326)::geography, 10),
('tree-of-life', 'OFFICIAL', 'Tree of Life beach', 'Пляж «Tree of life»', '«Tree of life» жағажайы', 'пляж «Tree of life»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 14', '2026-06-26', '2026-09-24',
 'mapped', '2GIS: «Tree of life resort»; OSM node 5039304121', null, ST_SetSRID(ST_MakePoint(51.315864, 43.451912), 4326)::geography, 14),
('briz', 'OFFICIAL', 'Briz beach', 'Пляж «Бриз»', '«Бриз» жағажайы', 'пляж «Бриз»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 16', '2026-06-26', '2026-09-24',
 'unmapped', null, 'Not found in OSM or 2GIS.', null, 16),
('rixos', 'OFFICIAL', 'Rixos Water World Aktau beach', 'Пляж гостиницы «Rixos Water World Aktau»', '«Rixos Water World Aktau» қонақүйінің жағажайы', 'пляж гостиницы «Rixos Water World Aktau»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 17', '2026-06-26', '2026-09-24',
 'mapped', 'OSM node 12083602869 (tourism=hotel)', null, ST_SetSRID(ST_MakePoint(51.29683, 43.50675), 4326)::geography, 17),
('aquamarine', 'OFFICIAL', 'Aquamarine beach', 'Пляж «Aquamarine»', '«Aquamarine» жағажайы', 'пляж «Aquamarine»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 18', '2026-06-26', '2026-09-24',
 'unmapped', null, 'Not found in OSM or 2GIS for Aktau.', null, 18),
('soldatsky', 'OFFICIAL', 'Soldatsky beach', 'Пляж «Солдатский»', '«Солдатский» жағажайы', 'пляж «Солдатский»',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 22', '2026-06-26', '2026-09-24',
 'mapped', '2GIS: «Пляж Солдатский»', null, ST_SetSRID(ST_MakePoint(51.207148, 43.621543), 4326)::geography, 22),
('briz-right-4a', 'OFFICIAL', 'Beach right of Briz yacht club (4A mkr)', 'Пляж справа от яхт-клуба «Бриз» (4а мкр)', '«Бриз» яхт-клубының оң жағындағы жағажай (4а ш/а)', 'пляж справа от яхт-клуба «Бриз» в 4а микрорайоне',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 23', '2026-06-26', '2026-09-24',
 'unmapped', null, 'Yacht club «Бриз» is not named in OSM or 2GIS.', null, 23),
('briz-left-1', 'OFFICIAL', 'Beach left of Briz yacht club (1 mkr)', 'Пляж слева от яхт-клуба «Бриз» (1 мкр)', '«Бриз» яхт-клубының сол жағындағы жағажай (1 ш/а)', 'пляж слева от яхт-клуба «Бриз» в 1 микрорайоне',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 24', '2026-06-26', '2026-09-24',
 'unmapped', null, 'Yacht club «Бриз» is not named in OSM or 2GIS.', null, 24),
('shevchenko-7a', 'OFFICIAL', 'Beach by the Shevchenko residential complex (7A mkr)', 'Пляж перед ЖК «Шевченко» (7а мкр)', '«Шевченко» ТК алдындағы жағажай (7а ш/а)', 'пляж в 10 метрах перед жилым комплексом «Шевченко» в 7 а микрорайоне',
 'Акимат Мангистауской области', 'Постановление акимата Мангистауской области № 171 (ред. № 99 от 26.06.2026)', 'https://law.gov.kz/api/documents/134306/rus/download/pdf', 'Приложение, п. 25', '2026-06-26', '2026-09-24',
 'unmapped', null, 'ЖК «Шевченко» is not identified on the map.', null, 25),

('riviera-shevchenko', 'PROHIBITED', 'Caspian Riviera to the Taras Shevchenko monument', 'От гостиницы Caspian Riviera до памятника Тарасу Шевченко', 'Caspian Riviera қонақүйінен Тарас Шевченко ескерткішіне дейін', 'участок побережья от гостиницы Caspian Riviera (4А микрорайон) до памятника Тарасу Шевченко (5 микрорайон)',
 'Департамент полиции Мангистауской области', 'Где в Актау и Мангистау запрещено купаться (09.07.2026)', 'https://www.gov.kz/memleket/entities/mvd-mangystau/press/news/details/1255972?lang=ru', null, '2026-07-09', '2026-09-24',
 'mapped', 'Shore between OSM way 186683578 (Caspian Riviera Grand Palace Hotel) and OSM node 4163499839 (memorial to Taras Shevchenko)', null, ST_SetSRID(ST_MakePoint(51.15949, 43.63314), 4326)::geography, 101),
('shora-canal', 'PROHIBITED', 'Shora canal shore', 'Прибрежная зона водоканала «Шора»', '«Шора» су арнасының жағалауы', 'прибрежная зона водоканала «Шора»',
 'Департамент полиции Мангистауской области', 'Где в Актау и Мангистау запрещено купаться (09.07.2026)', 'https://www.gov.kz/memleket/entities/mvd-mangystau/press/news/details/1255972?lang=ru', null, '2026-07-09', '2026-09-24',
 'unmapped', null, 'The canal is not named in OSM or 2GIS.', null, 102),
('maek-canal', 'PROHIBITED', 'Near the MAEK canal', 'Территория возле водоканала МАЭК', 'МАЭК су арнасының маңы', 'территория возле водоканала МАЭК',
 'Департамент полиции Мангистауской области', 'Где в Актау и Мангистау запрещено купаться (09.07.2026)', 'https://www.gov.kz/memleket/entities/mvd-mangystau/press/news/details/1255972?lang=ru', null, '2026-07-09', '2026-09-24',
 'unmapped', null, 'The canal is not named in OSM or 2GIS.', null, 103)
on conflict (slug) do nothing;

-- ── Derived shore geometry ──────────────────────────────────────────────────
-- The mainland shore as one line (the closed pier ring is left out).
create temporary table _shore on commit drop as
select (ST_Dump(ST_LineMerge(ST_Collect(geometry::geometry)))).geom g from coastline where not ST_IsClosed(geometry::geometry);

-- Official beaches: the shore within 150 m of the point nearest the beach's
-- map location (only when that location is within 800 m of the shore).
update coast_zones z set geometry = s.stretch::geography
from (
  select z2.id, ST_Intersection(sh.g, ST_Buffer(ST_ClosestPoint(sh.g, z2.anchor::geometry)::geography, 150)::geometry) stretch
  from coast_zones z2
  cross join lateral (select g from _shore order by g <-> z2.anchor::geometry limit 1) sh
  where z2.legal_status = 'OFFICIAL' and z2.anchor is not null and ST_Distance(sh.g::geography, z2.anchor) < 800
) s
where z.id = s.id and z.geometry is null;

-- Caspian Riviera → Taras Shevchenko monument: the shore between them.
update coast_zones z set geometry = ST_LineSubstring(sh.g, least(a.f, b.f), greatest(a.f, b.f))::geography
from _shore sh,
  lateral (select ST_LineLocatePoint(sh.g, ST_SetSRID(ST_MakePoint(51.15949, 43.63314), 4326)) f) a,
  lateral (select ST_LineLocatePoint(sh.g, ST_SetSRID(ST_MakePoint(51.15828, 43.63574), 4326)) f) b
where z.slug = 'riviera-shevchenko' and z.geometry is null
  and sh.g = (select g from _shore order by g <-> ST_SetSRID(ST_MakePoint(51.15949, 43.63314), 4326) limit 1);

-- Anything that could not be placed on the shore is not drawn.
update coast_zones set location_confidence = 'unmapped', location_note = coalesce(location_note || ' ', '') || 'Map location is too far from the shore to place.'
where geometry is null and location_confidence <> 'unmapped';
