import {beforeAll, describe, expect, it} from 'bun:test';
import {getContactOnlyPrompt, getIdentityRequestPrompt, getNameOnlyPrompt, getReferralSourcePrompt} from './lead-signals';
import type {ChatMessage} from '@/types/lead';

let generateAgencyReply: typeof import('./ai').generateAgencyReply;

beforeAll(async () => {
  process.env.OPENAI_API_KEY = '';
  ({generateAgencyReply} = await import('./ai'));
});

describe('generateAgencyReply contact follow-up logic', () => {
  it('asks only for name when contact is already captured in brief context', async () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: getIdentityRequestPrompt('ru')}
    ];

    const result = await generateAgencyReply({
      locale: 'ru',
      message: '+38268291324',
      history,
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        phone: '+38268291324',
        serviceType: 'landing_website',
        primaryGoal: 'Нужен лендинг для аренды авто',
        hasConversationContact: true
      }
    });

    expect(result.nextQuestion).toBe(getNameOnlyPrompt('ru'));
    expect(result.answer).not.toContain(getIdentityRequestPrompt('ru'));
  });

  it('asks only for contact when name is already known', async () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: 'Спасибо. Как к вам обращаться?'}
    ];

    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Олег',
      history,
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        fullName: 'Олег',
        serviceType: 'landing_website',
        primaryGoal: 'Нужен лендинг для аренды авто'
      }
    });

    expect(result.nextQuestion).toBe(getContactOnlyPrompt('ru'));
  });

  it('does not ask for name again after russian reversed name phrase', async () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: 'Спасибо. Как к вам обращаться?'}
    ];

    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Святослав меня зовут',
      history,
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        email: 'djtvardovsky@gmail.com',
        serviceType: 'mobile_app',
        primaryGoal: 'Нужно приложение для недвижимости',
        hasConversationContact: true
      }
    });

    expect(result.nextQuestion).not.toBe(getNameOnlyPrompt('ru'));
    expect(result.answer).not.toContain(getNameOnlyPrompt('ru'));
    expect(result.missingFields).not.toContain('full_name');
  });

  it('asks service-clarify question before identity capture for non-hot intent', async () => {
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Нужен лендинг для аренды авто',
      history: [],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        serviceType: 'landing_website',
        primaryGoal: 'Нужен лендинг для аренды авто'
      }
    });

    expect(result.nextQuestion).toBe('Для какого бизнеса нужен сайт/приложение и какой главный результат вы хотите получить?');
  });

  it('does not repeat scope-clarify prompt after meaningful project reply', async () => {
    const scopePrompt = 'Уточните, пожалуйста, задачу одной фразой: какой продукт или услугу нужно сделать в первую очередь?';
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Мне нужно вести запись клиентов для оказания парикмахерских услуг и хранить карточки клиентов с историей процедур',
      history: [
        {role: 'assistant', content: scopePrompt}
      ],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        fullName: 'Елена',
        phone: '+380963313133',
        hasConversationContact: true
      }
    });

    expect(result.topic).toBe('allowed');
    expect(result.nextQuestion).not.toBe(scopePrompt);
    expect(result.answer).not.toBe(scopePrompt);
  });

  it('treats generic "приложение/application" as in-scope website_app flow', async () => {
    const ru = await generateAgencyReply({
      locale: 'ru',
      message: 'Мне нужно приложение для учета клиентов',
      history: [],
      identityState: 'unverified',
      channel: 'web'
    });

    const en = await generateAgencyReply({
      locale: 'en',
      message: 'Need an application for customer booking',
      history: [],
      identityState: 'unverified',
      channel: 'web'
    });

    expect(ru.topic).toBe('allowed');
    expect(en.topic).toBe('allowed');
    expect(ru.nextQuestion).not.toBe('Уточните, пожалуйста, задачу одной фразой: какой продукт или услугу нужно сделать в первую очередь?');
    expect(ru.nextQuestion.toLowerCase()).toContain('сценар');
  });

  it('does not fall back to generic scope reply for short budget answers in scoped dialog', async () => {
    const history: ChatMessage[] = [
      {role: 'user', content: 'Мне нужен лендинг для агентства аренды автомобилей'},
      {role: 'assistant', content: 'Понял. Какой ориентир по бюджету комфортен?'}
    ];

    const result = await generateAgencyReply({
      locale: 'ru',
      message: '5000 евро',
      history,
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        fullName: 'Олег',
        phone: '+38268291324',
        serviceType: 'landing_website',
        primaryGoal: 'Запуск лидогенерации через лендинг',
        hasConversationContact: true
      }
    });

    expect(result.topic).toBe('allowed');
    expect(result.answer.toLowerCase()).not.toContain('я помогаю только в рамках услуг агентства');
  });

  it('uses different contextual fallback acknowledgements for contact and timeline messages', async () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: getIdentityRequestPrompt('ru')}
    ];

    const contactReply = await generateAgencyReply({
      locale: 'ru',
      message: 'Олег, +38268291324',
      history,
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        serviceType: 'landing_website',
        primaryGoal: 'Нужен лендинг для аренды авто'
      }
    });

    const timelineReply = await generateAgencyReply({
      locale: 'ru',
      message: '3 месяца',
      history: [...history, {role: 'user', content: 'Олег, +38268291324'}, {role: 'assistant', content: contactReply.answer}],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        fullName: 'Олег',
        phone: '+38268291324',
        serviceType: 'landing_website',
        primaryGoal: 'Нужен лендинг для аренды авто',
        hasConversationContact: true
      }
    });

    expect(contactReply.answer).toContain('контакт');
    expect(timelineReply.answer).toContain('срок');
    expect(timelineReply.answer).not.toBe(contactReply.answer);
  });

  it('responds in detected user language when it differs from session locale', async () => {
    const result = await generateAgencyReply({
      locale: 'en',
      message: 'Мне нужен лендинг для аренды авто',
      history: [],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        serviceType: 'landing_website',
        primaryGoal: 'Лиды из лендинга'
      }
    });

    expect(result.nextQuestion).toBe('Для какого бизнеса нужен сайт/приложение и какой главный результат вы хотите получить?');
  });

  it('falls back to session locale on low-confidence language input', async () => {
    const result = await generateAgencyReply({
      locale: 'en',
      message: '12345',
      history: [],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        serviceType: 'landing_website',
        primaryGoal: 'Lead generation'
      }
    });

    expect(result.nextQuestion).toBe('Which first conversion scenario is priority now: lead form, sale, booking, catalog, or something else?');
  });

  it('does not repeat same timeline prompt after budget answer in follow-up turn', async () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: 'Какие сроки запуска для вас критичны?'},
      {role: 'user', content: 'Сроки пока неважны'},
      {role: 'assistant', content: 'Срок зафиксировал. Чтобы менеджер дал точную оценку, подскажите ориентир по бюджету.'}
    ];

    const result = await generateAgencyReply({
      locale: 'ru',
      message: '1000 евро',
      history,
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        fullName: 'Олег',
        phone: '+38268291324',
        serviceType: 'landing_website',
        primaryGoal: 'Нужен лендинг',
        timelineHint: 'no_deadline',
        hasConversationContact: true
      }
    });

    expect(result.answer).toContain('бюдж');
    expect(result.answer).not.toContain('Срок зафиксировал. Чтобы менеджер дал точную оценку, подскажите ориентир по бюджету.');
  });

  it('asks website service-clarify step1 for non-hot request before contact capture', async () => {
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Нужен сайт для стоматологии',
      history: [],
      identityState: 'unverified',
      channel: 'web'
    });

    expect(result.nextQuestion).toBe('Для какого бизнеса нужен сайт/приложение и какой главный результат вы хотите получить?');
    expect((result.answer.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it('avoids repeating the same fallback opening phrase in consecutive assistant turns', async () => {
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Facebook, Instagram, Telegram и Whatsapp',
      history: [
        {
          role: 'assistant',
          content: 'Понял задачу, двигаемся дальше по брифу. Какие каналы уже активны и какой KPI приоритетен сейчас?'
        }
      ],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        serviceType: 'ai_assistant',
        primaryGoal: 'Нужен ИИ чат'
      }
    });

    expect(result.answer.startsWith('Понял задачу, двигаемся дальше по брифу.')).toBeFalse();
  });

  it('asks service-clarify step2 after step1 context is captured', async () => {
    const step1 = 'Для какого бизнеса нужен сайт/приложение и какой главный результат вы хотите получить?';
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Для аренды авто',
      history: [
        {role: 'assistant', content: step1}
      ],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        serviceType: 'landing_website',
        primaryGoal: 'Нужен сайт'
      }
    });

    expect(result.nextQuestion).toBe('Какой первый сценарий конверсии приоритетен сейчас: заявка, продажа, бронь, каталог или другое?');
  });

  it('stops service-clarify after two steps and returns to standard brief questions', async () => {
    const step1 = 'Для какого бизнеса нужен сайт/приложение и какой главный результат вы хотите получить?';
    const step2 = 'Какой первый сценарий конверсии приоритетен сейчас: заявка, продажа, бронь, каталог или другое?';
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Первый сценарий — заявка с формы и запись на звонок',
      history: [
        {role: 'assistant', content: step1},
        {role: 'user', content: 'Для аренды авто, хотим лиды'},
        {role: 'assistant', content: step2}
      ],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        serviceType: 'landing_website',
        primaryGoal: 'Лиды для аренды авто',
        firstDeliverable: 'Форма заявки и быстрый расчет стоимости'
      }
    });

    expect(result.nextQuestion).toBe(getIdentityRequestPrompt('ru'));
    expect(result.nextQuestion).not.toBe(step1);
    expect(result.nextQuestion).not.toBe(step2);
  });

  it('keeps contact-first priority for hot-intent without contact', async () => {
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Нужен сайт, срочно, нужен расчет и созвон сегодня',
      history: [],
      identityState: 'unverified',
      channel: 'web'
    });

    expect(result.nextQuestion).toBe(getIdentityRequestPrompt('ru'));
  });

  it('defers repeated contact capture when user asks to discuss project first', async () => {
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Давай сначала обсудим проект. Нужен лендинг для салона и запись клиентов через форму',
      history: [
        {role: 'assistant', content: getIdentityRequestPrompt('ru')}
      ],
      identityState: 'unverified',
      channel: 'web'
    });

    expect(result.nextQuestion).not.toBe(getIdentityRequestPrompt('ru'));
    expect(result.nextQuestion).not.toBe(getContactOnlyPrompt('ru'));
  });

  it('keeps hot-intent contact-first even when user asks to discuss first', async () => {
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Давай сначала обсудим, но нужен срочный созвон сегодня и быстрый старт',
      history: [
        {role: 'assistant', content: getIdentityRequestPrompt('ru')}
      ],
      identityState: 'unverified',
      channel: 'web'
    });

    expect(result.nextQuestion).toBe(getIdentityRequestPrompt('ru'));
  });

  it('uses branding service-clarify questions when branding intent is detected', async () => {
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Нужен брендинг и логотип для нового кафе',
      history: [],
      identityState: 'unverified',
      channel: 'telegram'
    });

    expect(result.nextQuestion).toBe('Какая у вас ниша бизнеса и какую ключевую задачу должен решить логотип/брендинг?');
  });

  it('asks referral source once after core brief is complete and delays handoff on that turn', async () => {
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Все верно, можно дальше',
      history: [],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        fullName: 'Олег',
        phone: '+38268291324',
        serviceType: 'landing_website',
        primaryGoal: 'Нужен лендинг для лидогенерации',
        timelineHint: 'duration:2_weeks',
        hasConversationContact: true
      }
    });

    expect(result.nextQuestion).toBe(getReferralSourcePrompt('ru'));
    expect(result.handoffReady).toBe(false);
  });

  it('does not ask referral again and does not block handoff after referral question was already asked', async () => {
    const result = await generateAgencyReply({
      locale: 'ru',
      message: 'Хорошо, передавайте менеджеру',
      history: [
        {role: 'assistant', content: getReferralSourcePrompt('ru')}
      ],
      identityState: 'unverified',
      channel: 'web',
      briefContext: {
        fullName: 'Олег',
        phone: '+38268291324',
        serviceType: 'landing_website',
        primaryGoal: 'Нужен лендинг для лидогенерации',
        timelineHint: 'duration:2_weeks',
        hasConversationContact: true
      }
    });

    expect(result.nextQuestion).not.toBe(getReferralSourcePrompt('ru'));
    expect(result.handoffReady).toBe(true);
  });
});
