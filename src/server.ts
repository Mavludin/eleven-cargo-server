import Fastify from "fastify";
import cron from "node-cron";

import { sendAlert } from "./alerts";
import { env } from "./config";
import { runOrdersImport } from "./importOrders";

export const buildServer = () => {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  const executeImport = async (trigger: "cron" | "manual") => {
    try {
      app.log.info({ trigger }, "Orders import started");
      const stats = await runOrdersImport();
      app.log.info({ trigger, stats }, "Orders import completed");

      const exportedCount = stats.created + stats.updated;
      if (exportedCount > 0) {
        await sendAlert({
          title: "Успешная выгрузка Google Sheet -> Firestore",
          description: [
            `Триггер: ${trigger}`,
            `Выгружено: ${exportedCount}`,
            `Создано: ${stats.created}`,
            `Обновлено: ${stats.updated}`,
            `Пропущено (нет клиента): ${stats.skippedMissingUsers}`,
          ].join("\n"),
        });
      }

      return stats;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown import error";
      app.log.error({ trigger, err: error }, "Orders import failed");

      await sendAlert({
        title: "Ошибка импорта Google Sheet -> Firestore",
        description: [
          `Причина: ${message}`,
          `Spreadsheet: ${env.GOOGLE_SPREADSHEET_ID}`,
          `Лист: ${env.GOOGLE_SHEET_NAME}`,
        ].join("\n"),
      });

      throw error;
    }
  };

  app.get("/health", async () => ({ ok: true }));

  app.post("/jobs/import-orders/run", async (request, reply) => {
    const authHeader = request.headers["x-job-token"];
    if (env.JOB_TOKEN && authHeader !== env.JOB_TOKEN) {
      return reply.code(401).send({ message: "Unauthorized" });
    }

    const stats = await executeImport("manual");
    return { ok: true, stats };
  });

  cron.schedule(
    env.CRON_SCHEDULE,
    async () => {
      await executeImport("cron");
    },
    {
      timezone: env.CRON_TZ,
    },
  );

  return app;
};
