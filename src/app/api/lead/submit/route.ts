import {NextRequest, NextResponse} from 'next/server';
import {leadSubmitSchema} from '@/lib/schemas';
import {getSession} from '@/lib/store';
import {resolveLeadPriority} from '@/lib/lead';
import {appendLeadToSheet} from '@/lib/sheets';
import {sendLeadToTelegram} from '@/lib/telegram';
import {appendLeadLog} from '@/lib/logs';
import {enforceRateLimit, getClientIp} from '@/lib/security';

export async function POST(request: NextRequest) {
  const payload = leadSubmitSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  if (payload.data.honeypot) {
    return NextResponse.json({error: 'Blocked'}, {status: 400});
  }

  if (!payload.data.consent) {
    return NextResponse.json({error: 'Consent required'}, {status: 400});
  }

  const session = getSession(payload.data.sessionId);
  if (!session) {
    return NextResponse.json({error: 'Session not found'}, {status: 404});
  }

  const ip = getClientIp(request);
  if (!enforceRateLimit(`lead:submit:${ip}`, 8, 60_000)) {
    return NextResponse.json({error: 'Too many requests'}, {status: 429});
  }

  const transcriptText = session.history.map((item) => item.content).join(' ').toLowerCase();
  const intentScore = Math.min(95, Math.max(20, transcriptText.length / 20));
  const priority = resolveLeadPriority(intentScore);

  const lead = {
    locale: payload.data.locale,
    name: payload.data.name,
    company: payload.data.company,
    serviceInterest: payload.data.serviceInterest,
    budgetBand: payload.data.budgetBand,
    timeline: payload.data.timeline,
    contactChannel: payload.data.contactChannel,
    contactValue: payload.data.contactValue,
    consent: payload.data.consent,
    chatTranscriptId: payload.data.sessionId,
    priority,
    intentScore
  };

  await appendLeadLog({
    ts: new Date().toISOString(),
    kind: 'lead',
    sessionId: payload.data.sessionId,
    name: payload.data.name,
    contact: `${payload.data.contactChannel}: ${payload.data.contactValue}`,
    priority,
    payload: {
      ...payload.data,
      transcript: session.history
    }
  });

  await Promise.allSettled([
    appendLeadToSheet(lead),
    sendLeadToTelegram(lead)
  ]);

  return NextResponse.json({ok: true, leadId: payload.data.sessionId, priority});
}
