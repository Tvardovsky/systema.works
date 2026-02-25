import {describe, expect, it} from 'bun:test';
import {detectUserIntent} from './user-intent';

describe('dialog-v2/user-intent', () => {
  it('marks in-scope question as answer_only', () => {
    const intent = detectUserIntent({
      message: 'Какие интеграции с CRM вы делали для лендингов?',
      topic: 'allowed'
    });
    expect(intent.inScopeQuestion).toBe(true);
    expect(intent.turnModeSuggestion).toBe('answer_only');
  });

  it('does not treat contact payload as counter-question', () => {
    const intent = detectUserIntent({
      message: 'Email: lead@example.com',
      topic: 'allowed'
    });
    expect(intent.inScopeQuestion).toBe(false);
    expect(intent.turnModeSuggestion).toBe(null);
  });

  it('marks out-of-scope question as scope_clarify', () => {
    const intent = detectUserIntent({
      message: 'Какая погода в Подгорице завтра?',
      topic: 'disallowed'
    });
    expect(intent.outOfScopeQuestion).toBe(true);
    expect(intent.turnModeSuggestion).toBe('scope_clarify');
  });
});
