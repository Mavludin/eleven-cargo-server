import rateLimit from "@fastify/rate-limit";
import admin from "firebase-admin";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { sendAlert } from "./alerts";
import { env } from "./config";
import {
  getPasswordHash,
  isPasswordMatchingHash,
  isSameSecret,
  setUserPassword,
  syncPasswordHash,
  toPlaintextPassword,
} from "./credentials";
import { db } from "./firebase";

const CODE_ATTEMPTS_LIMIT = 10;
const ATTEMPTS_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_CODES = 10_000;

const loginSchema = z.object({
  code: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

const setPasswordSchema = z.object({
  password: z.string().min(6).max(128),
});

const adminErrorSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  context: z.string().trim().max(3000).optional(),
  page: z.string().trim().max(500).optional(),
  userAgent: z.string().trim().max(500).optional(),
  online: z.boolean().optional(),
  occurredAt: z.string().trim().max(64).optional(),
});

const userParamsSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[^/]+$/),
});

const toText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  return "";
};

const failedAttemptsByCode = new Map<string, { count: number; resetAt: number }>();

const pruneAttempts = () => {
  if (failedAttemptsByCode.size < MAX_TRACKED_CODES) return;

  const now = Date.now();

  for (const [code, attempts] of failedAttemptsByCode) {
    if (now > attempts.resetAt) failedAttemptsByCode.delete(code);
  }

  const oldest = failedAttemptsByCode.keys().next();
  if (failedAttemptsByCode.size >= MAX_TRACKED_CODES && !oldest.done) {
    failedAttemptsByCode.delete(oldest.value);
  }
};

const isCodeLocked = (code: string) => {
  const attempts = failedAttemptsByCode.get(code);
  if (!attempts) return false;

  if (Date.now() > attempts.resetAt) {
    failedAttemptsByCode.delete(code);
    return false;
  }

  return attempts.count >= CODE_ATTEMPTS_LIMIT;
};

const registerFailedAttempt = (code: string) => {
  const attempts = failedAttemptsByCode.get(code);

  if (attempts && Date.now() <= attempts.resetAt) {
    attempts.count += 1;
    return;
  }

  pruneAttempts();
  failedAttemptsByCode.set(code, { count: 1, resetAt: Date.now() + ATTEMPTS_WINDOW_MS });
};

const verifyPassword = async (
  log: FastifyBaseLogger,
  userId: string,
  storedPassword: unknown,
  password: string,
) => {
  const passwordHash = await getPasswordHash(userId);
  const plaintextPassword = toPlaintextPassword(storedPassword);

  if (plaintextPassword !== undefined) {
    if (!isSameSecret(password, plaintextPassword)) return false;

    if (!(await isPasswordMatchingHash(password, passwordHash))) {
      await syncPasswordHash(userId, password).catch((error: unknown) => {
        log.error({ err: error, userId }, "Password hash was not synced");
      });
    }

    return true;
  }

  return isPasswordMatchingHash(password, passwordHash);
};

const getAdminToken = async (request: FastifyRequest) => {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;

  try {
    const token = await admin.auth().verifyIdToken(header.slice("Bearer ".length));
    if (env.ADMIN_UIDS.includes(token.uid)) return token;

    request.log.warn({ uid: token.uid }, "Token uid is not in ADMIN_UIDS");
  } catch (error) {
    request.log.warn({ err: error }, "Admin token verification failed");
  }

  return undefined;
};

const isUserNotFoundError = (error: unknown) => {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "auth/user-not-found";
};

export const authRoutes = async (app: FastifyInstance) => {
  await app.register(rateLimit, { global: false });

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 100, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid request" });
      }

      const { code, password } = parsed.data;

      if (isCodeLocked(code)) {
        return reply.code(429).send({ message: "Too many attempts" });
      }

      registerFailedAttempt(code);

      const snapshot = await db.collection("users").where("code", "==", code).limit(2).get();

      if (snapshot.size > 1) {
        request.log.error({ code }, "Several users share the same code");
      }

      const userDoc = snapshot.size === 1 ? snapshot.docs[0] : undefined;

      if (!userDoc || !(await verifyPassword(request.log, userDoc.id, userDoc.get("password"), password))) {
        request.log.warn({ code }, "Failed login attempt");

        return reply.code(401).send({ message: "Invalid credentials" });
      }

      failedAttemptsByCode.delete(code);

      const token = await admin.auth().createCustomToken(userDoc.id);

      return {
        token,
        user: {
          id: userDoc.id,
          code: toText(userDoc.get("code")) || code,
          email: toText(userDoc.get("email")),
          phone: toText(userDoc.get("phone")),
          firstname: toText(userDoc.get("firstname")),
          lastname: toText(userDoc.get("lastname")),
          middlename: toText(userDoc.get("middlename")),
          city: toText(userDoc.get("city")),
        },
      };
    },
  );

  app.post(
    "/admin/users/:id/password",
    { config: { rateLimit: { max: 60, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const adminUid = (await getAdminToken(request))?.uid;
      if (!adminUid) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const parsedParams = userParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ message: "Invalid user id" });
      }

      const parsed = setPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Password must be 6 to 128 characters" });
      }

      const userId = parsedParams.data.id;
      const userSnapshot = await db.collection("users").doc(userId).get();

      if (!userSnapshot.exists) {
        return reply.code(404).send({ message: "User not found" });
      }

      await setUserPassword(userId, parsed.data.password);

      try {
        await admin.auth().revokeRefreshTokens(userId);
      } catch (error) {
        if (!isUserNotFoundError(error)) {
          request.log.error({ err: error, userId }, "Password set, but sessions were not revoked");
        }
      }

      request.log.info({ userId, adminUid }, "Password set by admin");

      return { ok: true };
    },
  );

  app.post(
    "/admin/errors",
    { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const adminToken = await getAdminToken(request);
      if (!adminToken) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const parsed = adminErrorSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid error report" });
      }

      const report = parsed.data;
      const adminName = adminToken.email ?? adminToken.uid;

      request.log.warn({ adminUid: adminToken.uid, report }, "Admin panel error");

      void sendAlert({
        title: "Ошибка в админке",
        description: [
          `Админ: ${adminName}`,
          `Ошибка: ${report.message}`,
          report.context && `Подробности: ${report.context}`,
          report.online !== undefined && `Сеть в браузере: ${report.online ? "есть" : "нет"}`,
          report.page && `Страница: ${report.page}`,
          report.userAgent && `Браузер: ${report.userAgent}`,
          report.occurredAt && `Время: ${report.occurredAt}`,
        ]
          .filter(Boolean)
          .join("\n"),
      });

      return reply.code(202).send({ ok: true });
    },
  );
};
