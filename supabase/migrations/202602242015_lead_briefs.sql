create table if not exists public.lead_briefs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  status text not null default 'collecting' check (status in ('collecting', 'ready_for_handoff', 'handoff')),
  full_name text,
  email text,
  phone text,
  telegram_handle text,
  service_type text,
  primary_goal text,
  first_deliverable text,
  timeline_hint text,
  budget_hint text,
  constraints text,
  missing_fields text[] not null default '{}',
  completeness_score int not null default 0,
  source_channel text check (source_channel in ('web', 'telegram', 'whatsapp', 'instagram', 'facebook')),
  updated_by text not null default 'system' check (updated_by in ('ai', 'manager', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_brief_revisions (
  id uuid primary key default gen_random_uuid(),
  lead_brief_id uuid not null references public.lead_briefs(id) on delete cascade,
  changed_by_type text not null check (changed_by_type in ('ai', 'manager', 'system')),
  changed_by_user_id uuid references auth.users(id) on delete set null,
  before_state jsonb not null,
  after_state jsonb not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_briefs_customer on public.lead_briefs (customer_id, updated_at desc);
create index if not exists idx_lead_briefs_status on public.lead_briefs (status, updated_at desc);
create index if not exists idx_lead_brief_revisions_brief on public.lead_brief_revisions (lead_brief_id, created_at desc);

drop trigger if exists trg_lead_briefs_updated_at on public.lead_briefs;
create trigger trg_lead_briefs_updated_at
before update on public.lead_briefs
for each row execute function public.set_updated_at();

alter table public.lead_briefs enable row level security;
alter table public.lead_brief_revisions enable row level security;

create policy "admin_rw_lead_briefs" on public.lead_briefs
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

create policy "member_read_lead_briefs" on public.lead_briefs
for select using (
  public.current_admin_role() is not null
  or exists (
    select 1
    from public.customers c
    where c.id = lead_briefs.customer_id
      and c.account_id is not null
      and public.is_account_member(c.account_id)
  )
);

create policy "admin_rw_lead_brief_revisions" on public.lead_brief_revisions
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);
