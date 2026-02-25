import {describe, expect, it} from 'bun:test';
import {runDialogV2Turn} from './engine';

describe('dialog-v2/engine', () => {
  it('does not re-ask timeline after no-deadline answer when user asks to discuss structure', async () => {
    const history: Array<{role: 'user' | 'assistant'; content: string}> = [
      {role: 'assistant', content: 'Здравствуйте! Опишите задачу — я задам пару уточняющих вопросов и соберу бриф для команды.'},
      {role: 'user', content: 'Привет, мне нужен лендинг для продажи земли и квартир в элитном жилом комплексе'},
      {role: 'assistant', content: 'Цель проекта зафиксировал. Какие сроки запуска для вас критичны?'},
      {role: 'user', content: 'Сроков пока нет'},
      {role: 'assistant', content: 'Сроки зафиксировал. Чтобы не потерять контекст, напишите ваше имя и любой контакт: email, телефон или Telegram.'}
    ];

    const result = await runDialogV2Turn({
      locale: 'ru',
      channel: 'web',
      message: 'А давай поговорим о структуре лендинга',
      runtimeMode: 'v2_deterministic',
      history,
      identityState: 'unverified',
      briefContext: {
        serviceType: 'landing_website',
        primaryGoal: 'Продажа земли и квартир',
        firstDeliverable: 'Лендинг',
        timelineHint: 'no_deadline',
        missingFields: ['contact'],
        completenessScore: 75,
        hasConversationContact: false,
        briefStructuredVersion: 'v2'
      }
    });

    expect(result.response.nextQuestion.toLowerCase()).not.toContain('срок');
    expect(result.response.missingFields).not.toContain('timeline_or_budget');
    expect(result.response.missingFields).toContain('contact');
    expect(result.response.llmCallsCount).toBe(0);
  });

  it('does not repeat primary-goal question after concise goal answer', async () => {
    const history: Array<{role: 'user' | 'assistant'; content: string}> = [
      {role: 'assistant', content: 'Здравствуйте! Опишите задачу — я задам пару уточняющих вопросов и соберу бриф для команды.'},
      {role: 'user', content: 'Нужен лендинг для продажи объектов недвижимости'},
      {role: 'assistant', content: 'Тип услуги зафиксировал. Какой бизнес-результат для вас главный в этом проекте?'}
    ];

    const result = await runDialogV2Turn({
      locale: 'ru',
      channel: 'web',
      message: 'Построить и продать!',
      runtimeMode: 'v2_deterministic',
      history,
      identityState: 'unverified',
      briefContext: {
        serviceType: 'landing_website',
        primaryGoal: null,
        timelineHint: null,
        budgetHint: null,
        missingFields: ['primary_goal', 'timeline_or_budget', 'contact'],
        completenessScore: 25,
        hasConversationContact: false,
        briefStructuredVersion: 'v2'
      }
    });

    expect(result.extractedFields.primaryGoal).toContain('Построить и продать');
    expect(result.structuredBrief.slots.primaryGoal.state).toBe('confirmed');
    expect(result.structuredBrief.nextSlot).not.toBe('primaryGoal');
    expect(result.response.nextQuestion.toLowerCase()).not.toContain('бизнес-результат');
  });

  it('uses answer_only turn mode for in-scope counter-question in v3', async () => {
    const history: Array<{role: 'user' | 'assistant'; content: string}> = [
      {role: 'assistant', content: 'Тип услуги зафиксировал. Какой бизнес-результат для вас главный в этом проекте?'}
    ];

    const result = await runDialogV2Turn({
      locale: 'ru',
      channel: 'web',
      message: 'А сколько обычно длится интеграция с CRM?',
      runtimeMode: 'v3_llm_first',
      history,
      identityState: 'unverified',
      briefContext: {
        serviceType: 'automation',
        primaryGoal: null,
        timelineHint: null,
        budgetHint: null,
        missingFields: ['primary_goal', 'timeline_or_budget', 'contact'],
        completenessScore: 25,
        hasConversationContact: false,
        briefStructuredVersion: 'v2'
      }
    });

    expect(result.response.dialogTurnMode).toBe('answer_only');
    expect(result.response.nextQuestion).toBe('');
    expect((result.response.questionsCount ?? 0)).toBeLessThanOrEqual(2);
  });

  it('does not expose canonical serviceType codes in user-facing reply', async () => {
    const history: Array<{role: 'user' | 'assistant'; content: string}> = [
      {role: 'assistant', content: 'Здравствуйте! Опишите задачу — я задам пару уточняющих вопросов и соберу бриф для команды.'}
    ];

    const result = await runDialogV2Turn({
      locale: 'ru',
      channel: 'web',
      message: 'Нужен лендинг для агентства недвижимости',
      runtimeMode: 'v2_deterministic',
      history,
      identityState: 'unverified',
      briefContext: {
        serviceType: null,
        primaryGoal: null,
        timelineHint: null,
        budgetHint: null,
        missingFields: ['service_type', 'primary_goal', 'timeline_or_budget', 'contact'],
        completenessScore: 0,
        hasConversationContact: false,
        briefStructuredVersion: 'v2'
      }
    });

    expect(result.response.answer).not.toContain('landing_website');
    expect(result.response.answer.toLowerCase()).toContain('лендинг');
  });

  it('does not expose internal budget raw/normalized markers in reply', async () => {
    const history: Array<{role: 'user' | 'assistant'; content: string}> = [
      {role: 'assistant', content: 'Какие сроки запуска для вас критичны?'}
    ];

    const result = await runDialogV2Turn({
      locale: 'ru',
      channel: 'web',
      message: 'Бюджет 3-4 м',
      runtimeMode: 'v2_deterministic',
      history,
      identityState: 'unverified',
      briefContext: {
        serviceType: 'landing_website',
        primaryGoal: 'Продажа недвижимости',
        timelineHint: null,
        budgetHint: null,
        missingFields: ['timeline_or_budget', 'contact'],
        completenessScore: 50,
        hasConversationContact: false,
        briefStructuredVersion: 'v2'
      }
    });

    expect(result.response.answer.toLowerCase()).not.toContain('raw:');
    expect(result.response.answer.toLowerCase()).not.toContain('normalized:');
  });
});
