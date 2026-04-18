-- Voz del Cliente — Supabase schema
-- Apply via Supabase SQL editor after creating the project.
--
-- Security model:
--   - raw_reviews: writable ONLY by service role (server-side). anon role has no access.
--   - classified_reviews: writable by service role, read-only to anon (aggregate reads via views).
--   - weekly_briefs: readable by anon (aggregates only, no PII). Writable by service role.
--
-- After running this file, verify in Supabase Dashboard → Authentication → Policies
-- that every table shows RLS = ENABLED.

-- ---------- raw_reviews ----------
create table if not exists public.raw_reviews (
  id text primary key,                  -- deterministic id from source+review_id
  source text not null check (source in ('google_play','app_store')),
  rating int not null check (rating between 1 and 5),
  review_date timestamptz not null,
  text text not null,
  language text,
  country text default 'MX',
  raw_author_id text,
  fetched_at timestamptz not null default now()
);

create index if not exists raw_reviews_date_idx on public.raw_reviews (review_date desc);
create index if not exists raw_reviews_source_idx on public.raw_reviews (source);

alter table public.raw_reviews enable row level security;
-- No policies created: anon role has NO access. Service role bypasses RLS.

-- ---------- classified_reviews ----------
create table if not exists public.classified_reviews (
  review_id text primary key references public.raw_reviews(id) on delete cascade,
  vertical text not null,
  pain_point text not null,
  sentiment int not null check (sentiment between 1 and 5),
  summary_es text not null,
  classified_at timestamptz not null default now()
);

create index if not exists classified_vertical_idx on public.classified_reviews (vertical);
create index if not exists classified_pain_idx on public.classified_reviews (pain_point);

alter table public.classified_reviews enable row level security;
-- No policies: anon gets aggregates via weekly_briefs only.

-- ---------- weekly_briefs ----------
create table if not exists public.weekly_briefs (
  id text primary key,                  -- e.g. "2026-W16-food"
  week_start date not null,
  vertical text not null,
  total_reviews int not null,
  negative_share numeric(5,4) not null,
  top_pain_points jsonb not null,
  clusters jsonb not null,
  generated_at timestamptz not null default now()
);

create index if not exists briefs_week_idx on public.weekly_briefs (week_start desc);
create index if not exists briefs_vertical_idx on public.weekly_briefs (vertical);

alter table public.weekly_briefs enable row level security;

-- Anon role: read-only access to the aggregates table.
create policy "weekly_briefs anon read"
  on public.weekly_briefs
  for select
  to anon
  using (true);

-- No insert/update/delete policies for anon — only service role can mutate.
