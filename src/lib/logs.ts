import {mkdir, readFile, writeFile} from 'fs/promises';
import {join} from 'path';

type LogKind = 'session' | 'lead';

type BaseLog = {
  ts: string;
  kind: LogKind;
};

export type SessionLog = BaseLog & {
  kind: 'session';
  sessionId: string;
  locale: string;
  pagePath: string;
  history: Array<{role: 'user' | 'assistant'; content: string}>;
};

export type LeadLog = BaseLog & {
  kind: 'lead';
  sessionId: string;
  name: string;
  contact: string;
  priority: string;
  payload: Record<string, unknown>;
};

const runtimeDir = join(process.cwd(), '.runtime');
const sessionsPath = join(runtimeDir, 'sessions.json');
const leadsPath = join(runtimeDir, 'leads.json');

async function ensureRuntimeDir() {
  await mkdir(runtimeDir, {recursive: true});
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(filePath: string, value: T[]) {
  await ensureRuntimeDir();
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export async function upsertSessionLog(entry: SessionLog) {
  const current = await readJsonArray<SessionLog>(sessionsPath);
  const index = current.findIndex((item) => item.sessionId === entry.sessionId);
  if (index >= 0) {
    current[index] = entry;
  } else {
    current.unshift(entry);
  }
  await writeJsonArray(sessionsPath, current.slice(0, 500));
}

export async function appendLeadLog(entry: LeadLog) {
  const current = await readJsonArray<LeadLog>(leadsPath);
  current.unshift(entry);
  await writeJsonArray(leadsPath, current.slice(0, 1000));
}

export async function getSessionLogs(limit = 100) {
  const current = await readJsonArray<SessionLog>(sessionsPath);
  return current.slice(0, limit);
}

export async function getLeadLogs(limit = 100) {
  const current = await readJsonArray<LeadLog>(leadsPath);
  return current.slice(0, limit);
}
