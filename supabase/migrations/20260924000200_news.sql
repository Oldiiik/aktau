-- City news: Aktau stories from local media, shown as headline + the
-- publisher's own summary + a link to the full article. We never republish
-- article bodies. The raw fetch is preserved in source_items like any source.

insert into sources (slug, name, organization, source_type, authority_level, base_url, adapter_type, enabled, poll_interval_seconds, language, supports_structured_data, notes) values
('lada_news', 'Lada.kz · News', 'Lada.kz — Aktau local media', 'MEDIA', 50, 'https://www.lada.kz/aktau_news/', 'lada_news', true, 900, 'ru', true,
 'Aktau news for the News page: public news sitemap + Open Graph metadata (headline, summary, image). Links out to the publisher; article bodies are not republished.')
on conflict (slug) do nothing;

create table news_articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  source_item_id uuid references source_items(id) on delete set null,
  external_id text not null,
  url text not null,
  headline text not null,
  -- The publisher's own summary (og:description), never the article body.
  lede text,
  author text,
  image_url text,
  image_width integer,
  image_height integer,
  -- society | vlast | incidents | communal | ecology | ekonomika | culture | sport | region
  section text not null,
  language text,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  is_demo boolean not null default false,
  unique (source_id, external_id)
);
create index news_articles_published_idx on news_articles (published_at desc);
create index news_articles_section_idx on news_articles (section, published_at desc);

alter table news_articles enable row level security;
create policy public_read on news_articles for select using (true);
create policy admin_all on news_articles for all using (is_admin()) with check (is_admin());
