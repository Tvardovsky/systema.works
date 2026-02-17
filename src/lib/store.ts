import {randomUUID} from 'crypto';
import type {ChatMessage, Locale} from '@/types/lead';
import {upsertSessionLog} from './logs';

type Session = {
  id: string;
  locale: Locale;
  createdAt: number;
  pagePath: string;
  history: ChatMessage[];
};

const sessionStore = new Map<string, Session>();

async function persistSession(session: Session) {
  await upsertSessionLog({
    ts: new Date().toISOString(),
    kind: 'session',
    sessionId: session.id,
    locale: session.locale,
    pagePath: session.pagePath,
    history: session.history
  });
}

export function createSession(locale: Locale, pagePath: string): Session {
  const id = randomUUID();
  const session: Session = {
    id,
    locale,
    createdAt: Date.now(),
    pagePath,
    history: []
  };
  sessionStore.set(id, session);
  void persistSession(session);
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  return sessionStore.get(sessionId);
}

export function appendSessionMessage(sessionId: string, role: ChatMessage['role'], content: string) {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return;
  }
  session.history.push({role, content});
  if (session.history.length > 30) {
    session.history = session.history.slice(-30);
  }
  void persistSession(session);
}
