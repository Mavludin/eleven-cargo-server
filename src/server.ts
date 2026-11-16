import Fastify from "fastify";
import cors from "@fastify/cors";
import cron from "node-cron";

import { sendAlert } from "./alerts";
import { authRoutes } from "./auth";
import { env } from "./config";
import { runOrdersImport } from "./importOrders";
import { getImportStatus, recordImportFailure, recordImportSuccess } from "./importStatus";

const MAX_REPORTED_DUPLICATES = 50;

export const buildServer = () => {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    trustProxy: true,
  });

  app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
  });

  app.register(authRoutes);

  const executeImport = async (trigger: "cron" | "manual") => {
    try {
      app.log.info({ trigger }, "Orders import started");
      const stats = await runOrdersImport(trigger);
      recordImportSuccess();
      app.log.info({ trigger, stats }, "Orders import completed");

      const exportedCount = stats.created + stats.updated;
      const duplicateCount = stats.duplicateOrderCodes.length;
      if (exportedCount > 0 || duplicateCount > 0) {
        await sendAlert({
          title: "Успешная выгрузка Google Sheet -> Firestore",
          description: [
            `Триггер: ${trigger}`,
            `Выгружено: ${exportedCount}`,
            `Создано: ${stats.created}`,
            `Обновлено: ${stats.updated}`,
            `Пропущено (нет клиента): ${stats.skippedMissingUsers}`,
            `Пуши: ${stats.pushNotificationsSent} (${stats.pushRecipients} получателей)`,
            duplicateCount > 0 &&
              `Номера накладных повторяются в таблице (${duplicateCount}), выгружена только нижняя строка: ${stats.duplicateOrderCodes
                .slice(0, MAX_REPORTED_DUPLICATES)
                .join(", ")}${duplicateCount > MAX_REPORTED_DUPLICATES ? " и др." : ""}`,
          ]
            .filter(Boolean)
            .join("\n"),
        });
      }

      return stats;
    } catch (error) {
      recordImportFailure();
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
  app.get("/status", async (_request, reply) => {
    const status = getImportStatus();
    return reply.code(status.ok ? 200 : 503).send(status);
  });
  app.get("/", async () => ({ ok: true, service: "eleven-cargo-import" }));

  app.post("/jobs/import-orders/run", async (request, reply) => {
    const authHeader = request.headers["x-job-token"];
    if (env.JOB_TOKEN && authHeader !== env.JOB_TOKEN) {
      return reply.code(401).send({ message: "Unauthorized" });
    }

    const stats = await executeImport("manual");
    return { ok: true, stats };
  });

  if (env.CRON_ENABLED) {
    cron.schedule(
      env.CRON_SCHEDULE,
      async () => {
        await executeImport("cron");
      },
      {
        timezone: env.CRON_TZ,
      },
    );
  } else {
    app.log.warn("CRON disabled by CRON_ENABLED=false");
  }

  return app;
};
