import {NextRequest, NextResponse} from 'next/server';
import {parseTelegramInbound} from '@/lib/integrations/telegram-adapter';
import {handleInboundEvent} from '@/lib/orchestrator';
import {dispatchOutboundAction} from '@/lib/integrations/outbound';

function verifyTelegramSecret(request: NextRequest): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    return true;
  }
  const provided = request.headers.get('x-telegram-bot-api-secret-token');
  return provided === expected;
}

export async function POST(request: NextRequest) {
  if (!verifyTelegramSecret(request)) {
    return NextResponse.json({error: 'Invalid telegram secret'}, {status: 401});
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  const inbound = parseTelegramInbound(payload as never);
  if (!inbound) {
    return NextResponse.json({ok: true, skipped: true});
  }

  const result = await handleInboundEvent(inbound);
  await dispatchOutboundAction(result);

  return NextResponse.json({ok: true});
}
