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

const getUsersMap = async () => {
  const snapshot = await db.collection("users").get();
  const users = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as UserItem[];

  return users.reduce<Record<string, UserItem | undefined>>((acc, user) => {
    acc[user.code] = user;
    return acc;
  }, {});
};

const getOrdersMap = async () => {
  const snapshot = await db.collection("orders").get();
  const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as OrderItem[];

  return orders.reduce<Record<string, OrderItem | undefined>>((acc, order) => {
    acc[order.code] = order;
    return acc;
  }, {});
};

const createOrUpdateOrder = async (
  item: ImportOrderItem,
  usersMap: Record<string, UserItem | undefined>,
  ordersMap: Record<string, OrderItem | undefined>,
) => {
  const user = usersMap[item["КОД"]];
  if (!user) return { created: 0, updated: 0, skippedMissingUsers: 1 };

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

    const createdRef = await db.collection("orders").add(data);
    ordersMap[orderCode] = { ...(data as OrderItem), id: createdRef.id };

    return { created: 1, updated: 0, skippedMissingUsers: 0 };
  }

  const data = {
    ...existingOrder,
    ...parsedOrder,
    userId: user.id,
  };

  await db.collection("orders").doc(existingOrder.id).set(data, { merge: true });
  ordersMap[orderCode] = { ...(data as OrderItem), id: existingOrder.id };

  return { created: 0, updated: 1, skippedMissingUsers: 0 };
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
  const ordersMap = await getOrdersMap();

  const stats: ImportStats = {
    totalRows: sheetRows.length,
    validRows: importItems.length,
    created: 0,
    updated: 0,
    skippedMissingUsers: 0,
    skippedEmptyRows: Math.max(0, sheetRows.length - importItems.length - 1),
  };

  for (const item of importItems) {
    const result = await createOrUpdateOrder(item, usersMap, ordersMap);
    stats.created += result.created;
    stats.updated += result.updated;
    stats.skippedMissingUsers += result.skippedMissingUsers;
  }

  return stats;
};
