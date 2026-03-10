export const ORDER_ITEM_KEYS = [
  "КОД",
  "Тип дороги",
  "Номер накладной",
  "Вес",
  "Куб",
  "Плотность",
  "Сумма/",
  "Страховка",
  "Сумма ↵страховки",
  "Цена",
  "Наименование",
  "Наша упаковка",
  "Вид упаковки",
  "перегруз",
  "Наш тариф",
  "Сумма/$",
  "Прибыль с заказа",
  "Дата прибытия мск",
  "оплачено дата",
] as const;

export const REQUIRED_ORDER_ITEM_KEYS = ORDER_ITEM_KEYS.filter((key) => {
  return key !== "перегруз" && key !== "Вид упаковки";
});

type ImportOrderKey = (typeof ORDER_ITEM_KEYS)[number];
export type ImportOrderItem = Record<ImportOrderKey, string>;

export type UserItem = {
  id: string;
  code: string;
};

export type OrderItem = {
  id: string;
  userId: string;
  code: string;
  paymentDate: string | null;
  arrivalDate?: string | null;
  paymentStatus?: "wait" | "paid";
  deliveryPeriod: string;
  createdate?: string;
  invoice: {
    title: string;
    weight?: number;
    volume?: number;
    price?: number;
    percent?: number;
    goods?: number;
    insurance?: number;
    package?: number;
    packageType?: string;
    offload?: number;
    elevenRate?: number;
    finalPrice?: number;
  };
  hiddenInvoice: {
    density?: number;
    transAmount?: number;
    orderIncome?: number;
  };
};

export type ImportStats = {
  totalRows: number;
  validRows: number;
  created: number;
  updated: number;
  skippedMissingUsers: number;
  skippedEmptyRows: number;
};
