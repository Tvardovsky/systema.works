import type {TopicThread, TopicThreadKey, ThreadDepth} from './types';

/**
 * Initialize a new topic thread.
 */
function createThread(key: TopicThreadKey, turnNumber: number): TopicThread {
  return {
    key,
    depth: 'surface',
    entities: {},
    lastActiveAt: turnNumber,
    openQuestions: []
  };
}

/**
 * Calculate thread depth based on entity count and quality.
 */
function calculateThreadDepth(thread: TopicThread): ThreadDepth {
  const entityCount = Object.keys(thread.entities).length;
  const hasDetailedEntities = Object.values(thread.entities).some(
    (value) => Array.isArray(value) ? value.length > 1 : (value?.length ?? 0) > 20
  );

  if (entityCount === 0) {
    return 'surface';
  }

  if (entityCount >= 4 || hasDetailedEntities) {
    return 'detailed';
  }

  if (entityCount >= 2) {
    return 'explored';
  }

  return 'surface';
}

/**
 * Get all topic threads.
 */
export function getAllThreads(): TopicThreadKey[] {
  return ['project_scope', 'logistics', 'relationship', 'handoff'];
}

/**
 * Initialize conversation with empty threads.
 */
export function initializeThreads(turnNumber = 0): Record<TopicThreadKey, TopicThread> {
  const threads: Record<TopicThreadKey, TopicThread> = {
    project_scope: createThread('project_scope', turnNumber),
    logistics: createThread('logistics', turnNumber),
    relationship: createThread('relationship', turnNumber),
    handoff: createThread('handoff', turnNumber)
  };

  return threads;
}

/**
 * Update thread with new entities from user message.
 */
export function updateThread(
  thread: TopicThread,
  entities: Record<string, string | string[]>,
  turnNumber: number
): TopicThread {
  const updatedEntities = {...thread.entities};

  for (const [key, value] of Object.entries(entities)) {
    const existingValue = updatedEntities[key];

    if (Array.isArray(value)) {
      // Merge arrays, avoiding duplicates
      const existingArray = Array.isArray(existingValue) ? existingValue : [existingValue].filter(Boolean);
      const newArray = Array.from(new Set([...existingArray, ...value]));
      updatedEntities[key] = newArray;
    } else if (value) {
      // Prefer longer, more detailed values
      const existingStr = typeof existingValue === 'string' ? existingValue : '';
      if (value.length > existingStr.length || !existingStr) {
        updatedEntities[key] = value;
      }
    }
  }

  return {
    ...thread,
    entities: updatedEntities,
    lastActiveAt: turnNumber,
    depth: calculateThreadDepth({...thread, entities: updatedEntities})
  };
}

/**
 * Mark thread as active and optionally add open question.
 */
export function activateThread(
  thread: TopicThread,
  turnNumber: number,
  openQuestion?: string
): TopicThread {
  const updatedQuestions = openQuestion
    ? Array.from(new Set([...thread.openQuestions, openQuestion]))
    : thread.openQuestions;

  return {
    ...thread,
    lastActiveAt: turnNumber,
    openQuestions: updatedQuestions
  };
}

/**
 * Remove answered question from thread.
 */
export function answerQuestion(
  thread: TopicThread,
  questionPattern: string | RegExp
): TopicThread {
  const remainingQuestions = thread.openQuestions.filter((q) => {
    if (typeof questionPattern === 'string') {
      return !q.toLowerCase().includes(questionPattern.toLowerCase());
    }
    return !questionPattern.test(q);
  });

  return {
    ...thread,
    openQuestions: remainingQuestions
  };
}

/**
 * Get the most active thread (recently engaged).
 */
export function getMostActiveThread(
  threads: Record<TopicThreadKey, TopicThread>
): TopicThreadKey | null {
  let mostActive: TopicThreadKey | null = null;
  let mostRecentTurn = -1;

  for (const [key, thread] of Object.entries(threads) as Array<[TopicThreadKey, TopicThread]>) {
    if (thread.lastActiveAt > mostRecentTurn && thread.depth !== 'surface') {
      mostActive = key;
      mostRecentTurn = thread.lastActiveAt;
    }
  }

  return mostActive;
}

/**
 * Get thread by key, creating if doesn't exist.
 */
export function getOrCreateThread(
  threads: Record<TopicThreadKey, TopicThread>,
  key: TopicThreadKey,
  turnNumber: number
): TopicThread {
  if (!threads[key]) {
    return createThread(key, turnNumber);
  }
  return threads[key];
}

/**
 * Check if thread has enough depth for handoff.
 */
export function isThreadReadyForHandoff(thread: TopicThread): boolean {
  if (thread.depth === 'decision_ready') {
    return true;
  }

  // Check for essential entities based on thread type
  if (thread.key === 'project_scope') {
    const hasService = !!thread.entities.serviceType;
    const hasGoal = !!thread.entities.primaryGoal;
    return hasService && hasGoal;
  }

  if (thread.key === 'logistics') {
    const hasTimeline = !!thread.entities.timelineHint;
    const hasBudget = !!thread.entities.budgetHint;
    return hasTimeline || hasBudget;
  }

  if (thread.key === 'relationship') {
    const hasContact = !!thread.entities.email || !!thread.entities.phone;
    const hasName = !!thread.entities.fullName;
    return hasContact && hasName;
  }

  return false;
}

/**
 * Promote thread depth based on engagement.
 */
export function promoteThreadDepth(thread: TopicThread): TopicThread {
  const currentDepth = thread.depth;
  let newDepth: ThreadDepth = currentDepth;

  if (currentDepth === 'surface' && Object.keys(thread.entities).length >= 2) {
    newDepth = 'explored';
  } else if (currentDepth === 'explored' && Object.keys(thread.entities).length >= 4) {
    newDepth = 'detailed';
  } else if (currentDepth === 'detailed' && thread.openQuestions.length === 0) {
    newDepth = 'decision_ready';
  }

  if (newDepth !== currentDepth) {
    return {...thread, depth: newDepth};
  }

  return thread;
}

/**
 * Get summary of all threads for context.
 */
export function getThreadsSummary(
  threads: Record<TopicThreadKey, TopicThread>
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const [key, thread] of Object.entries(threads)) {
    summary[key] = {
      depth: thread.depth,
      entityCount: Object.keys(thread.entities).length,
      entities: thread.entities,
      openQuestions: thread.openQuestions
    };
  }

  return summary;
}

/**
 * Merge threads from previous context with new data.
 */
export function mergeThreads(
  existing: Record<TopicThreadKey, TopicThread>,
  incoming: Record<TopicThreadKey, TopicThread>,
  turnNumber: number
): Record<TopicThreadKey, TopicThread> {
  const merged: Record<TopicThreadKey, TopicThread> = {
    project_scope: createThread('project_scope', turnNumber),
    logistics: createThread('logistics', turnNumber),
    relationship: createThread('relationship', turnNumber),
    handoff: createThread('handoff', turnNumber)
  };

  for (const key of getAllThreads()) {
    const existingThread = existing[key];
    const incomingThread = incoming[key];

    if (!existingThread && !incomingThread) {
      continue;
    }

    if (existingThread && !incomingThread) {
      merged[key] = existingThread;
      continue;
    }

    if (!existingThread && incomingThread) {
      merged[key] = incomingThread;
      continue;
    }

    // Merge both threads
    merged[key] = {
      key,
      depth: incomingThread!.depth !== 'surface' ? incomingThread!.depth : existingThread!.depth,
      entities: {
        ...existingThread!.entities,
        ...incomingThread!.entities
      },
      lastActiveAt: Math.max(existingThread!.lastActiveAt, incomingThread!.lastActiveAt),
      openQuestions: Array.from(new Set([...existingThread!.openQuestions, ...incomingThread!.openQuestions]))
    };
  }

  return merged;
}
