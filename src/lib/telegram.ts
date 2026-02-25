import {Telegraf} from 'telegraf';

function getTelegramBot(): Telegraf | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return null;
  }
  return new Telegraf(token);
}

export async function sendTelegramTextMessage(chatId: string, text: string) {
  const bot = getTelegramBot();
  if (!bot) {
    return {ok: false, skipped: true};
  }

  await bot.telegram.sendMessage(chatId, text);
  return {ok: true};
}

export async function sendManagerAlert(text: string) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    return {ok: false, skipped: true};
  }
  return sendTelegramTextMessage(chatId, text);
}
