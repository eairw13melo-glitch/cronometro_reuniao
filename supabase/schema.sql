-- Cronômetro Vida e Ministério — esquema Supabase
-- Execute no SQL Editor de um projeto novo.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'admin' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  week_label text not null,
  scheduled_start timestamptz,
  allowed_minutes integer not null default 105 check (allowed_minutes > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  share_code text not null unique,
  share_enabled boolean not null default false,
  current_part_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_parts (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  client_id text not null,
  position integer not null check (position >= 0),
  section text not null check (section in ('neutro', 'tesouros', 'ministerio', 'vida')),
  name text not null,
  speaker text not null default '',
  planned_seconds integer not null default 0 check (planned_seconds >= 0),
  details text not null default '',
  reference_url text,
  count_comments boolean not null default false,
  has_counsel boolean not null default false,
  created_at timestamptz not null default now(),
  unique (meeting_id, position),
  unique (meeting_id, client_id)
);

create table if not exists public.meeting_states (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists meetings_owner_updated_idx on public.meetings(owner_id, updated_at desc);
create index if not exists meetings_share_code_idx on public.meetings(share_code) where share_enabled = true;
create index if not exists meeting_parts_meeting_position_idx on public.meeting_parts(meeting_id, position);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at before update on public.meetings
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_parts enable row level security;
alter table public.meeting_states enable row level security;

-- Permite executar o arquivo novamente sem conflito de políticas.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "meetings_owner_select" on public.meetings;
drop policy if exists "meetings_owner_insert" on public.meetings;
drop policy if exists "meetings_owner_update" on public.meetings;
drop policy if exists "meetings_owner_delete" on public.meetings;
drop policy if exists "parts_owner_all" on public.meeting_parts;
drop policy if exists "states_owner_all" on public.meeting_states;

-- Perfil próprio
create policy "profiles_select_own" on public.profiles
for select to authenticated using (id = auth.uid());
create policy "profiles_update_own" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- O proprietário controla suas reuniões.
create policy "meetings_owner_select" on public.meetings
for select to authenticated using (owner_id = auth.uid());
create policy "meetings_owner_insert" on public.meetings
for insert to authenticated with check (owner_id = auth.uid());
create policy "meetings_owner_update" on public.meetings
for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "meetings_owner_delete" on public.meetings
for delete to authenticated using (owner_id = auth.uid());

-- Partes e estados são controlados somente pelo proprietário.
create policy "parts_owner_all" on public.meeting_parts
for all to authenticated
using (exists (select 1 from public.meetings m where m.id = meeting_id and m.owner_id = auth.uid()))
with check (exists (select 1 from public.meetings m where m.id = meeting_id and m.owner_id = auth.uid()));

create policy "states_owner_all" on public.meeting_states
for all to authenticated
using (exists (select 1 from public.meetings m where m.id = meeting_id and m.owner_id = auth.uid()))
with check (exists (select 1 from public.meetings m where m.id = meeting_id and m.owner_id = auth.uid()));

-- Leitura pública somente por RPC e código exato. As tabelas não ficam enumeráveis para usuários anônimos.
create or replace function public.get_shared_meeting(p_code text)
returns table (meeting_id uuid, week_label text, snapshot jsonb)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.week_label, s.snapshot
  from public.meetings m
  join public.meeting_states s on s.meeting_id = m.id
  where m.share_enabled = true
    and m.share_code = upper(trim(p_code))
  limit 1;
$$;

revoke all on function public.get_shared_meeting(text) from public;
grant execute on function public.get_shared_meeting(text) to anon, authenticated;
