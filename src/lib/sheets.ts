import {google} from 'googleapis';
import type {LeadPayload} from '@/types/lead';

function getSheetsAuth() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return null;
  }

  const credentials = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
  };

  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

export async function appendLeadToSheet(lead: LeadPayload & {priority: string; intentScore: number}) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return {ok: false, skipped: true};
  }

  const auth = getSheetsAuth();
  if (!auth) {
    return {ok: false, skipped: true};
  }

  const sheets = google.sheets({version: 'v4', auth});
  const range = process.env.GOOGLE_SHEETS_RANGE ?? 'Leads!A:Z';
  const now = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        now,
        lead.locale,
        lead.name,
        lead.company ?? '',
        lead.serviceInterest,
        lead.budgetBand,
        lead.timeline,
        lead.contactChannel,
        lead.contactValue,
        lead.intentScore,
        lead.priority,
        lead.chatTranscriptId
      ]]
    }
  });

  return {ok: true};
}
