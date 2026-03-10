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

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
    range,
  });

  return (response.data.values ?? []).map((row) => row.map((cell) => String(cell)));
};
