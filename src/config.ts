import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const stripWrappingQuotes = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const normalizeBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;

  const normalized = stripWrappingQuotes(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off", ""].includes(normalized)) return false;

  return value;
}, z.boolean());

const normalizedProcessEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => {
    if (typeof value !== "string") return [key, value];
    return [key, stripWrappingQuotes(value)];
  }),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().min(1),
  FIREBASE_PRIVATE_KEY: z.string().min(1),

  GOOGLE_SPREADSHEET_ID: z.string().min(1),
  GOOGLE_SHEET_NAME: z.string().min(1).default("list1"),
  GOOGLE_SHEET_GID: z.string().min(1).optional(),
  CRON_ENABLED: normalizeBoolean.default(true),
  CRON_SCHEDULE: z.string().default("0 12,18 * * *"),
  CRON_TZ: z.string().default("Europe/Moscow"),
  CORS_ORIGIN: z.string().default("*"),

  ALERT_TELEGRAM_BOT_TOKEN: z.string().optional(),
  ALERT_TELEGRAM_CHAT_ID: z.string().optional(),
  JOB_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(normalizedProcessEnv);

if (!parsed.success) {
  throw new Error(`Invalid env: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
}

export const env = {
  ...parsed.data,
  CORS_ORIGIN: parsed.data.CORS_ORIGIN.replace(/\/+$/, ""),
  FIREBASE_PRIVATE_KEY: parsed.data.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n").replace(/\r/g, ""),
} as const;
