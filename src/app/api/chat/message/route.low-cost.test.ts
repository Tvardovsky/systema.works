import {beforeAll, describe, expect, it} from 'bun:test';
import {buildLowCostAssistantAnswer} from './route';
import {getLockedMessage} from '@/lib/web-chat-lifecycle';
import type {ChatMessage} from '@/types/lead';

beforeAll(() => {
  process.env.OPENAI_API_KEY = '';
});

describe('buildLowCostAssistantAnswer', () => {
  it('returns non-template low-cost reply instead of legacy fixed ack', async () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: 'Передал менеджеру, можно уточнить детали.'}
    ];
    const result = await buildLowCostAssistantAnswer({
      locale: 'ru',
      message: 'Добавьте что нужен Telegram-бот и CRM интеграция',
      history,
      remainingLowCostMessages: 1,
      chatLocked: false,
      retryAfterSeconds: 0,
      conversationId: 'conv-test-low-cost'
    });

    expect(result.answer).not.toContain('Спасибо за уточнение, я добавил это в заявку.');
    expect(result.answer.toLowerCase()).toContain('менедж');
    expect(result.templateBlockTriggered).toBe(false);
    expect(result.repetitionScore).toBeNull();
    expect(result.llmReplyDeferred).toBe(true);
    expect(result.deferReason).toBe('connection');
  });

  it('keeps locked system message when chat is locked', async () => {
    const retryAfterSeconds = 1800;
    const result = await buildLowCostAssistantAnswer({
      locale: 'ru',
      message: 'Ещё одно уточнение',
      history: [],
      remainingLowCostMessages: 0,
      chatLocked: true,
      retryAfterSeconds,
      conversationId: 'conv-test-locked'
    });

    expect(result.answer).toContain(getLockedMessage('ru', retryAfterSeconds));
    expect(result.llmReplyDeferred).toBe(true);
    expect(result.deferReason).toBe('connection');
  });
});
