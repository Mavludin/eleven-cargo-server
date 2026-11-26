import type { FastifyBaseLogger } from "fastify";

import { sendAlert } from "./alerts";
import { env } from "./config";
import { db } from "./firebase";

export const CNY_RATE_CRON_SCHEDULE = "0 9-21 * * *";

const FETCH_TIMEOUT_MS = 15_000;
const MISSING_RATE_ALERT_HOUR = 16;
const MIN_RATE = 5;
const MAX_RATE = 50;
const POST_ID_PATTERN = /^([\w]+)\/(\d+)"/;
const MESSAGE_TEXT_PATTERN = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const RATE_DATE_PATTERN = /(\d{2})\.(\d{2})\.(\d{4})/;
const FROM_1000_RATE_PATTERN = /от\s*1[.\s ]?000\s*¥\s*[-–—]\s*(\d{1,3}(?:[.,]\d{1,4})?)\s*₽/i;
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export type CnyRate = {
  rate: number;
  rateDate: string;
  postUrl: string;
};

type CnyRatePost = CnyRate & {
  postNumber: number;
};

export type CnyRateUpdateResult = {
  status: "updated" | "unchanged";
  rate: CnyRate;
};

const cnyRateDoc = () => db.collection("config").doc("cnyRate");

const decodeHtmlEntities = (text: string) => {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return HTML_ENTITIES[code.toLowerCase()] ?? entity;
  });
};

const toPlainText = (html: string) => {
  return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));
};

const toRateDate = (day: string, month: string, year: string) => {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isValidDate =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);

  return isValidDate ? `${year}-${month}-${day}` : undefined;
};

const parsePost = (chunk: string): CnyRatePost | undefined => {
  const postId = POST_ID_PATTERN.exec(chunk);
  const messageHtml = MESSAGE_TEXT_PATTERN.exec(chunk)?.[1];
  if (!postId || messageHtml === undefined) return undefined;

  const text = toPlainText(messageHtml);
  const dateParts = RATE_DATE_PATTERN.exec(text);
  const rateText = FROM_1000_RATE_PATTERN.exec(text)?.[1];
  if (!dateParts || !rateText) return undefined;

  const rateDate = toRateDate(dateParts[1], dateParts[2], dateParts[3]);
  if (!rateDate) return undefined;

  const [, channel, postNumber] = postId;

  return {
    rate: Number(rateText.replace(",", ".")),
    rateDate,
    postUrl: `https://t.me/${channel}/${postNumber}`,
    postNumber: Number(postNumber),
  };
};

const isNewerPost = (post: CnyRatePost, other: CnyRatePost) => {
  if (post.rateDate !== other.rateDate) return post.rateDate > other.rateDate;
  return post.postNumber > other.postNumber;
};

export const findLatestCnyRate = (html: string): CnyRate | undefined => {
  const latest = html
    .split('data-post="')
    .slice(1)
    .map(parsePost)
    .reduce<CnyRatePost | undefined>((newest, post) => {
      if (!post) return newest;
      return !newest || isNewerPost(post, newest) ? post : newest;
    }, undefined);

  if (!latest) return undefined;

  return { rate: latest.rate, rateDate: latest.rateDate, postUrl: latest.postUrl };
};

const getMoscowDate = (date = new Date()) => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.CRON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const getMoscowHour = (date = new Date()) => {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: env.CRON_TZ, hour: "2-digit", hourCycle: "h23" }).format(date),
  );
};

const validateRate = (rate: CnyRate) => {
  if (!Number.isFinite(rate.rate) || rate.rate < MIN_RATE || rate.rate > MAX_RATE) {
    throw new Error(`Курс ${rate.rate} ₽ вне допустимого диапазона ${MIN_RATE}–${MAX_RATE} ₽ (${rate.postUrl})`);
  }

  if (rate.rateDate > getMoscowDate()) {
    throw new Error(`Дата курса ${rate.rateDate} в будущем (${rate.postUrl})`);
  }
};

const fetchChannelHtml = async (sourceUrl: string) => {
  const response = await fetch(sourceUrl, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; eleven-cargo-rate/1.0)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Лента канала ответила ${response.status}`);
  }

  return response.text();
};

const readStoredRate = async (): Promise<CnyRate | undefined> => {
  const snapshot = await cnyRateDoc().get();
  const rate: unknown = snapshot.get("rate");
  const rateDate: unknown = snapshot.get("rateDate");
  const postUrl: unknown = snapshot.get("postUrl");

  if (typeof rate !== "number" || typeof rateDate !== "string" || typeof postUrl !== "string") {
    return undefined;
  }

  return { rate, rateDate, postUrl };
};

const isSameRate = (a: CnyRate, b: CnyRate) => {
  return a.rate === b.rate && a.rateDate === b.rateDate && a.postUrl === b.postUrl;
};

export const updateCnyRate = async (): Promise<CnyRateUpdateResult> => {
  if (!env.CNY_RATE_SOURCE_URL) {
    throw new Error("Не задан адрес ленты канала (CNY_RATE_SOURCE_URL)");
  }

  const latest = findLatestCnyRate(await fetchChannelHtml(env.CNY_RATE_SOURCE_URL));
  if (!latest) {
    throw new Error("В ленте канала не найден пост с датой и курсом «от 1 000 ¥»");
  }

  validateRate(latest);

  const stored = await readStoredRate();
  if (stored && (stored.rateDate > latest.rateDate || isSameRate(stored, latest))) {
    return { status: "unchanged", rate: stored };
  }

  await cnyRateDoc().set({ ...latest, updatedAt: new Date().toISOString() });
  return { status: "updated", rate: latest };
};

let lastMissingRateAlertDate: string | undefined;

export const runScheduledCnyRateUpdate = async (log: FastifyBaseLogger) => {
  const today = getMoscowDate();
  let rateDate: string | undefined;
  let failureReason: string | undefined;

  try {
    const result = await updateCnyRate();
    rateDate = result.rate.rateDate;
    log.info({ result }, "CNY rate update completed");
  } catch (error) {
    failureReason = error instanceof Error ? error.message : "Unknown CNY rate error";
    log.error({ err: error }, "CNY rate update failed");
  }

  const isAlertDue = getMoscowHour() >= MISSING_RATE_ALERT_HOUR && rateDate !== today;
  if (!isAlertDue || lastMissingRateAlertDate === today) return;

  lastMissingRateAlertDate = today;
  await sendAlert({
    title: "Курс юаня за сегодня не обновлён",
    description: [
      failureReason ? `Причина: ${failureReason}` : `Последний курс в ленте: ${rateDate ?? "нет"}`,
      `Лента: ${env.CNY_RATE_SOURCE_URL ?? "не задана"}`,
    ].join("\n"),
  });
};
