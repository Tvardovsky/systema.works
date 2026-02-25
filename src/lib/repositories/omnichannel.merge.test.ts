import {describe, expect, it} from 'bun:test';
import {rankMergeCandidatesByActivityScore} from './omnichannel';

describe('rankMergeCandidatesByActivityScore', () => {
  it('prioritizes candidates with higher activity score', () => {
    const ranked = rankMergeCandidatesByActivityScore([
      {id: 'a', updated_at: '2026-02-25T10:00:00.000Z', activityScore: 2},
      {id: 'b', updated_at: '2026-02-25T09:00:00.000Z', activityScore: 8},
      {id: 'c', updated_at: '2026-02-25T11:00:00.000Z', activityScore: 5}
    ]);

    expect(ranked.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('uses updated_at as tie-breaker when activity is equal', () => {
    const ranked = rankMergeCandidatesByActivityScore([
      {id: 'older', updated_at: '2026-02-25T09:00:00.000Z', activityScore: 4},
      {id: 'newer', updated_at: '2026-02-25T10:30:00.000Z', activityScore: 4}
    ]);

    expect(ranked.map((item) => item.id)).toEqual(['newer', 'older']);
  });
});
