import {Telegraf} from 'telegraf';
import type {LeadPayload, LeadPriority} from '@/types/lead';

export async function sendLeadToTelegram(lead: LeadPayload & {priority: LeadPriority; intentScore: number}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {ok: false, skipped: true};
  }

  const bot = new Telegraf(token);
  const text = [
    '<b>New SYSTEMA Lead</b>',
    `Priority: <b>${lead.priority.toUpperCase()}</b>`,
    `Score: ${lead.intentScore}`,
    `Locale: ${lead.locale}`,
    `Name: ${lead.name}`,
    `Company: ${lead.company || '-'}`,
    `Service: ${lead.serviceInterest}`,
    `Budget: ${lead.budgetBand}`,
    `Timeline: ${lead.timeline}`,
    `Contact: ${lead.contactChannel} - ${lead.contactValue}`,
    `Session: ${lead.chatTranscriptId}`
  ].join('\n');

  await bot.telegram.sendMessage(chatId, text, {parse_mode: 'HTML'});
  return {ok: true};
}
