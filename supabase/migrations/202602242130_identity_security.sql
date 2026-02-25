alter table public.customer_identities
  add column if not exists verification_level text not null default 'unverified' check (verification_level in ('unverified', 'verified_channel', 'verified_phone', 'verified_strong')),
  add column if not exists verification_source text,
  add column if not exists verified_at timestamptz,
  add column if not exists is_primary boolean not null default false;

alter table public.conversations
  add column if not exists identity_state text not null default 'unverified' check (identity_state in ('unverified', 'pending_match', 'verified')),
  add column if not exists memory_access text not null default 'session_only' check (memory_access in ('none', 'session_only', 'full_customer')),
  add column if not exists pending_customer_id uuid references public.customers(id) on delete set null;

create table if not exists public.identity_claims (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  claim_type text not null check (claim_type in ('phone', 'email', 'telegram_handle')),
  claim_value text not null,
  normalized_value text not null,
  claim_status text not null default 'captured' check (claim_status in ('captured', 'candidate_match', 'verified', 'rejected')),
  matched_customer_id uuid references public.customers(id) on delete set null,
  source_channel text not null check (source_channel in ('web', 'telegram', 'whatsapp', 'instagram', 'facebook')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, claim_type, normalized_value)
);

create table if not exists public.customer_merge_audit (
  id uuid primary key default gen_random_uuid(),
  from_customer_id uuid not null references public.customers(id) on delete cascade,
  to_customer_id uuid not null references public.customers(id) on delete cascade,
  reason text not null,
  trigger_channel text not null check (trigger_channel in ('web', 'telegram', 'whatsapp', 'instagram', 'facebook')),
  trigger_conversation_id uuid references public.conversations(id) on delete set null,
  performed_by text not null default 'system' check (performed_by in ('system', 'manager')),
  created_at timestamptz not null default now()
);

create index if not exists idx_conversations_identity_state on public.conversations (identity_state, memory_access, updated_at desc);
create index if not exists idx_conversations_pending_customer on public.conversations (pending_customer_id) where pending_customer_id is not null;
create index if not exists idx_identity_claims_customer on public.identity_claims (customer_id, updated_at desc);
create index if not exists idx_identity_claims_normalized on public.identity_claims (claim_type, normalized_value, claim_status);
create index if not exists idx_merge_audit_to_customer on public.customer_merge_audit (to_customer_id, created_at desc);
create index if not exists idx_merge_audit_from_customer on public.customer_merge_audit (from_customer_id, created_at desc);

drop trigger if exists trg_identity_claims_updated_at on public.identity_claims;
create trigger trg_identity_claims_updated_at
before update on public.identity_claims
for each row execute function public.set_updated_at();

alter table public.identity_claims enable row level security;
alter table public.customer_merge_audit enable row level security;

drop policy if exists "admin_rw_identity_claims" on public.identity_claims;
create policy "admin_rw_identity_claims" on public.identity_claims
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);

drop policy if exists "admin_rw_customer_merge_audit" on public.customer_merge_audit;
create policy "admin_rw_customer_merge_audit" on public.customer_merge_audit
for all using (public.current_admin_role() is not null)
with check (public.current_admin_role() is not null);
