import { db } from "./firebase";
import { fetchSheetRows } from "./googleSheets";
import {
  getMissingRequiredColumns,
  generateOrderItem,
  isImportTableValid,
  parseObject,
  toImportOrderItems,
} from "./utils";
import type { ImportOrderItem, ImportStats, OrderItem, UserItem } from "./types";

const FIRESTORE_BATCH_LIMIT = 500;
const FIRESTORE_IN_LIMIT = 30;

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

const getUsersMap = async () => {
  const snapshot = await db.collection("users").get();
  const users = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as UserItem[];

  return users.reduce<Record<string, UserItem | undefined>>((acc, user) => {
    acc[user.code] = user;
    return acc;
  }, {});
};

const getOrdersMapByCodes = async (codes: string[]) => {
  const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
  const result: Record<string, OrderItem | undefined> = {};

  if (uniqueCodes.length === 0) return result;

  const ordersCollection = db.collection("orders");

  for (const chunk of chunkArray(uniqueCodes, FIRESTORE_IN_LIMIT)) {
    const snapshot = await ordersCollection.where("code", "in", chunk).get();

    for (const doc of snapshot.docs) {
      const order = { id: doc.id, ...doc.data() } as OrderItem;
      result[order.code] = order;
    }
  }

  return result;
};

const isSameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
};

const hasMeaningfulChanges = (
  patch: Partial<OrderItem>,
  existing: OrderItem,
): boolean => {
  for (const key of Object.keys(patch) as (keyof OrderItem)[]) {
    if (!isSameValue(patch[key], existing[key])) {
      return true;
    }
  }
  return false;
};

type PendingCreate = {
  type: "create";
  code: string;
  data: Record<string, unknown>;
};

type PendingUpdate = {
  type: "update";
  id: string;
  data: Record<string, unknown>;
};

type PendingWrite = PendingCreate | PendingUpdate;

const flushBatches = async (writes: PendingWrite[]) => {
  for (let i = 0; i < writes.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = writes.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = db.batch();

    for (const write of chunk) {
      if (write.type === "create") {
        const ref = db.collection("orders").doc();
        batch.set(ref, write.data);
      } else {
        const ref = db.collection("orders").doc(write.id);
        batch.set(ref, write.data, { merge: true });
      }
    }

    await batch.commit();
  }
};

export const runOrdersImport = async (): Promise<ImportStats> => {
  const sheetRows = await fetchSheetRows();
  const importItems = toImportOrderItems(sheetRows);

  if (importItems.length === 0) {
    throw new Error("Таблица пустая или содержит некорректный формат");
  }

  const isTableValid = isImportTableValid(importItems[0]);
  if (!isTableValid) {
    const missingColumns = getMissingRequiredColumns(importItems[0]);
    const missingColumnsText =
      missingColumns.length > 0 ? missingColumns.join(", ") : "Не удалось определить";

    throw new Error(
      `Проверьте наличие всех обязательных столбцов. Отсутствуют: ${missingColumnsText}`,
    );
  }

  const usersMap = await getUsersMap();

  const orderCodes = importItems
    .map((item) => item["Номер накладной"]?.trim())
    .filter((code): code is string => Boolean(code));

  const ordersMap = await getOrdersMapByCodes(orderCodes);

  const stats: ImportStats = {
    totalRows: sheetRows.length,
    validRows: importItems.length,
    created: 0,
    updated: 0,
    skippedMissingUsers: 0,
    skippedEmptyRows: Math.max(0, sheetRows.length - importItems.length - 1),
  };

  const pendingWrites: PendingWrite[] = [];

  for (const item of importItems) {
    const user = usersMap[item["КОД"]];
    if (!user) {
      stats.skippedMissingUsers += 1;
      continue;
    }

    const parsedOrder = parseObject(generateOrderItem(item)) as Partial<OrderItem>;
    const orderCode = item["Номер накладной"].trim();
    const existingOrder = ordersMap[orderCode];

    if (!existingOrder) {
      const data = {
        ...parsedOrder,
        code: orderCode,
        userId: user.id,
        createdate: new Date().toISOString(),
      };

      pendingWrites.push({ type: "create", code: orderCode, data });
      stats.created += 1;
      continue;
    }

    const patch: Partial<OrderItem> = { ...parsedOrder, userId: user.id };
    if (!hasMeaningfulChanges(patch, existingOrder)) {
      continue;
    }

    pendingWrites.push({ type: "update", id: existingOrder.id, data: patch });
    stats.updated += 1;
  }

  await flushBatches(pendingWrites);

  return stats;
};
