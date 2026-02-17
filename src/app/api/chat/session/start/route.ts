import {NextRequest, NextResponse} from 'next/server';
import {startSessionSchema} from '@/lib/schemas';
import {createSession} from '@/lib/store';
import {enforceRateLimit, getClientIp, verifyTurnstile} from '@/lib/security';

export async function POST(request: NextRequest) {
  const payload = startSessionSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  if (payload.data.honeypot) {
    return NextResponse.json({error: 'Blocked'}, {status: 400});
  }

  const ip = getClientIp(request);
  const rateKey = `chat:start:${ip}`;
  if (!enforceRateLimit(rateKey, 15, 60_000)) {
    return NextResponse.json({error: 'Too many requests'}, {status: 429});
  }

  const human = await verifyTurnstile(payload.data.turnstileToken, ip);
  if (!human) {
    return NextResponse.json({error: 'Verification failed'}, {status: 403});
  }

  const session = createSession(payload.data.locale, payload.data.pagePath);
  return NextResponse.json({sessionId: session.id, allowed: true});
}
