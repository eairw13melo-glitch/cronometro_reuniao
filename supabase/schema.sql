-- Execute este arquivo no SQL Editor do Supabase.
-- O aplicativo continua funcionando localmente mesmo sem este banco.

create extension if not exists pgcrypto;

create table if not exists public.meeting_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  share_code text not null unique check (char_length(share_code) = 6),
  title text not null default 'Reunião',
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_states_owner_id_idx on public.meeting_states(owner_id);
create index if not exists meeting_states_share_code_idx on public.meeting_states(share_code);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
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

create policy "owner can select own meetings"
on public.meeting_states for select
to authenticated
using (auth.uid() = owner_id);

create policy "owner can insert own meetings"
on public.meeting_states for insert
to authenticated
with check (auth.uid() = owner_id);

create policy "owner can update own meetings"
on public.meeting_states for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "owner can delete own meetings"
on public.meeting_states for delete
to authenticated
using (auth.uid() = owner_id);

-- Entrega somente a reunião correspondente ao código informado.
create or replace function public.get_shared_meeting(p_code text)
returns table (
  share_code text,
  title text,
  state jsonb,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select m.share_code, m.title, m.state, m.updated_at
  from public.meeting_states m
  where upper(m.share_code) = upper(trim(p_code))
  limit 1;
$$;

revoke all on function public.get_shared_meeting(text) from public;
grant execute on function public.get_shared_meeting(text) to anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.meeting_states to authenticated;

-- Realtime Broadcast usa canais do Supabase e não exige liberar leitura pública da tabela.
