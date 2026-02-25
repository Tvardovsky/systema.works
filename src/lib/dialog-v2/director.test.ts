import {describe, expect, it} from 'bun:test';
import {runDialogV3Director} from './director';

describe('dialog-v2/director', () => {
  it('returns primary path when first attempt succeeds', async () => {
    const result = await runDialogV3Director({
      locale: 'en',
      topic: 'allowed',
      message: 'Need a landing page for lead generation.',
      recentHistory: [],
      deterministicNextSlot: 'primaryGoal',
      deterministicNextQuestion: 'What business outcome is primary?',
      missingBlocking: ['primary_goal', 'timeline_or_budget', 'contact'],
      forcedTurnMode: null,
      requestFn: async ({attempt}) => {
        if (attempt === 'primary') {
          return {
            answer: 'Got it. A landing page is clear.',
            turnMode: 'progress',
            nextSlot: 'primaryGoal',
            nextQuestion: 'What business result matters most?'
          };
        }
        return null;
      }
    });

    expect(result.fallbackPath).toBe('primary');
    expect(result.llmCallsCount).toBe(1);
    expect(result.sameModelFallbackSkipped).toBe(false);
    expect(result.draft?.turnMode).toBe('progress');
  });

  it('returns retry path when primary fails but retry succeeds', async () => {
    const result = await runDialogV3Director({
      locale: 'ru',
      topic: 'allowed',
      message: 'Нужен сайт',
      recentHistory: [],
      deterministicNextSlot: 'primaryGoal',
      deterministicNextQuestion: 'Какой бизнес-результат главный?',
      missingBlocking: ['primary_goal', 'timeline_or_budget', 'contact'],
      forcedTurnMode: null,
      primaryModel: 'gpt-5-mini',
      retryModel: 'gpt-5-nano',
      requestFn: async ({attempt}) => {
        if (attempt === 'retry') {
          return {
            answer: 'Принял задачу.',
            turnMode: 'progress',
            nextSlot: 'primaryGoal',
            nextQuestion: 'Какой бизнес-результат для вас главный?'
          };
        }
        return null;
      }
    });

    expect(result.fallbackPath).toBe('retry');
    expect(result.llmCallsCount).toBe(2);
    expect(result.sameModelFallbackSkipped).toBe(false);
    expect(result.draft?.nextSlot).toBe('primaryGoal');
  });

  it('skips retry when primary and fallback models are identical', async () => {
    const result = await runDialogV3Director({
      locale: 'en',
      topic: 'allowed',
      message: 'Need automation',
      recentHistory: [],
      deterministicNextSlot: 'primaryGoal',
      deterministicNextQuestion: 'What business result is most important?',
      missingBlocking: ['primary_goal', 'timeline_or_budget', 'contact'],
      forcedTurnMode: null,
      requestFn: async () => null
    });

    expect(result.fallbackPath).toBe('deterministic');
    expect(result.draft).toBeNull();
    expect(result.llmCallsCount).toBe(1);
    expect(result.sameModelFallbackSkipped).toBe(true);
  });

  it('does not throw on non-recoverable director errors and falls back to deterministic', async () => {
    const result = await runDialogV3Director({
      locale: 'en',
      topic: 'allowed',
      message: 'Need automation',
      recentHistory: [],
      deterministicNextSlot: 'primaryGoal',
      deterministicNextQuestion: 'What business result is most important?',
      missingBlocking: ['primary_goal', 'timeline_or_budget', 'contact'],
      forcedTurnMode: null,
      requestFn: async () => {
        throw new Error('schema mismatch');
      }
    });

    expect(result.fallbackPath).toBe('deterministic');
    expect(result.draft).toBeNull();
  });
});
