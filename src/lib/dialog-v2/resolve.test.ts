import {describe, expect, it} from 'bun:test';
import {resolveDialogV2} from './resolve';
import type {DialogV2ExtractResult} from './extract';
import type {SlotCandidate} from './types';

function slot(value: string | null, options?: Partial<SlotCandidate>): SlotCandidate {
  return {
    value,
    confidence: 0,
    evidence: value,
    source: value ? 'regex' : null,
    explicit: false,
    updatedThisTurn: false,
    ...options
  };
}

function buildExtract(fields: Partial<DialogV2ExtractResult['fields']>): DialogV2ExtractResult {
  return {
    topic: 'allowed',
    askedReferralBeforeTurn: false,
    fields: {
      serviceType: slot('landing_website', {confidence: 0.9, explicit: true}),
      primaryGoal: slot(null),
      firstDeliverable: slot(null),
      timeline: slot(null),
      budget: slot(null),
      fullName: slot(null),
      referralSource: slot(null),
      constraints: slot(null),
      contact: {
        email: slot(null),
        phone: slot(null),
        telegramHandle: slot(null)
      },
      ...fields
    },
    extractedFields: {
      fullName: null,
      email: null,
      phone: null,
      telegramHandle: null,
      serviceType: null,
      primaryGoal: null,
      firstDeliverable: null,
      timelineHint: null,
      budgetHint: null,
      referralSource: null,
      constraints: null
    }
  };
}

describe('dialog-v2/resolve', () => {
  it('keeps deliverable and clears duplicated goal when goal is inferred from same phrase', () => {
    const extracted = buildExtract({
      primaryGoal: slot('Need a landing page for real estate sales', {confidence: 0.82, explicit: false}),
      firstDeliverable: slot('Need a landing page for real estate sales', {confidence: 0.88, explicit: true})
    });

    const resolved = resolveDialogV2({extracted});
    expect(resolved.slots.primaryGoal.state).toBe('unknown');
    expect(resolved.slots.firstDeliverable.state).toBe('confirmed');
    expect(resolved.missingBlocking).toContain('primary_goal');
  });

  it('does not confirm contact without explicit signal', () => {
    const extracted = buildExtract({
      contact: {
        email: slot('test@example.com', {confidence: 0.98, explicit: false}),
        phone: slot(null),
        telegramHandle: slot(null)
      }
    });

    const resolved = resolveDialogV2({extracted});
    expect(resolved.slots.contact.aggregate.state).not.toBe('confirmed');
    expect(resolved.missingBlocking).toContain('contact');
  });

  it('keeps context-confirmed timeline from degrading to unknown', () => {
    const extracted = buildExtract({
      timeline: slot('no_deadline', {
        confidence: 1,
        explicit: true,
        source: 'history',
        updatedThisTurn: false
      })
    });

    const resolved = resolveDialogV2({extracted});
    expect(resolved.slots.timeline.state).toBe('confirmed');
    expect(resolved.slots.timeline.value).toBe('no_deadline');
    expect(resolved.missingBlocking).not.toContain('timeline_or_budget');
  });
});
