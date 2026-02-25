create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lifecycle_stage text not null default 'lead' check (lifecycle_stage in ('lead', 'active_client', 'past_client')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member', 'finance_viewer')),
  created_at timestamptz not null default now(),
  unique (account_id, user_id)
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  full_name text,
  company text,
  locale_pref text check (locale_pref in ('en', 'sr-ME', 'ru', 'uk')),
  phones text[] not null default '{}',
  emails text[] not null default '{}',
  consent_marketing boolean not null default false,
  consent_ts timestamptz,
  lifecycle_stage text not null default 'lead' check (lifecycle_stage in ('lead', 'active_client', 'past_client')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_identities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('web', 'telegram', 'whatsapp', 'instagram', 'facebook')),
  channel_user_id text not null,
  username text,
  phone text,
  email text,
  match_confidence numeric(5,2),
  pending_link_customer_id uuid references public.customers(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (channel, channel_user_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('web', 'telegram', 'whatsapp', 'instagram', 'facebook')),
  channel_user_id text,
  status text not null default 'open' check (status in ('open', 'qualified', 'hot', 'handoff', 'closed')),
  locale text check (locale in ('en', 'sr-ME', 'ru', 'uk')),
  lead_intent_score int not null default 0,
  assigned_manager_id uuid references auth.users(id) on delete set null,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'manager', 'system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  visibility text not null default 'internal' check (visibility in ('internal', 'client_visible')),
  platform_message_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.memory_snapshots (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers(id) on delete cascade,
  summary text not null default '',
  open_needs jsonb not null default '[]'::jsonb,
  budget_hint text,
  timeline_hint text,
  service_interest text[] not null default '{}',
  last_updated_at timestamptz not null default now()
);

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  event_type text not null check (event_type in ('qualified', 'hot', 'handoff', 'won', 'lost')),
  priority text not null check (priority in ('low', 'medium', 'high')),
  intent_score int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.channel_integrations (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('web', 'telegram', 'whatsapp', 'instagram', 'facebook')),
  is_enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel)
);

create table if not exists public.webhook_idempotency (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('web', 'telegram', 'whatsapp', 'instagram', 'facebook')),
  platform_message_id text not null,
  checksum text,
  created_at timestamptz not null default now(),
  unique (channel, platform_message_id)
);

create table if not exists public.dead_letter_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('web', 'telegram', 'whatsapp', 'instagram', 'facebook')),
  platform_message_id text,
  payload jsonb not null default '{}'::jsonb,
  error_message text not null,
  attempts int not null default 0,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'blocked', 'done')),
  health text not null default 'green' check (health in ('green', 'yellow', 'red')),
  start_date date,
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'blocked', 'done')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  external_ref text,
  amount numeric(12,2) not null default 0,
  currency text not null default 'EUR',
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'overdue', 'void')),
  due_date date,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount numeric(12,2) not null default 0,
  currency text not null default 'EUR',
  status text not null default 'pending' check (status in ('pending', 'settled', 'failed', 'refunded')),
  provider text,
  reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  type text not null check (type in ('bot', 'manager_note', 'email', 'portal_update')),
  visibility text not null default 'internal' check (visibility in ('internal', 'client_visible')),
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation_created_at on public.messages (conversation_id, created_at desc);
create index if not exists idx_conversations_customer on public.conversations (customer_id, updated_at desc);
create index if not exists idx_conversations_channel_user on public.conversations (channel, channel_user_id, updated_at desc);
create index if not exists idx_lead_events_customer on public.lead_events (customer_id, created_at desc);
create index if not exists idx_lead_events_conversation on public.lead_events (conversation_id, created_at desc);
create index if not exists idx_projects_account on public.projects (account_id, updated_at desc);
create index if not exists idx_invoices_account on public.invoices (account_id, issued_at desc nulls last);
create index if not exists idx_payments_account on public.payments (account_id, paid_at desc nulls last);
create index if not exists idx_communications_account on public.communications (account_id, created_at desc);

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at before update on public.accounts for each row execute function public.set_updated_at();
drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at before update on public.conversations for each row execute function public.set_updated_at();
drop trigger if exists trg_channel_integrations_updated_at on public.channel_integrations;
create trigger trg_channel_integrations_updated_at before update on public.channel_integrations for each row execute function public.set_updated_at();
drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
drop trigger if exists trg_project_milestones_updated_at on public.project_milestones;
create trigger trg_project_milestones_updated_at before update on public.project_milestones for each row execute function public.set_updated_at();
drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at before update on public.invoices for each row execute function public.set_updated_at();
drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at before update on public.payments for each row execute function public.set_updated_at();
drop trigger if exists trg_communications_updated_at on public.communications;
create trigger trg_communications_updated_at before update on public.communications for each row execute function public.set_updated_at();

create or replace function public.append_message_updates_conversation()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_message_updates_conversation on public.messages;
create trigger trg_message_updates_conversation
after insert on public.messages
for each row execute function public.append_message_updates_conversation();

create or replace function public.current_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text from public.admin_users where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_account_member(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_members am
    where am.account_id = target_account_id
      and am.user_id = auth.uid()
  );
$$;

grant execute on function public.current_admin_role() to authenticated;
grant execute on function public.is_account_member(uuid) to authenticated;

alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.admin_users enable row level security;
alter table public.customers enable row level security;
alter table public.customer_identities enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memory_snapshots enable row level security;
alter table public.lead_events enable row level security;
alter table public.channel_integrations enable row level security;
alter table public.webhook_idempotency enable row level security;
alter table public.dead_letter_events enable row level security;
alter table public.projects enable row level security;
alter table public.project_milestones enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.communications enable row level security;

create policy "admin_users_select_self_or_admin" on public.admin_users
for select using (user_id = auth.uid() or public.current_admin_role() in ('owner', 'manager'));

create policy "admin_rw_accounts" on public.accounts
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_rw_account_members" on public.account_members
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_or_member_customers_read" on public.customers
for select using (
  public.current_admin_role() is not null
  or (account_id is not null and public.is_account_member(account_id))
);

create policy "admin_rw_customers" on public.customers
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_rw_customer_identities" on public.customer_identities
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_rw_conversations" on public.conversations
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_or_member_messages_select" on public.messages
for select using (
  public.current_admin_role() is not null
  or exists (
    select 1
    from public.conversations c
    join public.customers cu on cu.id = c.customer_id
    where c.id = messages.conversation_id
      and messages.visibility = 'client_visible'
      and cu.account_id is not null
      and public.is_account_member(cu.account_id)
  )
);

create policy "admin_rw_messages" on public.messages
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_rw_memory_snapshots" on public.memory_snapshots
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_rw_lead_events" on public.lead_events
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_rw_channel_integrations" on public.channel_integrations
for all using (public.current_admin_role() = 'owner')
with check (public.current_admin_role() = 'owner');

create policy "admin_rw_webhook_idempotency" on public.webhook_idempotency
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_rw_dead_letter_events" on public.dead_letter_events
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_or_member_projects_select" on public.projects
for select using (
  public.current_admin_role() is not null
  or public.is_account_member(account_id)
);

create policy "admin_rw_projects" on public.projects
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_or_member_project_milestones_select" on public.project_milestones
for select using (
  public.current_admin_role() is not null
  or exists (
    select 1 from public.projects p
    where p.id = project_milestones.project_id
      and public.is_account_member(p.account_id)
  )
);

create policy "admin_rw_project_milestones" on public.project_milestones
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_or_member_invoices_select" on public.invoices
for select using (
  public.current_admin_role() is not null
  or public.is_account_member(account_id)
);

create policy "admin_rw_invoices" on public.invoices
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_or_member_payments_select" on public.payments
for select using (
  public.current_admin_role() is not null
  or public.is_account_member(account_id)
);

create policy "admin_rw_payments" on public.payments
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "admin_or_member_communications_select" on public.communications
for select using (
  public.current_admin_role() is not null
  or (
    visibility = 'client_visible'
    and account_id is not null
    and public.is_account_member(account_id)
  )
);

create policy "admin_rw_communications" on public.communications
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create or replace function public.retention_cleanup(retention_days integer default 180)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.messages
  where created_at < now() - make_interval(days => retention_days);
end;
$$;
