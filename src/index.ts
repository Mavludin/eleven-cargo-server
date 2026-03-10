import { env } from "./config";
import { buildServer } from "./server";

const start = async () => {
  const app = buildServer();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(
      {
        port: env.PORT,
        cron: env.CRON_SCHEDULE,
        timezone: env.CRON_TZ,
        spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
        sheetName: env.GOOGLE_SHEET_NAME,
        gid: env.GOOGLE_SHEET_GID,
      },
      "Backend started",
    );
  } catch (error) {
    app.log.fatal({ err: error }, "Failed to start server");
    process.exit(1);
  }
};

void start();
