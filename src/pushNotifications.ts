import { FieldValue } from "firebase-admin/firestore";
import type { SendResponse } from "firebase-admin/messaging";

import { db, messaging } from "./firebase";
import type { UserItem } from "./types";

type TokenRef = {
  userId: string;
  deviceId: string;
  token: string;
};

const PUSH_PAYLOAD_SCREEN_SHIPMENTS = "shipments";
const PUSH_PAYLOAD_SORT_NEW = "new";
const PUSH_PAYLOAD_FILTER_ACTIVE = "active";

export type PushSendStats = {
  recipients: number;
  sent: number;
};

export const buildLinkedUsersReverseMap = (users: UserItem[]) => {
  const reverseMap = new Map<string, string[]>();

  for (const user of users) {
    for (const linkedId of user.linkedUsersIds ?? []) {
      const parents = reverseMap.get(linkedId) ?? [];
      parents.push(user.id);
      reverseMap.set(linkedId, parents);
    }
  }

  return reverseMap;
};

export const resolveNotificationTargets = (
  newOrdersByOwner: Map<string, string[]>,
  linkedUsersReverseMap: Map<string, string[]>,
) => {
  const targets = new Map<string, string[]>();

  for (const [ownerId, codes] of newOrdersByOwner) {
    const recipientIds = new Set<string>([ownerId, ...(linkedUsersReverseMap.get(ownerId) ?? [])]);

    for (const recipientId of recipientIds) {
      const existing = targets.get(recipientId) ?? [];
      targets.set(recipientId, [...existing, ...codes]);
    }
  }

  for (const [recipientId, codes] of targets) {
    targets.set(recipientId, Array.from(new Set(codes)));
  }

  return targets;
};

const getPluralForm = (count: number, one: string, two: string, five: string) => {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return five;
  if (n1 > 1 && n1 < 5) return two;
  if (n1 === 1) return one;
  return five;
};

const buildNotificationBody = (count: number) => {
  if (count === 1) return "Ваш груз выехал";

  const text = getPluralForm(count, "новая отправка", "новые отправки", "новых отправок");
  return `Ваши грузы выехали: ${count} ${text}`;
};

const buildShipmentsPushData = (newOrdersCount: number) => {
  return {
    screen: PUSH_PAYLOAD_SCREEN_SHIPMENTS,
    sort: PUSH_PAYLOAD_SORT_NEW,
    filter: PUSH_PAYLOAD_FILTER_ACTIVE,
    newOrdersCount: String(newOrdersCount),
  };
};

const collectTokenRefs = (users: UserItem[], recipientIds: Iterable<string>) => {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const refs: TokenRef[] = [];

  for (const recipientId of recipientIds) {
    const user = usersById.get(recipientId);
    if (!user?.pushTokens) continue;

    for (const [deviceId, entry] of Object.entries(user.pushTokens)) {
      if (!entry?.token) continue;
      refs.push({ userId: recipientId, deviceId, token: entry.token });
    }
  }

  return refs;
};

const removeInvalidTokens = async (refs: TokenRef[], responses: SendResponse[]) => {
  const updates: Array<Promise<unknown>> = [];

  responses.forEach((response, index) => {
    const ref = refs[index];

    if (!response.success) {
      console.error("Push send failed:", {
        userId: ref?.userId,
        deviceId: ref?.deviceId,
        code: response.error?.code,
        message: response.error?.message,
      });
    }

    if (response.success) return;

    const errorCode = response.error?.code;
    if (
      errorCode !== "messaging/registration-token-not-registered" &&
      errorCode !== "messaging/invalid-registration-token"
    ) {
      return;
    }

    if (!ref) return;

    updates.push(
      db.collection("users").doc(ref.userId).update({
        [`pushTokens.${ref.deviceId}`]: FieldValue.delete(),
      }),
    );
  });

  if (updates.length > 0) {
    await Promise.allSettled(updates);
  }
};

export const sendNewOrdersPushNotifications = async (
  newOrdersByOwner: Map<string, string[]>,
  users: UserItem[],
): Promise<PushSendStats> => {
  if (newOrdersByOwner.size === 0) {
    return { recipients: 0, sent: 0 };
  }

  const linkedUsersReverseMap = buildLinkedUsersReverseMap(users);
  const targets = resolveNotificationTargets(newOrdersByOwner, linkedUsersReverseMap);

  if (targets.size === 0) {
    return { recipients: 0, sent: 0 };
  }

  let sent = 0;
  let recipientsWithTokens = 0;

  for (const [recipientId, codes] of targets) {
    const tokenRefs = collectTokenRefs(users, [recipientId]);
    if (tokenRefs.length === 0) continue;

    recipientsWithTokens += 1;

    const tokens = tokenRefs.map((ref) => ref.token);
    const count = codes.length;
    const title = "Eleven Cargo";
    const body = buildNotificationBody(count);

    console.log("Push send start:", {
      recipientId,
      deviceIds: tokenRefs.map((ref) => ref.deviceId),
      tokenCount: tokens.length,
      newOrdersCount: count,
    });

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title,
        body,
      },
      data: buildShipmentsPushData(count),
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            alert: {
              title,
              body,
            },
            sound: "default",
          },
        },
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
        },
      },
    });

    console.log("Push send result:", {
      recipientId,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });

    sent += response.successCount;
    await removeInvalidTokens(tokenRefs, response.responses);
  }

  return {
    recipients: recipientsWithTokens,
    sent,
  };
};
