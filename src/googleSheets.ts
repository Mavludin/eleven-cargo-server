import { google } from "googleapis";

import { env } from "./config";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: env.FIREBASE_CLIENT_EMAIL,
    private_key: env.FIREBASE_PRIVATE_KEY,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

export const fetchSheetRows = async () => {
  const range = `${env.GOOGLE_SHEET_NAME}!A:ZZ`;

  const maxAttempts = 4;
  const delaysMs = [0, 30_000, 60_000, 120_000];

  let lastError: unknown = undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (delaysMs[attempt - 1] > 0) {
      await new Promise((r) => setTimeout(r, delaysMs[attempt - 1]));
    }

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
        range,
      });

      return (response.data.values ?? []).map((row) => row.map((cell) => String(cell)));
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      // Sometimes Google API activation propagation takes a few minutes.
      // Retry only for the "service disabled / accessNotConfigured" cases.
      const shouldRetry =
        message.includes("SERVICE_DISABLED") ||
        message.includes("accessNotConfigured") ||
        message.includes("Google Sheets API has not been used") ||
        (message.includes("disabled") && message.includes("sheets.googleapis.com"));

      if (!shouldRetry || attempt === maxAttempts) {
        break;
      }
    }
  }

  throw lastError;
};
