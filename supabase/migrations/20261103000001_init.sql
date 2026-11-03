-- Argus v1 — initial schema.
-- One tenant = one company. Every row carries company_id; RLS filters through company_members.
-- The service role (job runner) bypasses RLS; the browser only ever holds the publishable key.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- companies
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  description text not null default '' check (char_length(description) <= 1000),
  country     text not null default 'TN' check (country ~ '^[A-Z]{2}$'),
  city        text,
  created_at  timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id);

-- Membership check used by every policy. SECURITY DEFINER so it can read company_members without
-- recursing into that table's own policy.
create or replace function public.is_member(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.user_id = auth.uid());
$$;
revoke all on function public.is_member(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;

-- Create a company and its owner membership in one transaction. Slug collisions get a -2, -3 suffix.
create or replace function public.create_company(p_name text, p_description text default '', p_country text default 'TN', p_city text default null)
returns public.companies
language plpgsql security definer set search_path = public
as $$
declare
  base text;
  candidate text;
  n int := 1;
  row public.companies;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  base := trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'));
  if char_length(base) < 2 then base := 'company'; end if;
  base := left(base, 56);
  candidate := base;
  while exists (select 1 from public.companies where slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  insert into public.companies (owner_id, name, slug, description, country, city)
  values (auth.uid(), trim(p_name), candidate, coalesce(p_description, ''), upper(coalesce(p_country, 'TN')), p_city)
  returning * into row;
  insert into public.company_members (company_id, user_id, role) values (row.id, auth.uid(), 'owner');
  return row;
end;
$$;
revoke all on function public.create_company(text, text, text, text) from public;
grant execute on function public.create_company(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- connections (Meta account per company)
create table public.connections (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  provider         text not null check (provider in ('meta')),
  external_user_id text not null,
  external_name    text,
  token_ct         bytea not null,
  token_iv         bytea not null,
  scopes           text[] not null default '{}',
  expires_at       timestamptz,
  status           text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, provider, external_user_id)
);

-- ---------------------------------------------------------------- sources
create table public.sources (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,
  kind          text not null check (kind in ('own_page', 'public_page', 'ad_library_query')),
  external_id   text not null,          -- page id, or the search terms for an ad library query
  name          text not null,
  config        jsonb not null default '{}'::jsonb,
  status        text not null default 'active' check (status in ('active', 'pending_review', 'paused', 'error')),
  last_error    text,
  cursor        timestamptz,             -- newest item already collected
  created_at    timestamptz not null default now(),
  unique (company_id, kind, external_id)
);
create index sources_company_idx on public.sources (company_id);

-- ---------------------------------------------------------------- objectives
create table public.objectives (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  title          text not null check (char_length(title) between 3 and 140),
  description    text not null default '',
  target_kind    text not null default 'market_watch' check (target_kind in ('market_watch')),
  plan           jsonb not null default '{}'::jsonb,   -- watch[], signal_kinds[], ad_library_terms[]
  cadence        text not null default 'daily' check (cadence in ('daily', 'weekly')),
  status         text not null default 'proposed' check (status in ('proposed', 'confirmed', 'paused', 'dismissed')),
  proposed_by    text not null default 'ai' check (proposed_by in ('ai', 'default', 'user')),
  confirmed_at   timestamptz,
  confirmed_by   uuid references auth.users(id) on delete set null,
  last_run_at    timestamptz,
  last_report_at timestamptz,
  created_at     timestamptz not null default now()
);
create index objectives_company_idx on public.objectives (company_id);
create index objectives_due_idx on public.objectives (last_run_at) where status = 'confirmed';

-- ---------------------------------------------------------------- collection runs
create table public.collection_runs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  trigger      text not null default 'cron' check (trigger in ('cron', 'manual')),
  status       text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  items_seen   int not null default 0,
  items_new    int not null default 0,
  items_kept   int not null default 0,
  llm_tokens   int not null default 0,
  log          jsonb not null default '[]'::jsonb,
  error        text
);
create index collection_runs_objective_idx on public.collection_runs (objective_id, started_at desc);

-- ---------------------------------------------------------------- raw items (30-day retention)
create table public.raw_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  source_id   uuid not null references public.sources(id) on delete cascade,
  run_id      uuid references public.collection_runs(id) on delete set null,
  external_id text not null,
  kind        text not null check (kind in ('post', 'comment', 'ad', 'insight')),
  text        text not null default '',
  metrics     jsonb not null default '{}'::jsonb,
  url         text,
  posted_at   timestamptz,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  unique (source_id, external_id)
);
create index raw_items_company_idx on public.raw_items (company_id, fetched_at desc);

-- ---------------------------------------------------------------- signals (what survived the filter)
create table public.signals (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  run_id       uuid references public.collection_runs(id) on delete set null,
  raw_item_id  uuid references public.raw_items(id) on delete set null,
  kind         text not null,
  summary      text not null,
  value        jsonb not null default '{}'::jsonb,   -- numbers{}, entities[]
  importance   smallint not null check (importance between 1 and 5),
  reason       text not null,
  created_at   timestamptz not null default now(),
  unique (objective_id, raw_item_id)
);
create index signals_objective_idx on public.signals (objective_id, created_at desc);

-- ---------------------------------------------------------------- reports
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  title        text not null,
  body_md      text not null,
  evidence     jsonb not null default '{}'::jsonb,   -- the structured report + claim -> signal ids
  status       text not null check (status in ('verified', 'failed')),
  critic       jsonb not null default '[]'::jsonb,   -- problems found by the critic
  created_at   timestamptz not null default now()
);
create index reports_company_idx on public.reports (company_id, created_at desc);

-- ---------------------------------------------------------------- RLS
alter table public.companies       enable row level security;
alter table public.company_members enable row level security;
alter table public.connections     enable row level security;
alter table public.sources         enable row level security;
alter table public.objectives      enable row level security;
alter table public.collection_runs enable row level security;
alter table public.raw_items       enable row level security;
alter table public.signals         enable row level security;
alter table public.reports         enable row level security;

create policy companies_read   on public.companies for select to authenticated using (public.is_member(id));
create policy companies_update on public.companies for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy companies_delete on public.companies for delete to authenticated using (owner_id = auth.uid());
-- inserts go through create_company()

create policy members_read on public.company_members for select to authenticated using (public.is_member(company_id));

-- Tokens: members may write their company's connection; the ciphertext is useless without APP_SECRET (server only).
create policy connections_read  on public.connections for select to authenticated using (public.is_member(company_id));
create policy connections_write on public.connections for insert to authenticated with check (public.is_member(company_id));
create policy connections_upd   on public.connections for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy connections_del   on public.connections for delete to authenticated using (public.is_member(company_id));

create policy sources_read  on public.sources for select to authenticated using (public.is_member(company_id));
create policy sources_write on public.sources for insert to authenticated with check (public.is_member(company_id));
create policy sources_upd   on public.sources for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy sources_del   on public.sources for delete to authenticated using (public.is_member(company_id));

create policy objectives_read  on public.objectives for select to authenticated using (public.is_member(company_id));
create policy objectives_write on public.objectives for insert to authenticated with check (public.is_member(company_id));
create policy objectives_upd   on public.objectives for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Runs, raw items, signals and reports are written by the job runner (service role) only.
create policy runs_read    on public.collection_runs for select to authenticated using (public.is_member(company_id));
create policy raw_read     on public.raw_items       for select to authenticated using (public.is_member(company_id));
create policy signals_read on public.signals         for select to authenticated using (public.is_member(company_id));
create policy reports_read on public.reports         for select to authenticated using (public.is_member(company_id));

-- Nothing is readable by anon.
revoke all on all tables in schema public from anon;
