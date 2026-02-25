import {NextRequest, NextResponse} from 'next/server';
import {parseMetaInbound} from '@/lib/integrations/meta-adapter';
import {dispatchOutboundAction} from '@/lib/integrations/outbound';
import {handleInboundEvent} from '@/lib/orchestrator';
import {verifyHmacSha256} from '@/lib/security/signature';
import {appendDeadLetter} from '@/lib/repositories/omnichannel';

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  const expected = process.env.META_VERIFY_TOKEN;

  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, {status: 200});
  }

  return new NextResponse('Forbidden', {status: 403});
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  const appSecret = process.env.META_APP_SECRET;
  if (appSecret) {
    const signature = request.headers.get('x-hub-signature-256');
    const valid = verifyHmacSha256(rawBody, appSecret, signature);
    if (!valid) {
      return NextResponse.json({error: 'Invalid signature'}, {status: 401});
    }
  }

  const events = parseMetaInbound(payload as never);
  if (!events.length) {
    return NextResponse.json({ok: true, skipped: true});
  }

  for (const event of events) {
    try {
      const result = await handleInboundEvent(event);
      await dispatchOutboundAction(result);
    } catch (error) {
      await appendDeadLetter({
        channel: event.channel,
        platformMessageId: event.platformMessageId,
        payload: event as unknown as Record<string, unknown>,
        errorMessage: error instanceof Error ? error.message : 'Meta webhook processing error'
      });
    }
  }

  return NextResponse.json({ok: true});
}
