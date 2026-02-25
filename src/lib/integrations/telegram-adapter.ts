import type {InboundEvent} from '@/types/omnichannel';

type TelegramWebhookPayload = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    from?: {id?: number; username?: string; first_name?: string; last_name?: string};
    chat?: {id?: number | string};
  };
};

export function parseTelegramInbound(payload: TelegramWebhookPayload): InboundEvent | null {
  const message = payload.message;
  if (!message?.text || !message.from?.id || !message.message_id) {
    return null;
  }

  const first = message.from.first_name ?? '';
  const last = message.from.last_name ?? '';
  const profileName = `${first} ${last}`.trim() || undefined;

  return {
    channel: 'telegram',
    channelUserId: String(message.from.id),
    platformMessageId: String(message.message_id),
    text: message.text,
    username: message.from.username ?? undefined,
    profileName,
    metadata: {
      updateId: payload.update_id ?? null,
      chatId: message.chat?.id ? String(message.chat.id) : String(message.from.id)
    }
  };
}

