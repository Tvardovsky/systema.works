import {describe, expect, it} from 'bun:test';
import {getAreaBudgetClarification, hasBriefConversationContact, shouldDeferWebHandoffUntilBudget} from './orchestrator';

describe('hasBriefConversationContact', () => {
  it('returns true when phone exists in brief', () => {
    expect(hasBriefConversationContact({phone: '+38268291324'})).toBe(true);
  });

  it('returns true when email exists in brief', () => {
    expect(hasBriefConversationContact({email: 'oleg@example.com'})).toBe(true);
  });

  it('returns true when telegram handle exists in brief', () => {
    expect(hasBriefConversationContact({telegramHandle: '@oleg'})).toBe(true);
  });

  it('returns false when contact fields are empty', () => {
    expect(hasBriefConversationContact({email: ' ', phone: null, telegramHandle: ''})).toBe(false);
    expect(hasBriefConversationContact(null)).toBe(false);
  });
});

describe('shouldDeferWebHandoffUntilBudget', () => {
  it('defers for unverified web chats without budget and no high-intent', () => {
    expect(
      shouldDeferWebHandoffUntilBudget({
        channel: 'web',
        identityState: 'unverified',
        hasBudgetHint: false,
        highIntent: false
      })
    ).toBe(true);
  });

  it('does not defer for high-intent web chats', () => {
    expect(
      shouldDeferWebHandoffUntilBudget({
        channel: 'web',
        identityState: 'unverified',
        hasBudgetHint: false,
        highIntent: true
      })
    ).toBe(false);
  });

  it('does not defer for verified or non-web channels', () => {
    expect(
      shouldDeferWebHandoffUntilBudget({
        channel: 'telegram',
        identityState: 'unverified',
        hasBudgetHint: false,
        highIntent: false
      })
    ).toBe(false);

    expect(
      shouldDeferWebHandoffUntilBudget({
        channel: 'web',
        identityState: 'verified',
        hasBudgetHint: false,
        highIntent: false
      })
    ).toBe(false);
  });
});

describe('getAreaBudgetClarification', () => {
  it('returns localized area clarification messages', () => {
    expect(getAreaBudgetClarification('ru')).toContain('площад');
    expect(getAreaBudgetClarification('uk')).toContain('площ');
    expect(getAreaBudgetClarification('en')).toContain('area');
  });
});
