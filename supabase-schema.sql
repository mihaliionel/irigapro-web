-- ================================================================
-- IrigaPro — Supabase Schema
-- Rulează în: Supabase Dashboard → SQL Editor → New Query
-- ================================================================

-- ── Enable UUID extension ────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Sprinkler models (shared database) ───────────────────────
create table public.sprinkler_models (
  id          uuid default uuid_generate_v4() primary key,
  brand       text not null,
  model       text not null,
  type        text not null check (type in ('Rotativ','Spray fix','Picurare','Micro-jet','Impact','')),
  rmin        numeric(6,2) default 0,
  rmax        numeric(6,2) default 0,
  pmin        numeric(5,2) default 0,
  pmax        numeric(5,2) default 0,
  flow        numeric(6,3) default 0,
  max_angle   integer default 360,
  usage       text default '',
  notes       text,
  created_by  uuid references auth.users(id),
  is_public   boolean default true,
  created_at  timestamptz default now()
);

-- ── Projects ─────────────────────────────────────────────────
create table public.projects (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  name         text not null default 'Proiect nou',
  location     text,
  polygon      jsonb not null default '[]',
  circuits     jsonb not null default '[]',
  sprinklers   jsonb default '[]',
  pipes        jsonb default '[]',
  length_m     numeric(8,2) not null default 10,
  width_m      numeric(8,2) not null default 10,
  area_m2      numeric(10,2),
  notes        text,
  is_public    boolean default false,
  share_token  text unique default encode(gen_random_bytes(12), 'hex'),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Row Level Security ────────────────────────────────────────
alter table public.sprinkler_models enable row level security;
alter table public.projects          enable row level security;

-- Sprinkler models: everyone reads public, owner edits own
create policy "Public models are viewable by everyone"
  on public.sprinkler_models for select
  using (is_public = true or auth.uid() = created_by);

create policy "Users can insert their own models"
  on public.sprinkler_models for insert
  with check (auth.uid() = created_by);

create policy "Users can update their own models"
  on public.sprinkler_models for update
  using (auth.uid() = created_by);

-- Projects: owner has full access, public projects readable by anyone
create policy "Users can CRUD their own projects"
  on public.projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Public projects are viewable by anyone"
  on public.projects for select
  using (is_public = true);

-- ── Auto-update updated_at ────────────────────────────────────
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger on_projects_update
  before update on public.projects
  for each row execute procedure public.handle_updated_at();

-- ── Seed sprinkler database ───────────────────────────────────
insert into public.sprinkler_models (brand, model, type, rmin, rmax, pmin, pmax, flow, max_angle, usage) values
  ('Rain Bird', '3504',            'Rotativ',   3.0, 9.1,  1.4, 3.4, 0.90, 360, 'Gazon mediu/mare'),
  ('Rain Bird', '5000+',           'Rotativ',   6.0, 15.2, 1.7, 4.1, 2.27, 360, 'Gazon mare'),
  ('Rain Bird', '8005',            'Rotativ',   7.6, 15.2, 2.1, 4.8, 3.18, 360, 'Sport/comercial'),
  ('Rain Bird', '42SA Plus',       'Rotativ',   4.6, 9.4,  1.7, 3.8, 1.36, 360, 'Rezidential'),
  ('Rain Bird', '42DA',            'Rotativ',   4.6, 9.4,  1.7, 3.8, 1.36, 360, 'Dual arc'),
  ('Rain Bird', '1800 SAM',        'Spray fix', 1.5, 4.9,  1.0, 3.5, 0.45, 360, 'Zone mici'),
  ('Rain Bird', 'MPR Nozzle',      'Spray fix', 1.2, 4.9,  0.7, 3.1, 0.25, 360, 'Zone mici'),
  ('Rain Bird', 'XFCV Drip',       'Picurare',  0.0, 0.0,  0.7, 4.1, 0.05, 360, 'Gard viu/arbusti'),
  ('Rain Bird', 'T-Bird Micro',    'Micro-jet', 0.5, 3.0,  1.0, 3.5, 0.18, 360, 'Ghivece/flori'),
  ('Rain Bird', '1812 SAM',        'Spray fix', 1.8, 5.8,  1.0, 3.5, 0.55, 360, 'Margini'),
  ('Hunter',    'PGP-ADJ',         'Rotativ',   4.9, 10.7, 1.7, 4.5, 1.36, 360, 'Gazon mediu/mare'),
  ('Hunter',    'PGP Ultra',       'Rotativ',   6.1, 12.8, 1.7, 4.5, 1.81, 360, 'Gazon mare'),
  ('Hunter',    'I-20',            'Rotativ',   6.1, 14.0, 2.1, 4.8, 2.27, 360, 'Comercial/sport'),
  ('Hunter',    'MP Rotator 1000', 'Rotativ',   2.4, 3.5,  1.7, 3.5, 0.23, 360, 'Rezidential mic'),
  ('Hunter',    'MP Rotator 2000', 'Rotativ',   3.0, 4.9,  1.7, 3.5, 0.36, 360, 'Rezidential'),
  ('Hunter',    'MP Rotator 3000', 'Rotativ',   4.0, 6.7,  2.1, 4.5, 0.59, 360, 'Rezidential mare'),
  ('Hunter',    'Pro-Spray PRS30', 'Spray fix', 1.5, 4.9,  1.0, 3.5, 0.45, 360, 'Zone mici'),
  ('Hunter',    'PCB Drip',        'Picurare',  0.0, 0.0,  0.7, 4.1, 0.04, 360, 'Arbusti/legume'),
  ('Toro',      '570Z',            'Spray fix', 1.5, 4.9,  1.0, 3.5, 0.45, 360, 'Zone mici'),
  ('Toro',      'T5 Rotor',        'Rotativ',   4.0, 8.2,  1.4, 3.4, 0.90, 360, 'Rezidential'),
  ('Toro',      'Precision Series','Rotativ',   5.5, 12.2, 2.1, 4.1, 1.81, 360, 'Gazon mare'),
  ('Toro',      'Micro800',        'Micro-jet', 0.3, 2.4,  1.0, 3.5, 0.12, 360, 'Ghivece'),
  ('Orbit',     'Voyager II',      'Rotativ',   3.0, 9.1,  1.4, 3.5, 0.90, 360, 'Rezidential buget'),
  ('Orbit',     'Zinc Impact',     'Impact',    4.5, 12.2, 1.4, 4.1, 1.36, 360, 'Agricol/mare'),
  ('Generic',   'Rotor 360 Basic', 'Rotativ',   3.0, 8.0,  1.5, 3.5, 0.80, 360, 'Universal'),
  ('Generic',   'Spray Fix 180',   'Spray fix', 1.5, 4.0,  1.0, 3.0, 0.40, 180, 'Universal margine'),
  ('Generic',   'Picurare 4L',     'Picurare',  0.0, 0.0,  0.7, 4.0, 0.04, 360, 'Universal'),
  ('Generic',   'Micro-jet 90',    'Micro-jet', 0.5, 2.0,  0.7, 3.0, 0.10,  90, 'Ghivece');
