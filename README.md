# SYSTEMA Omnichannel AI Sales

Next.js app with Supabase-backed omnichannel AI sales flow for:
- Web chat
- Telegram webhook
- Instagram/Facebook webhook (Meta)

WhatsApp is intentionally deferred in this phase.

## Stack

- Next.js App Router
- Supabase (Postgres + RLS + Realtime + Auth)
- OpenAI for reply generation
- Telegram bot notifications

## Environment Variables

Required:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

OPENAI_API_KEY=
OPENAI_FAST_MODEL=gpt-5-mini
OPENAI_QUALITY_MODEL=gpt-5.2
OPENAI_PROJECT_ID=
OPENAI_ORG_ID=
OPENAI_MAX_OUTPUT_TOKENS=220
OPENAI_HISTORY_WINDOW=6

NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
CHAT_IP_HASH_SALT=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=

META_VERIFY_TOKEN=
META_PAGE_ACCESS_TOKEN=
META_APP_SECRET=

RETENTION_DAYS=180
```

Optional legacy fallback:

```bash
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

## Build & Lint

```bash
bun run lint
bun run build
```

## Database Migration

Apply all SQL migrations from `supabase/migrations` in chronological order:

- `202602201700_omnichannel.sql`
- `202602242015_lead_briefs.sql`
- `202602242130_identity_security.sql`
- `202602242355_admin_read_receipts.sql`
- `202602251130_web_session_idempotency.sql`
- `202602251500_web_technical_session_guard.sql`

They create:
- Core omnichannel tables (`customers`, `customer_identities`, `conversations`, `messages`, `memory_snapshots`, `lead_events`)
- Admin and reliability tables (`admin_users`, `webhook_idempotency`, `dead_letter_events`)
- Future client-portal foundation (`accounts`, `account_members`, `projects`, `project_milestones`, `invoices`, `payments`, `communications`)
- Triggers, indexes, and RLS policies.

### Web technical duplicate runbook

Pre-check technical duplicate sessions (active web technical rows grouped by `channel_user_id`):

```sql
select
  c.channel_user_id,
  count(*) as duplicate_count
from public.conversations c
where c.channel = 'web'
  and c.status in ('open', 'qualified', 'hot', 'handoff')
  and c.channel_user_id is not null
  and c.last_inbound_message_at is null
  and coalesce(c.lead_intent_score, 0) = 0
  and not exists (select 1 from public.lead_events le where le.conversation_id = c.id)
  and not exists (select 1 from public.lead_briefs lb where lb.conversation_id = c.id)
  and not exists (select 1 from public.messages m where m.conversation_id = c.id and m.role = 'user')
group by c.channel_user_id
having count(*) > 1
order by duplicate_count desc, c.channel_user_id asc;
```

Apply migrations, then run the same query again. Expected result: no rows.

## API Endpoints

Implemented now:

- `POST /api/chat/session/start`
- `POST /api/chat/message`
- `POST /api/lead/submit`
- `POST /api/integrations/telegram/webhook`
- `GET /api/integrations/meta/webhook`
- `POST /api/integrations/meta/webhook`
- `GET /api/admin/conversations`
- `GET /api/admin/conversations/:id/messages`
- `POST /api/admin/conversations/:id/handoff`
- `GET /api/admin/customers/:id/context`
- `GET /api/admin/leads`
- `GET /api/admin/projects`
- `GET /api/admin/accounts/:id/summary`

Legacy compatibility:

- `GET /api/admin/sessions` (conversation list alias)

Deferred:

- WhatsApp webhook API
- Client dashboard APIs/UI
