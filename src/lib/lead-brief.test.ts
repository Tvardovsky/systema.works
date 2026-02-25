import {describe, expect, it} from 'bun:test';
import {computeLeadBriefState} from './lead-brief';

describe('computeLeadBriefState', () => {
  it('requires core-4 plus contact for handoff', () => {
    const withoutContact = computeLeadBriefState({
      serviceType: 'landing_website',
      primaryGoal: 'Increase qualified leads',
      timelineHint: '2 weeks',
      email: null,
      phone: null,
      telegramHandle: null
    });
    expect(withoutContact.handoffReady).toBe(false);
    expect(withoutContact.missingFields).toContain('contact');

    const ready = computeLeadBriefState({
      serviceType: 'landing_website',
      primaryGoal: 'Increase qualified leads',
      timelineHint: '2 weeks',
      phone: '+38268291324'
    });
    expect(ready.handoffReady).toBe(true);
    expect(ready.missingFields).toHaveLength(0);
  });

  it('does not block handoff when full name is missing', () => {
    const result = computeLeadBriefState({
      fullName: null,
      serviceType: 'automation',
      primaryGoal: 'Reduce manual operations costs',
      budgetHint: 'EUR 5000',
      email: 'lead@example.com'
    });

    expect(result.handoffReady).toBe(true);
    expect(result.missingFields).not.toContain('full_name');
  });

  it('treats timeline_or_budget as OR when evaluating blocking core fields', () => {
    const withBudgetOnly = computeLeadBriefState({
      serviceType: 'mobile_app',
      primaryGoal: 'Launch MVP quickly',
      budgetHint: 'EUR 12000',
      email: 'lead@example.com'
    });

    expect(withBudgetOnly.handoffReady).toBe(true);
    expect(withBudgetOnly.missingFields).not.toContain('timeline_or_budget');
    expect(withBudgetOnly.missingCoreSlots).not.toContain('timeline_or_budget');
    expect(withBudgetOnly.readiness).toBe('ready');
    expect(withBudgetOnly.nextSlot).toBe('handoff');
  });
});
