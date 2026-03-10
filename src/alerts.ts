import { env } from "./config";

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
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.ALERT_TELEGRAM_CHAT_ID,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram alert failed: ${response.status} ${body}`);
  }
};
