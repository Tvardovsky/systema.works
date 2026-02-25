import {expect, test} from '@playwright/test';
import {generateAgencyReply} from '../src/lib/ai';

test.describe('dialog-v3 channels runtime', () => {
  test('returns stable v3 reply across all supported channels', async () => {
    const previousMode = process.env.CHAT_DIALOG_MODE;
    process.env.CHAT_DIALOG_MODE = 'v3_llm_first';

    try {
      const channels = ['web', 'telegram', 'instagram', 'facebook', 'whatsapp'] as const;
      for (const channel of channels) {
        const reply = await generateAgencyReply({
          locale: 'en',
          message: 'Need a landing page for lead generation. What timeline is realistic for MVP?',
          history: [
            {role: 'assistant', content: 'Describe your task and I will prepare a short brief.'}
          ],
          channel,
          briefContext: {
            serviceType: 'landing_website',
            primaryGoal: null,
            timelineHint: null,
            budgetHint: null,
            missingFields: ['primary_goal', 'timeline_or_budget', 'contact'],
            completenessScore: 25,
            hasConversationContact: false
          }
        });

        expect(reply.answer.length).toBeGreaterThan(0);
        expect(reply.dialogTurnMode === 'progress' || reply.dialogTurnMode === 'answer_only' || reply.dialogTurnMode === 'scope_clarify').toBe(true);
        expect((reply.questionsCount ?? 0)).toBeLessThanOrEqual(2);
        expect(reply.fallbackPath === 'primary' || reply.fallbackPath === 'retry' || reply.fallbackPath === 'deterministic').toBe(true);
      }
    } finally {
      process.env.CHAT_DIALOG_MODE = previousMode;
    }
  });
});
