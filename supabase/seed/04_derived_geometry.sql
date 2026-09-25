-- Derived geometry (runs after areas + buildings).

-- Districts that OSM names but has no polygon for: buffered hull of their
-- addressed buildings. Marked as derived so the UI can label it.
update areas a set
  geometry = h.g,
  centroid = ST_PointOnSurface(h.g::geometry)::geography,
  metadata = a.metadata || '{"geometry_source":"buildings_hull"}'::jsonb
from (
  select b.area_id,
         ST_Buffer(ST_ConvexHull(ST_Collect(b.point::geometry))::geography, 60) as g
  from buildings b group by b.area_id having count(*) >= 3
) h
where h.area_id = a.id and a.geometry is null;

-- The city itself: hull of all microdistricts plus a margin.
insert into areas (slug, name, name_en, name_ru, name_kk, area_type, geometry, centroid, search_text, metadata)
select 'aktau', 'Aktau', 'Aktau', 'Актау', 'Ақтау', 'CITY',
       ST_Buffer(ST_ConvexHull(ST_Collect(geometry::geometry))::geography, 400),
       ST_SetSRID(ST_MakePoint(51.1722, 43.6532), 4326)::geography,
       'aktau актау ақтау city город қала',
       '{"geometry_source":"microdistrict_hull"}'::jsonb
from areas where area_type = 'MICRODISTRICT' and geometry is not null
on conflict (slug) do nothing;

update areas set parent_id = (select id from areas where slug = 'aktau') where area_type = 'MICRODISTRICT';

-- Caspian coast reference point used for marine conditions (Aktau waterfront).
insert into areas (slug, name, name_en, name_ru, name_kk, area_type, centroid, search_text, metadata) values
('aktau-coast', 'Aktau waterfront', 'Aktau waterfront', 'Набережная Актау', 'Ақтау жағалауы', 'COASTAL_ZONE',
 ST_SetSRID(ST_MakePoint(51.1300, 43.6420), 4326)::geography,
 'coast sea caspian набережная море каспий жағалау теңіз',
 '{"note":"reference point for modelled marine conditions"}'::jsonb)
on conflict (slug) do nothing;
