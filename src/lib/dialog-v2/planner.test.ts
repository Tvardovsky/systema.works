import {describe, expect, it} from 'bun:test';
import {planDialogV2} from './planner';
import type {DialogV2ResolveResult} from './resolve';
import type {ResolvedContact, ResolvedSlot, SlotState} from './types';

function slot(state: SlotState, value: string | null = null): ResolvedSlot {
  return {
    value,
    state,
    confidence: state === 'confirmed' ? 0.9 : 0.5,
    evidence: value,
    source: value ? 'regex' : null,
    explicit: state === 'confirmed',
    updatedThisTurn: false
  };
}

function contact(state: SlotState): ResolvedContact {
  return {
    email: slot(state, state === 'confirmed' ? 'lead@example.com' : null),
    phone: slot('unknown', null),
    telegramHandle: slot('unknown', null),
    aggregate: slot(state, state === 'confirmed' ? 'lead@example.com' : null)
  };
}

function resolvedBase(): DialogV2ResolveResult {
  return {
    topic: 'allowed',
    askedReferralBeforeTurn: false,
    missingBlocking: [],
    slots: {
      serviceType: slot('confirmed', 'landing_website'),
      primaryGoal: slot('confirmed', 'Increase qualified leads from website traffic'),
      firstDeliverable: slot('confirmed', 'Landing page v1'),
      timeline: slot('confirmed', '2 weeks'),
      budget: slot('unknown', null),
      contact: contact('confirmed'),
      fullName: slot('unknown', null),
      referralSource: slot('unknown', null),
      constraints: slot('unknown', null)
    }
  };
}

describe('dialog-v2/planner', () => {
  it('asks primary goal after deliverable-only signal', () => {
    const resolved = resolvedBase();
    resolved.slots.primaryGoal = slot('unknown', null);
    resolved.missingBlocking = ['primary_goal'];

    const plan = planDialogV2({locale: 'en', resolved});
    expect(plan.nextSlot).toBe('primaryGoal');
    expect(plan.nextQuestion.toLowerCase()).toContain('business outcome');
  });

  it('asks referral once after core brief is complete', () => {
    const resolved = resolvedBase();

    const firstPlan = planDialogV2({locale: 'en', resolved});
    expect(firstPlan.nextSlot).toBe('referralSource');
    expect(firstPlan.handoffReady).toBe(false);

    const afterAsked = {
      ...resolved,
      askedReferralBeforeTurn: true
    };
    const secondPlan = planDialogV2({locale: 'en', resolved: afterAsked});
    expect(secondPlan.nextSlot).toBe('handoff');
    expect(secondPlan.handoffReady).toBe(true);
  });

  it('avoids asking the same timeline slot twice in a row', () => {
    const resolved = resolvedBase();
    resolved.slots.timeline = slot('unknown', null);
    resolved.slots.budget = slot('unknown', null);
    resolved.missingBlocking = ['timeline_or_budget'];

    const plan = planDialogV2({
      locale: 'ru',
      resolved,
      previous: {
        previousNextSlot: 'timeline',
        deferredSlot: null,
        deferTurnsRemaining: 0
      }
    });

    expect(plan.nextSlot).toBe('budget');
    expect(plan.nextQuestion.toLowerCase()).toContain('бюдж');
  });

  it('defers blocking slot for discuss-project intent and keeps countdown', () => {
    const resolved = resolvedBase();
    resolved.slots.contact = contact('unknown');
    resolved.missingBlocking = ['contact'];

    const deferred = planDialogV2({
      locale: 'ru',
      resolved,
      message: 'А давай обсудим структуру лендинга',
      previous: {
        previousNextSlot: 'contact',
        deferredSlot: null,
        deferTurnsRemaining: 0
      }
    });

    expect(deferred.nextSlot).toBe('firstDeliverable');
    expect(deferred.deferredSlot).toBe('contact');
    expect(deferred.deferTurnsRemaining).toBe(2);
  });
});
