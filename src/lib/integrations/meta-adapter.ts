import type {InboundEvent} from '@/types/omnichannel';

type MetaMessagingEvent = {
  sender?: {id?: string};
  message?: {mid?: string; text?: string};
  recipient?: {id?: string};
  timestamp?: number;
};

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: MetaMessagingEvent[];
  }>;
};

export function parseMetaInbound(payload: MetaWebhookPayload): InboundEvent[] {
  const events: InboundEvent[] = [];
  const entries = payload.entry ?? [];

  for (const entry of entries) {
    for (const msg of entry.messaging ?? []) {
      const senderId = msg.sender?.id;
      const mid = msg.message?.mid;
      const text = msg.message?.text;
      if (!senderId || !mid || !text) {
        continue;
      }

      const channel = payload.object === 'instagram' ? 'instagram' : 'facebook';
      events.push({
        channel,
        channelUserId: senderId,
        platformMessageId: mid,
        text,
        metadata: {
          recipientId: msg.recipient?.id ?? null,
          entryId: entry.id ?? null,
          timestamp: msg.timestamp ?? null
        }
      });
    }
  }

  return events;
}

export async function sendMetaTextMessage(recipientId: string, text: string): Promise<void> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) {
    return;
  }

  const response = await fetch('https://graph.facebook.com/v22.0/me/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      recipient: {id: recipientId},
      messaging_type: 'RESPONSE',
      message: {text}
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Meta send error: ${response.status} ${body}`);
  }
}

