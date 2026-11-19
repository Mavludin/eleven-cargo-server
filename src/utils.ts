import { isValid, parseISO } from "date-fns";

import {
  REQUIRED_ORDER_ITEM_KEYS,

  type ImportOrderItem,
  type OrderItem,
} from "./types";

const DATE_PATTERN = /^(\d{1,2})([-/.,])(\d{1,2})\2(\d{1,4})$/;
const DOT_DECIMAL_PATTERN = /^(?:\d*|\d{1,3}(?:,\d{3})+)\.\d+$/;
const NUMERIC_COLUMNS = new Set([
  "Вес",
  "Куб",
  "Плотность",
  "Сумма/",
  "Страховка",
  "Сумма \nстраховки",
  "Цена",
  "перегруз",
  "Наш тариф",
  "Сумма/$",
  "Прибыль с заказа",
]);

const sanitizeNumericValue = (value: string) => {
  return value.replace(/[^0-9,.\-]/g, "").trim();
};

export const parseNumericField = (value = "") => {
  const sign = value.trim().startsWith("-") ? -1 : 1;
  const formatted = value.replace(/[^0-9,.]/g, "");
  const normalized = DOT_DECIMAL_PATTERN.test(formatted)
    ? formatted.replaceAll(",", "")
    : formatted.replaceAll(".", "").replaceAll(",", ".");
  const amount = Number.parseFloat(normalized);

  return Number.isFinite(amount) ? sign * amount : undefined;
};

const parseNumericOrZero = (value?: string) => {
  return parseNumericField(value) ?? 0;
};

export const parseDate = (value: string) => {
  if (!value) return null;

  const parts = DATE_PATTERN.exec(value.trim());
  if (!parts) return null;

  const [, day, , month, year] = parts;
  if (Number(year) === 0) return null;

  const dateISO = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`;
  return isValid(parseISO(dateISO)) ? dateISO : null;
};

type Hash = {
  [key: string]: Hash | unknown;
};

export const parseObject = (data: Hash): Hash => {
  const sanitizedData: Hash = {};

  for (const key in data) {
    if (Object.prototype.toString.call(data[key]) === "[object Object]") {
      sanitizedData[key] = parseObject(data[key] as Hash);
    } else if (data[key] !== undefined && data[key] !== null) {
      sanitizedData[key] = typeof data[key] === "string" ? data[key].trim() : data[key];
    }
  }

  return sanitizedData;
};

export const isImportTableValid = (item: Record<string, string>) => {
  return REQUIRED_ORDER_ITEM_KEYS.every((key) => Object.hasOwn(item, key));
};

export const getMissingRequiredColumns = (item: Record<string, string>) => {
  return REQUIRED_ORDER_ITEM_KEYS.filter((key) => !Object.hasOwn(item, key));
};

export const generateOrderItem = (order: ImportOrderItem): Partial<OrderItem> => {
  return {
    code: order["Номер накладной"].trim(),
    paymentDate: parseDate(order["оплачено дата"]),
    arrivalDate: parseDate(order["Дата прибытия мск\""]),
    deliveryPeriod: order["Тип дороги"],
    invoice: {
      title: order.Наименование,
      weight: parseNumericField(order.Вес),
      volume: parseNumericOrZero(order.Куб),
      price: parseNumericField(order.Цена),
      goods: parseNumericField(order.Страховка),
      percent: 1,
      insurance: parseNumericOrZero(order["Сумма \nстраховки"]),
      package: parseNumericOrZero(order["Наша упаковка"]),
      packageType: order["Вид упаковки"]?.trim() || "",
      offload: parseNumericOrZero(order.перегруз),
      elevenRate: parseNumericOrZero(order["Наш тариф"]),
      finalPrice: parseNumericOrZero(order["Сумма/$"]),
    },
    hiddenInvoice: {
      density: parseNumericOrZero(order.Плотность),
      transAmount: parseNumericOrZero(order["Сумма/"]),
      orderIncome: parseNumericOrZero(order["Прибыль с заказа"]),
    },
  };
};

export const toImportOrderItems = (rows: string[][]): ImportOrderItem[] => {
  if (rows.length < 2) return [];

  const header = rows[0].map((cell) => cell ?? "");

  return rows.slice(1).reduce<ImportOrderItem[]>((acc, row) => {
    const item = header.reduce<Record<string, string>>((itemAcc, key, index) => {
      const rawValue = row[index] ?? "";
      itemAcc[key] = NUMERIC_COLUMNS.has(key) ? sanitizeNumericValue(rawValue) : rawValue;
      return itemAcc;
    }, {});

    const hasAnyValue = Object.values(item).some((value) => value.trim().length > 0);
    if (!hasAnyValue) return acc;

    acc.push(item as ImportOrderItem);
    return acc;
  }, []);
};
