import {NextRequest, NextResponse} from 'next/server';
import {chatMessageSchema} from '@/lib/schemas';
import {appendSessionMessage, getSession} from '@/lib/store';
import {enforceRateLimit, getClientIp, verifyTurnstile} from '@/lib/security';
import {generateAgencyReply} from '@/lib/ai';

export async function POST(request: NextRequest) {
  const payload = chatMessageSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  if (payload.data.honeypot) {
    return NextResponse.json({error: 'Blocked'}, {status: 400});
  }

  const session = getSession(payload.data.sessionId);
  if (!session) {
    return NextResponse.json({error: 'Session not found'}, {status: 404});
  }

  const ip = getClientIp(request);
  const rateKey = `chat:message:${ip}`;
  if (!enforceRateLimit(rateKey, 45, 60_000)) {
    return NextResponse.json({error: 'Too many requests'}, {status: 429});
  }

  if (payload.data.turnstileToken) {
    const human = await verifyTurnstile(payload.data.turnstileToken, ip);
    if (!human) {
      return NextResponse.json({error: 'Verification failed'}, {status: 403});
    }
  }

  appendSessionMessage(session.id, 'user', payload.data.message);
  const reply = await generateAgencyReply({
    locale: payload.data.locale,
    message: payload.data.message,
    history: session.history
  });
  appendSessionMessage(session.id, 'assistant', reply.answer);

  return NextResponse.json(reply);
}
