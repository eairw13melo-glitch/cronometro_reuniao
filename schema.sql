-- Cronômetro Vida e Ministério — estrutura Supabase
-- Execute este arquivo no SQL Editor do seu projeto Supabase.

create extension if not exists pgcrypto;

create table if not exists public.meeting_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  share_code text not null,
  title text not null default '',
  state jsonb not null default '{}'::jsonb,
  public_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meeting_states add column if not exists public_state jsonb not null default '{}'::jsonb;
alter table public.meeting_states add column if not exists created_at timestamptz not null default now();
alter table public.meeting_states add column if not exists updated_at timestamptz not null default now();

create unique index if not exists meeting_states_share_code_key
  on public.meeting_states (share_code);
create index if not exists meeting_states_owner_updated_idx
  on public.meeting_states (owner_id, updated_at desc);

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

drop trigger if exists meeting_states_set_updated_at on public.meeting_states;
create trigger meeting_states_set_updated_at
before update on public.meeting_states
for each row execute function public.set_updated_at();

alter table public.meeting_states enable row level security;

revoke all on table public.meeting_states from anon;
grant select, insert, update, delete on table public.meeting_states to authenticated;

drop policy if exists "owners can read meetings" on public.meeting_states;
create policy "owners can read meetings"
on public.meeting_states for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "owners can create meetings" on public.meeting_states;
create policy "owners can create meetings"
on public.meeting_states for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "owners can update meetings" on public.meeting_states;
create policy "owners can update meetings"
on public.meeting_states for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "owners can delete meetings" on public.meeting_states;
create policy "owners can delete meetings"
on public.meeting_states for delete
to authenticated
using ((select auth.uid()) = owner_id);

-- Histórico sincronizado em registros separados para não aumentar o estado da reunião ativa.
create table if not exists public.meeting_archives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  archived_at timestamptz not null,
  title text not null default '',
  total_planned_ms bigint not null default 0,
  total_used_ms bigint not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, local_id)
);

create index if not exists meeting_archives_owner_archived_idx
  on public.meeting_archives (owner_id, archived_at desc);

alter table public.meeting_archives enable row level security;

revoke all on table public.meeting_archives from anon;
grant select, insert, update, delete on table public.meeting_archives to authenticated;

drop policy if exists "owners can read archives" on public.meeting_archives;
create policy "owners can read archives"
on public.meeting_archives for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "owners can create archives" on public.meeting_archives;
create policy "owners can create archives"
on public.meeting_archives for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "owners can update archives" on public.meeting_archives;
create policy "owners can update archives"
on public.meeting_archives for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "owners can delete archives" on public.meeting_archives;
create policy "owners can delete archives"
on public.meeting_archives for delete
to authenticated
using ((select auth.uid()) = owner_id);

-- A tela pública recebe somente o resumo necessário, nunca o estado completo.
create or replace function public.get_meeting_presentation(p_share_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select ms.public_state
  from public.meeting_states as ms
  where ms.share_code = upper(trim(p_share_code))
  limit 1;
$$;

revoke all on function public.get_meeting_presentation(text) from public;
grant execute on function public.get_meeting_presentation(text) to anon, authenticated;

-- Habilita eventos de alteração para sincronizar controladores em outros dispositivos.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meeting_states'
  ) then
    alter publication supabase_realtime add table public.meeting_states;
  end if;
end $$;
