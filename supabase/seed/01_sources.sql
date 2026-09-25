-- Sources Aktau ingests from. authority_level drives conflict resolution:
--   100 official utility · 90–95 national services · 80 akimat/government ·
--   70 109 hotline · 50 verified local media · 40 model/provider APIs ·
--   30 community map data · 20 resident reports.
-- adapter_type 'manual' = no safe automated feed; the admin ingestion panel
-- is the path (and the connector registry reports it honestly as "manual").

insert into sources (slug, name, organization, source_type, authority_level, base_url, adapter_type, enabled, poll_interval_seconds, language, supports_structured_data, notes) values
('kazhydromet_wis2', 'Kazhydromet', 'RSE Kazhydromet (WMO WIS2 node)', 'OFFICIAL', 95, 'https://wis2box.kazhydromet.kz/oapi', 'kazhydromet_wis2', true, 1800, 'en', true, 'Official SYNOP surface observations, station Aktau 0-398-0-38111.'),
('open_meteo', 'Open-Meteo', 'Open-Meteo.com', 'API', 40, 'https://api.open-meteo.com/v1/forecast', 'open_meteo_forecast', true, 600, 'en', true, 'Numerical weather model forecast. Always labelled as a forecast.'),
('open_meteo_marine', 'Open-Meteo Marine', 'Open-Meteo.com', 'API', 40, 'https://marine-api.open-meteo.com/v1/marine', 'open_meteo_marine', true, 1800, 'en', true, 'Modelled Caspian conditions. Not a swimming or navigation safety status.'),
('open_meteo_air', 'Open-Meteo Air Quality', 'Open-Meteo.com / CAMS', 'API', 40, 'https://air-quality-api.open-meteo.com/v1/air-quality', 'open_meteo_air', true, 3600, 'en', true, 'Modelled air quality estimate, not a station measurement.'),
('aktau_akimat', 'Aktau Akimat', 'Akimat of Aktau city (gov.kz)', 'GOVERNMENT', 80, 'https://www.gov.kz/memleket/entities/mangystau-aktau', 'manual', true, null, 'kk', false, 'gov.kz content API refuses automated clients ("notAllowed"); we do not bypass it. Notices are ingested through /admin/ingest.'),
('mangystau_109', 'Mangystau 109', 'Unified contact centre 109, Mangystau region', 'GOVERNMENT', 70, null, 'manual', true, null, 'ru', false, 'No public feed. Manual ingestion.'),
('maek', 'MAEK', 'MAEK LLP (Mangistau Atomic Energy Complex)', 'OFFICIAL', 100, 'https://www.maek.kz', 'manual', true, null, 'ru', false, 'Water desalination, heat and power producer. Manual ingestion.'),
('kzhsa', 'KZhSA', 'Kaspiy Zhylu Su Arnasy (water & heat distribution)', 'OFFICIAL', 100, null, 'manual', true, null, 'ru', false, 'Water and heat networks. Manual ingestion.'),
('aues', 'AUES', 'GKP AUES (Aktau electricity distribution)', 'OFFICIAL', 100, null, 'manual', true, null, 'ru', false, 'Electricity distribution. Announcements usually reach the public via media (e.g. Lada.kz) — both publisher and authority are preserved.'),
('lada', 'Lada.kz', 'Lada.kz — Aktau local media', 'MEDIA', 50, 'https://www.lada.kz', 'lada_html', true, 900, 'ru', true, 'Discovery source. Uses the public news sitemap and the NewsArticle JSON-LD on article pages; respects robots.txt. Never treated as the authority itself.'),
('osm_overpass', 'OpenStreetMap', 'OpenStreetMap contributors (Overpass API)', 'API', 30, 'https://overpass-api.de/api/interpreter', 'osm_overpass', true, 86400, null, true, 'Places fallback. One batched query per refresh, cached in the database.'),
('nominatim', 'Nominatim', 'OpenStreetMap Nominatim', 'API', 30, 'https://nominatim.openstreetmap.org', 'nominatim', true, null, null, true, 'Last-resort geocoder: 1 req/s, cached, never used for autocomplete.'),
('dgis', '2GIS', '2GIS', 'PROVIDER', 40, 'https://catalog.api.2gis.com/3.0', 'dgis_places', true, 86400, 'ru', true, 'Optional (DGIS_API_KEY). Places, ratings, opening hours, public transport routing.'),
('egov_open_data', 'data.egov.kz', 'Kazakhstan Open Data portal', 'GOVERNMENT', 60, 'https://data.egov.kz/api/v4', 'egov_open_data', false, 604800, 'ru', true, 'Optional (EGOV_API_KEY). Only datasets that answer a product question.'),
('community_reports', 'Resident reports', 'Aktau residents', 'COMMUNITY', 20, null, 'manual', true, null, null, false, 'Possible issues reported by residents. Never shown as confirmed.')
on conflict (slug) do nothing;
