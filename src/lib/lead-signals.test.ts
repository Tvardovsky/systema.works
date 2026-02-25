import {describe, expect, it} from 'bun:test';
import {extractLeadSignals, getIdentityRequestPrompt, getReferralSourcePrompt, mapServiceTypeToFamily} from './lead-signals';
import type {ChatMessage} from '@/types/lead';

describe('extractLeadSignals', () => {
  it('extracts name + phone from short contact reply when assistant asked identity', () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: getIdentityRequestPrompt('ru')}
    ];

    const result = extractLeadSignals({
      history,
      message: 'Олег, +38268291324'
    });

    expect(result.name).toBe('Олег');
    expect(result.normalizedPhone).toBe('+38268291324');
  });

  it('does not infer contextual name when identity was not requested', () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: 'Какой ориентир по бюджету комфортен?'}
    ];

    const result = extractLeadSignals({
      history,
      message: 'Олег, +38268291324'
    });

    expect(result.name).toBeNull();
    expect(result.normalizedPhone).toBe('+38268291324');
  });

  it('extracts explicit name pattern from full sentence', () => {
    const result = extractLeadSignals({
      history: [],
      message: 'Меня зовут Олег, мой номер +38268291324'
    });

    expect(result.name).toBe('Олег');
    expect(result.normalizedPhone).toBe('+38268291324');
  });

  it('extracts reversed russian name phrase', () => {
    const result = extractLeadSignals({
      history: [],
      message: 'Святослав меня зовут'
    });

    expect(result.name).toBe('Святослав');
  });

  it('extracts short name reply after assistant asked for name', () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: 'Спасибо. Как к вам обращаться?'}
    ];
    const result = extractLeadSignals({
      history,
      message: 'Святослав'
    });

    expect(result.name).toBe('Святослав');
  });

  it('does not treat short confirmation as name', () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: 'Спасибо. Как к вам обращаться?'}
    ];
    const result = extractLeadSignals({
      history,
      message: 'Да'
    });

    expect(result.name).toBeNull();
  });

  it('keeps name empty for phone-only answer', () => {
    const history: ChatMessage[] = [
      {role: 'assistant', content: getIdentityRequestPrompt('ru')}
    ];

    const result = extractLeadSignals({
      history,
      message: '+38268291324'
    });

    expect(result.name).toBeNull();
    expect(result.normalizedPhone).toBe('+38268291324');
  });

  it('extracts multilingual budget formats with normalized value', () => {
    const ruBudget = extractLeadSignals({
      history: [],
      message: 'Бюджет 1000 евро'
    });
    const rangeBudget = extractLeadSignals({
      history: [],
      message: 'about 3-5k'
    });
    const upToBudget = extractLeadSignals({
      history: [],
      message: 'до 5k'
    });

    expect(ruBudget.budgetNormalized).toBe('EUR 1000');
    expect(rangeBudget.budgetNormalized).toBe('UNKNOWN 3000-5000');
    expect(upToBudget.budgetNormalized).toBe('up_to UNKNOWN 5000');
  });

  it('does not treat phone-only number as budget', () => {
    const result = extractLeadSignals({
      history: [],
      message: '+38268291324'
    });

    expect(result.budgetNormalized).toBeNull();
  });

  it('does not infer RSD budget from "lenдинг" + phone context', () => {
    const result = extractLeadSignals({
      history: [
        {role: 'user', content: 'Нужен лендинг для аренды авто'}
      ],
      message: 'Олег, 38268291324'
    });

    expect(result.normalizedPhone).toBe('+38268291324');
    expect(result.budgetHint).toBeNull();
    expect(result.budgetNormalized).toBeNull();
  });

  it('parses no-deadline and asap timeline in multiple languages', () => {
    const ruNoDeadline = extractLeadSignals({
      history: [],
      message: 'Сроки пока неважны'
    });
    const enNoDeadline = extractLeadSignals({
      history: [],
      message: 'Timeline is flexible for now'
    });
    const asapTimeline = extractLeadSignals({
      history: [],
      message: 'Need this asap'
    });

    expect(ruNoDeadline.timelineNormalized).toBe('no_deadline');
    expect(enNoDeadline.timelineNormalized).toBe('no_deadline');
    expect(asapTimeline.timelineNormalized).toBe('asap');
  });

  it('parses mixed-language budget message', () => {
    const result = extractLeadSignals({
      history: [],
      message: 'Need landing page, budget 2000 евро'
    });

    expect(result.serviceType).toBe('landing_website');
    expect(result.serviceFamily).toBe('website_app');
    expect(result.budgetNormalized).toBe('EUR 2000');
  });

  it('detects branding/logo service family in multilingual phrases', () => {
    const ru = extractLeadSignals({
      history: [],
      message: 'Нужен брендинг и логотип для новой кофейни'
    });
    const en = extractLeadSignals({
      history: [],
      message: 'Need a logo and brand identity for a fintech startup'
    });
    const sr = extractLeadSignals({
      history: [],
      message: 'Treba logo i vizuelni identitet za lokalni restoran'
    });

    expect(ru.serviceType).toBe('branding_logo');
    expect(en.serviceType).toBe('branding_logo');
    expect(sr.serviceType).toBe('branding_logo');
    expect(ru.serviceFamily).toBe('branding_logo');
    expect(en.serviceFamily).toBe('branding_logo');
    expect(sr.serviceFamily).toBe('branding_logo');
  });

  it('captures referral source after assistant asks referral question', () => {
    const result = extractLeadSignals({
      history: [
        {role: 'assistant', content: getReferralSourcePrompt('ru')}
      ],
      message: 'Через рекомендацию коллеги'
    });

    expect(result.referralSource).toBe('Через рекомендацию коллеги');
  });

  it('captures explicit referral phrase without prior question', () => {
    const result = extractLeadSignals({
      history: [],
      message: 'Found you on Google search'
    });

    expect(result.referralSource).toBe('Found you on Google search');
  });

  it('maps service type to service family consistently', () => {
    expect(mapServiceTypeToFamily('landing_website')).toBe('website_app');
    expect(mapServiceTypeToFamily('automation')).toBe('automation');
    expect(mapServiceTypeToFamily('ai_assistant')).toBe('ai_assistant');
    expect(mapServiceTypeToFamily('ui_ux')).toBe('ui_ux');
    expect(mapServiceTypeToFamily('smm_growth')).toBe('smm_growth');
    expect(mapServiceTypeToFamily('branding_logo')).toBe('branding_logo');
    expect(mapServiceTypeToFamily('unknown_type')).toBe('unknown');
  });
});
