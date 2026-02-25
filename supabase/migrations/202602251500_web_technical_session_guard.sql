-- Pre-check: find active technical duplicates by browser key.
-- select
--   c.channel_user_id,
--   count(*) as duplicate_count
-- from public.conversations c
-- where c.channel = 'web'
--   and c.status in ('open', 'qualified', 'hot', 'handoff')
--   and c.channel_user_id is not null
--   and c.last_inbound_message_at is null
--   and coalesce(c.lead_intent_score, 0) = 0
--   and not exists (
--     select 1
--     from public.lead_events le
--     where le.conversation_id = c.id
--   )
--   and not exists (
--     select 1
--     from public.lead_briefs lb
--     where lb.conversation_id = c.id
--   )
--   and not exists (
--     select 1
--     from public.messages m
--     where m.conversation_id = c.id
--       and m.role = 'user'
--   )
-- group by c.channel_user_id
-- having count(*) > 1
-- order by duplicate_count desc, c.channel_user_id asc;

with technical_duplicates as (
  select
    c.id,
    c.channel_user_id,
    row_number() over (
      partition by c.channel, c.channel_user_id
      order by c.updated_at desc, c.created_at desc, c.id desc
    ) as rn
  from public.conversations c
  where c.channel = 'web'
    and c.status in ('open', 'qualified', 'hot', 'handoff')
    and c.channel_user_id is not null
    and c.last_inbound_message_at is null
    and coalesce(c.lead_intent_score, 0) = 0
    and not exists (
      select 1
      from public.lead_events le
      where le.conversation_id = c.id
    )
    and not exists (
      select 1
      from public.lead_briefs lb
      where lb.conversation_id = c.id
    )
    and not exists (
      select 1
      from public.messages m
      where m.conversation_id = c.id
        and m.role = 'user'
    )
)
update public.conversations c
set
  status = 'closed',
  metadata = jsonb_set(
    coalesce(c.metadata, '{}'::jsonb),
    '{auto_dedupe_technical_web_session}',
    jsonb_build_object(
      'applied_at', now(),
      'reason', 'technical_web_session_duplicate_by_browser_key',
      'migration', '202602251500_web_technical_session_guard'
    ),
    true
  )
from technical_duplicates d
where c.id = d.id
  and d.rn > 1;

create unique index if not exists idx_conversations_web_technical_active_browser_key_unique
  on public.conversations (channel, channel_user_id)
  where channel = 'web'
    and status <> 'closed'
    and channel_user_id is not null
    and last_inbound_message_at is null
    and coalesce(lead_intent_score, 0) = 0;

-- Post-check: expect zero rows after migration.
-- select
--   c.channel_user_id,
--   count(*) as duplicate_count
-- from public.conversations c
-- where c.channel = 'web'
--   and c.status in ('open', 'qualified', 'hot', 'handoff')
--   and c.channel_user_id is not null
--   and c.last_inbound_message_at is null
--   and coalesce(c.lead_intent_score, 0) = 0
--   and not exists (
--     select 1
--     from public.lead_events le
--     where le.conversation_id = c.id
--   )
--   and not exists (
--     select 1
--     from public.lead_briefs lb
--     where lb.conversation_id = c.id
--   )
--   and not exists (
--     select 1
--     from public.messages m
--     where m.conversation_id = c.id
--       and m.role = 'user'
--   )
-- group by c.channel_user_id
-- having count(*) > 1;
