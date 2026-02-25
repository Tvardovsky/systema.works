import {sendTelegramTextMessage} from '@/lib/telegram';
import {sendMetaTextMessage} from '@/lib/integrations/meta-adapter';
import type {OutboundAction} from '@/types/omnichannel';

export async function dispatchOutboundAction(action: OutboundAction): Promise<void> {
  if (!action.text) {
    return;
  }

  if (action.channel === 'telegram') {
    await sendTelegramTextMessage(action.recipientId, action.text);
    return;
  }

  if (action.channel === 'instagram' || action.channel === 'facebook') {
    await sendMetaTextMessage(action.recipientId, action.text);
    return;
  }

  // Web channel response is returned directly by API route, no push transport needed.
}

