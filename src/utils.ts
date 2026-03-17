import { isValid, parse } from "date-fns";

import {
  REQUIRED_ORDER_ITEM_KEYS,

  type ImportOrderItem,
  type OrderItem,
} from "./types";

const DATE_FORMATS = ["dd-MM-yyyy", "dd/MM/yyyy", "dd.MM.yyyy", "dd,MM,yyyy"] as const;
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

export const parseNumericField = (value: string) => {
  const formatted = value.trim().match(/[0-9,]/gm)?.join("").replaceAll(",", ".");

  if (formatted === undefined) return undefined;
  return Number.parseFloat(formatted);
};

export const parseDate = (dateISO: string) => {
  if (!dateISO) return null;

  for (const format of DATE_FORMATS) {
    const date = parse(dateISO.trim(), format, new Date());

    if (isValid(date)) {
      return date.toISOString();
    }
  }

  return null;
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
      volume: parseNumericField(order.Куб),
      price: parseNumericField(order.Цена),
      goods: parseNumericField(order.Страховка),
      percent: 1,
      insurance: parseNumericField(order["Сумма \nстраховки"]),
      package: parseNumericField(order["Наша упаковка"]),
      packageType: order["Вид упаковки"]?.trim(),
      offload: parseNumericField(order.перегруз),
      elevenRate: parseNumericField(order["Наш тариф"]),
      finalPrice: parseNumericField(order["Сумма/$"]),
    },
    hiddenInvoice: {
      density: parseNumericField(order.Плотность),
      transAmount: parseNumericField(order["Сумма/"]),
      orderIncome: parseNumericField(order["Прибыль с заказа"]),
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
