import {describe, expect, it} from 'bun:test';
import {extractDialogV2Candidates} from './extract';

describe('dialog-v2/extract', () => {
  it('does not infer timeline from generic delivery request', () => {
    const result = extractDialogV2Candidates({
      message: 'Привет, мне нужен лендинг для продажи объектов недвижимости в новом ЖК',
      history: []
    });

    expect(result.extractedFields.timelineHint).toBeNull();
    expect(result.fields.timeline.explicit).toBe(false);
  });

  it('captures explicit timeline markers only when present', () => {
    const result = extractDialogV2Candidates({
      message: 'Need a landing page. Timeline is 2 weeks.',
      history: []
    });

    expect(result.fields.timeline.explicit).toBe(true);
    expect(result.extractedFields.timelineHint).toBeTruthy();
  });

  it('normalizes no-deadline replies as confirmed timeline signal', () => {
    const result = extractDialogV2Candidates({
      message: 'Сроков пока нет',
      history: []
    });

    expect(result.fields.timeline.explicit).toBe(true);
    expect(result.extractedFields.timelineHint).toBe('no_deadline');
  });

  it('treats short goal answer as explicit when previous assistant asked business outcome', () => {
    const result = extractDialogV2Candidates({
      message: 'Построить и продать!',
      history: [
        {role: 'assistant', content: 'Какой бизнес-результат для вас главный в этом проекте?'}
      ]
    });

    expect(result.fields.primaryGoal.explicit).toBe(true);
    expect(result.extractedFields.primaryGoal).toContain('Построить и продать');
  });
});
