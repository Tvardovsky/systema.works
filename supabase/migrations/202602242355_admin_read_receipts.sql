alter table public.conversations
  add column if not exists last_inbound_message_at timestamptz;

create table if not exists public.admin_conversation_reads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  last_read_message_id uuid references public.messages(id) on delete set null,
  first_read_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, admin_user_id)
);

create index if not exists idx_admin_reads_admin_last_read on public.admin_conversation_reads (admin_user_id, last_read_at desc);
create index if not exists idx_admin_reads_conversation_admin on public.admin_conversation_reads (conversation_id, admin_user_id);
create index if not exists idx_admin_reads_conversation_last_read on public.admin_conversation_reads (conversation_id, last_read_at desc);
create index if not exists idx_conversations_last_inbound_message_at on public.conversations (last_inbound_message_at desc);

create or replace function public.append_message_updates_conversation()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
  set
    updated_at = now(),
    last_inbound_message_at = case
      when new.role = 'user' then new.created_at
      else last_inbound_message_at
    end
  where id = new.conversation_id;
  return new;
end;
$$;

update public.conversations c
set last_inbound_message_at = latest.last_inbound_message_at
from (
  select
    conversation_id,
    max(created_at) as last_inbound_message_at
  from public.messages
  where role = 'user'
  group by conversation_id
) latest
where c.id = latest.conversation_id
  and (
    c.last_inbound_message_at is null
    or c.last_inbound_message_at < latest.last_inbound_message_at
  );

drop trigger if exists trg_admin_conversation_reads_updated_at on public.admin_conversation_reads;
create trigger trg_admin_conversation_reads_updated_at
before update on public.admin_conversation_reads
for each row execute function public.set_updated_at();

alter table public.admin_conversation_reads enable row level security;

drop policy if exists "admin_rw_admin_conversation_reads" on public.admin_conversation_reads;
create policy "admin_rw_admin_conversation_reads" on public.admin_conversation_reads
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);
