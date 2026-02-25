import {describe, expect, it} from 'bun:test';
import {validateDialogV3Draft} from './validator';

describe('dialog-v2/validator', () => {
  it('keeps answer_only for forced in-scope counter-question turns', () => {
    const result = validateDialogV3Draft({
      locale: 'ru',
      topic: 'allowed',
      history: [],
      draft: {
        answer: 'Отвечаю по интеграциям.',
        turnMode: 'progress',
        nextSlot: 'primaryGoal',
        nextQuestion: 'Какой бизнес-результат главный?'
      },
      deterministicNextSlot: 'primaryGoal',
      deterministicNextQuestion: 'Какой бизнес-результат главный?',
      handoffReady: false,
      forcedTurnMode: 'answer_only'
    });

    expect(result.turnMode).toBe('answer_only');
    expect(result.nextQuestion).toBe('');
  });

  it('blocks illegal handoff when core slots are missing', () => {
    const result = validateDialogV3Draft({
      locale: 'en',
      topic: 'allowed',
      history: [],
      draft: {
        answer: 'Great, handing off now.',
        turnMode: 'progress',
        nextSlot: 'handoff',
        nextQuestion: 'Done?'
      },
      deterministicNextSlot: 'timeline',
      deterministicNextQuestion: 'What timeline is critical for launch?',
      handoffReady: false,
      forcedTurnMode: null
    });

    expect(result.nextSlot).toBe('timeline');
    expect(result.nextQuestion.toLowerCase()).toContain('timeline');
  });

  it('trims to maximum two questions per turn', () => {
    const result = validateDialogV3Draft({
      locale: 'en',
      topic: 'allowed',
      history: [],
      draft: {
        answer: 'Do you need CRM? Should we include analytics? Should we include support?',
        turnMode: 'progress',
        nextSlot: 'timeline',
        nextQuestion: 'What timeline is critical?'
      },
      deterministicNextSlot: 'timeline',
      deterministicNextQuestion: 'What timeline is critical?',
      handoffReady: false,
      forcedTurnMode: null
    });

    expect(result.questionsCount).toBeLessThanOrEqual(2);
  });

  it('switches to answer_only when next question repeats previous assistant question', () => {
    const result = validateDialogV3Draft({
      locale: 'ru',
      topic: 'allowed',
      history: [
        {role: 'assistant', content: 'Какой бизнес-результат для вас главный в этом проекте?'}
      ],
      draft: {
        answer: 'Понял.',
        turnMode: 'progress',
        nextSlot: 'primaryGoal',
        nextQuestion: 'Какой бизнес-результат для вас главный в этом проекте?'
      },
      deterministicNextSlot: 'primaryGoal',
      deterministicNextQuestion: 'Какой бизнес-результат для вас главный в этом проекте?',
      handoffReady: false,
      forcedTurnMode: null
    });

    expect(result.turnMode).toBe('answer_only');
    expect(result.nextQuestion).toBe('');
  });
});
