alter table public.lead_briefs
  add column if not exists brief_structured jsonb not null default '{}'::jsonb,
  add column if not exists brief_structured_version text not null default 'v2';

comment on column public.lead_briefs.brief_structured is
  'Structured slot states: value/confidence/evidence/source for dialog-v2';

comment on column public.lead_briefs.brief_structured_version is
  'Structured brief engine version identifier.';
