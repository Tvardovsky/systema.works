import type {ChatMessage, Locale} from '@/types/lead';
import type {DirectorDraft} from './director';
import type {DialogSlotKey, DialogTopic, DialogTurnMode} from './types';

function clean(input?: string | null): string {
  return (input ?? '').trim().replace(/\s+/g, ' ');
}

function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function replaceExtraQuestions(text: string, maxQuestions: number): string {
  if (maxQuestions < 0) {
    return text.replace(/\?/g, '.');
  }
  let seen = 0;
  return text.replace(/\?/g, () => {
    seen += 1;
    return seen <= maxQuestions ? '?' : '.';
  });
}

function getLastAssistantQuestion(history: ChatMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role !== 'assistant') {
      continue;
    }
    if (!item.content.includes('?')) {
      continue;
    }
    return clean(item.content);
  }
  return null;
}

function buildScopeClarifyMessage(locale: Locale): string {
  if (locale === 'ru') {
    return 'Чтобы помочь точно, уточните одной фразой: какой цифровой продукт или услугу запускаем в первую очередь?';
  }
  if (locale === 'uk') {
    return 'Щоб допомогти точно, уточніть однією фразою: який цифровий продукт або послугу запускаємо в першу чергу?';
  }
  if (locale === 'sr-ME') {
    return 'Da pomognem precizno, pojasnite u jednoj rečenici: koji digitalni proizvod ili uslugu pokrećemo prvo?';
  }
  return 'To help precisely, clarify in one sentence which digital product or service we should launch first.';
}

export type DialogValidatorResult = {
  answer: string;
  nextQuestion: string;
  nextSlot: DialogSlotKey | 'handoff' | 'scope';
  turnMode: DialogTurnMode;
  questionsCount: number;
  validatorAdjusted: boolean;
  forceDeterministic: boolean;
};

export function validateDialogV3Draft(params: {
  locale: Locale;
  topic: DialogTopic;
  history: ChatMessage[];
  draft: DirectorDraft | null;
  deterministicNextSlot: DialogSlotKey | 'handoff' | 'scope';
  deterministicNextQuestion: string;
  handoffReady: boolean;
  forcedTurnMode: DialogTurnMode | null;
}): DialogValidatorResult {
  if (!params.draft) {
    return {
      answer: '',
      nextQuestion: params.deterministicNextQuestion,
      nextSlot: params.deterministicNextSlot,
      turnMode: params.topic === 'allowed' ? 'progress' : 'scope_clarify',
      questionsCount: countQuestions(params.deterministicNextQuestion),
      validatorAdjusted: false,
      forceDeterministic: true
    };
  }

  let validatorAdjusted = false;
  let answer = clean(params.draft.answer);
  let nextQuestion = clean(params.draft.nextQuestion);
  let nextSlot = params.draft.nextSlot ?? params.deterministicNextSlot;
  let turnMode: DialogTurnMode = params.draft.turnMode;

  if (!answer) {
    return {
      answer: '',
      nextQuestion: params.deterministicNextQuestion,
      nextSlot: params.deterministicNextSlot,
      turnMode: params.topic === 'allowed' ? 'progress' : 'scope_clarify',
      questionsCount: countQuestions(params.deterministicNextQuestion),
      validatorAdjusted: true,
      forceDeterministic: true
    };
  }

  if (params.topic !== 'allowed') {
    turnMode = 'scope_clarify';
    nextSlot = 'scope';
    nextQuestion = params.deterministicNextQuestion || buildScopeClarifyMessage(params.locale);
    validatorAdjusted = true;
  } else if (params.forcedTurnMode === 'answer_only') {
    turnMode = 'answer_only';
    nextQuestion = '';
    nextSlot = params.deterministicNextSlot;
    validatorAdjusted = true;
  }

  if (!params.handoffReady && nextSlot === 'handoff') {
    nextSlot = params.deterministicNextSlot;
    nextQuestion = params.deterministicNextQuestion;
    turnMode = turnMode === 'answer_only' ? turnMode : 'progress';
    validatorAdjusted = true;
  }

  if (turnMode !== 'answer_only' && params.topic === 'allowed' && !nextQuestion) {
    nextQuestion = params.deterministicNextQuestion;
    validatorAdjusted = true;
  }

  if (turnMode === 'answer_only') {
    nextQuestion = '';
  }

  const lastAssistantQuestion = getLastAssistantQuestion(params.history)?.toLowerCase() ?? '';
  if (
    turnMode === 'progress'
    && nextQuestion
    && lastAssistantQuestion
    && clean(nextQuestion).toLowerCase() === lastAssistantQuestion
  ) {
    turnMode = 'answer_only';
    nextQuestion = '';
    validatorAdjusted = true;
  }

  const answerQuestionBudget = turnMode === 'answer_only' ? 2 : (nextQuestion ? 1 : 2);
  const normalizedAnswer = replaceExtraQuestions(answer, answerQuestionBudget);
  if (normalizedAnswer !== answer) {
    answer = normalizedAnswer;
    validatorAdjusted = true;
  }
  if (nextQuestion) {
    const normalizedNext = replaceExtraQuestions(nextQuestion, 1);
    if (normalizedNext !== nextQuestion) {
      nextQuestion = normalizedNext;
      validatorAdjusted = true;
    }
  }

  const questionsCount = countQuestions(answer) + countQuestions(nextQuestion);
  return {
    answer,
    nextQuestion,
    nextSlot,
    turnMode,
    questionsCount,
    validatorAdjusted,
    forceDeterministic: false
  };
}
