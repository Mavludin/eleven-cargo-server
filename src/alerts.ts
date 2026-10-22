import { env } from "./config";

const ALERT_TIMEOUT_MS = 15_000;

type AlertPayload = {
  title: string;
  description?: string;
};

export const sendAlert = async ({ title, description }: AlertPayload) => {
  const text = [title, description].filter(Boolean).join("\n");

  if (!env.ALERT_TELEGRAM_BOT_TOKEN || !env.ALERT_TELEGRAM_CHAT_ID) {
    console.error(`[ALERT] ${text}`);
    return;
  }

  const url = `https://api.telegram.org/bot${env.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.ALERT_TELEGRAM_CHAT_ID,
        text,
      }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[ALERT] Telegram responded ${response.status}: ${await response.text()}\n${text}`);
    }
  } catch (error) {
    console.error(`[ALERT] Telegram is unreachable, alert not sent:\n${text}`, error);
  }
};
