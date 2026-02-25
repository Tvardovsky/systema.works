import {beforeAll, describe, expect, it} from 'bun:test';
import type {ChatMessage} from '@/types/lead';

let extractBriefSignals: typeof import('./brief-extractor').extractBriefSignals;

beforeAll(async () => {
  process.env.OPENAI_API_KEY = '';
  ({extractBriefSignals} = await import('./brief-extractor'));
});

describe('extractBriefSignals', () => {
  it('does not map area metrics into budget and asks budget clarification', async () => {
    const history: ChatMessage[] = [
      {role: 'user', content: 'Нужен лендинг по проекту домов'}
    ];

    const result = await extractBriefSignals({
      locale: 'ru',
      message: 'Участок чуть менее 3000 м², дома 120-200 м². Давайте обсудим проект.',
      history
    });

    expect(result.fields.budgetHint).toBeNull();
    expect(result.shouldAskClarification).toBe(true);
    expect(result.clarificationType).toBe('budget');
    expect(result.ambiguities).toContain('budget_vs_area');
  });

  it('extracts explicit budget even when area is present', async () => {
    const result = await extractBriefSignals({
      locale: 'ru',
      message: 'Участок 3000 м², бюджет проекта 50 000 EUR, нужен лендинг.',
      history: []
    });

    expect(result.fields.budgetHint).not.toBeNull();
    expect(result.fields.budgetHint?.toLowerCase()).toContain('50000');
  });
});
