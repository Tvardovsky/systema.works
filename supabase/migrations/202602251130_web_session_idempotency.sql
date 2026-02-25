with technical_duplicates as (
  select
    c.id,
    row_number() over (
      partition by c.customer_id, date_trunc('minute', c.created_at)
      order by c.created_at desc, c.id desc
    ) as rn
  from public.conversations c
  where c.channel = 'web'
    and c.status in ('open', 'qualified', 'hot', 'handoff')
    and c.last_inbound_message_at is null
    and coalesce(c.lead_intent_score, 0) = 0
    and not exists (
      select 1
      from public.messages m
      where m.conversation_id = c.id
    )
)
update public.conversations c
set
  status = 'closed',
  metadata = jsonb_set(
    coalesce(c.metadata, '{}'::jsonb),
    '{auto_dedupe_legacy_web_session}',
    jsonb_build_object(
      'applied_at', now(),
      'reason', 'safe_web_session_duplicate',
      'migration', '202602251130_web_session_idempotency'
    ),
    true
  )
from technical_duplicates d
where c.id = d.id
  and d.rn > 1;

create unique index if not exists idx_conversations_web_active_browser_key_unique
  on public.conversations (channel, channel_user_id)
  where channel = 'web'
    and status <> 'closed'
    and channel_user_id is not null;
