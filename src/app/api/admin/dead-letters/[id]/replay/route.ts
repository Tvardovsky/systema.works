import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {getDeadLetterById, updateDeadLetter} from '@/lib/repositories/omnichannel';
import {handleInboundEvent} from '@/lib/orchestrator';
import {dispatchOutboundAction} from '@/lib/integrations/outbound';
import type {InboundEvent} from '@/types/omnichannel';

type Params = {
  params: Promise<{id: string}>;
};

function toInboundEvent(input: Record<string, unknown>): InboundEvent | null {
  const channel = input.channel;
  const channelUserId = input.channelUserId;
  const platformMessageId = input.platformMessageId;
  const text = input.text;
  if (
    (channel !== 'web' && channel !== 'telegram' && channel !== 'instagram' && channel !== 'facebook' && channel !== 'whatsapp') ||
    typeof channelUserId !== 'string' ||
    typeof platformMessageId !== 'string' ||
    typeof text !== 'string'
  ) {
    return null;
  }

  return {
    channel,
    channelUserId,
    platformMessageId,
    text,
    locale: (input.locale === 'en' || input.locale === 'sr-ME' || input.locale === 'ru' || input.locale === 'uk') ? input.locale : undefined,
    profileName: typeof input.profileName === 'string' ? input.profileName : undefined,
    username: typeof input.username === 'string' ? input.username : undefined,
    phone: typeof input.phone === 'string' ? input.phone : undefined,
    email: typeof input.email === 'string' ? input.email : undefined,
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? (input.metadata as Record<string, unknown>) : undefined
  };
}

export async function POST(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const {id} = await context.params;
  const deadLetter = await getDeadLetterById(id);
  if (!deadLetter) {
    return NextResponse.json({error: 'Not found'}, {status: 404});
  }

  const parsed = toInboundEvent(deadLetter.payload);
  if (!parsed) {
    await updateDeadLetter({
      id,
      attempts: deadLetter.attempts + 1,
      resolved: false,
      errorMessage: 'Replay failed: payload is not a valid InboundEvent'
    });
    return NextResponse.json({error: 'Dead letter payload is incompatible for replay'}, {status: 400});
  }

  try {
    const outbound = await handleInboundEvent(parsed);
    await dispatchOutboundAction(outbound);

    await updateDeadLetter({
      id,
      attempts: deadLetter.attempts + 1,
      resolved: true
    });
    return NextResponse.json({ok: true, replayed: true});
  } catch (error) {
    await updateDeadLetter({
      id,
      attempts: deadLetter.attempts + 1,
      resolved: false,
      errorMessage: error instanceof Error ? error.message : 'Replay failed'
    });
    return NextResponse.json({ok: false, error: error instanceof Error ? error.message : 'Replay failed'}, {status: 500});
  }
}

