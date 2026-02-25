alter table public.lead_briefs
  add column if not exists referral_source text;

comment on column public.lead_briefs.referral_source is
  'How customer heard about us (raw text)';
