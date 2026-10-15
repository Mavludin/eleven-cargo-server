import { timingSafeEqual } from "node:crypto";

import bcrypt from "bcryptjs";

import { db } from "./firebase";

const CREDENTIALS_COLLECTION = "credentials";
const BCRYPT_ROUNDS = 10;

const credentialsRef = (userId: string) => {
  return db.collection(CREDENTIALS_COLLECTION).doc(userId);
};

const hashPassword = (password: string) => {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
};

export const getPasswordHash = async (userId: string) => {
  const passwordHash = (await credentialsRef(userId).get()).get("passwordHash");

  return typeof passwordHash === "string" ? passwordHash : undefined;
};

export const isPasswordMatchingHash = (password: string, passwordHash?: string) => {
  return passwordHash ? bcrypt.compare(password, passwordHash) : Promise.resolve(false);
};

export const toPlaintextPassword = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  return undefined;
};

export const isSameSecret = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
};

export const savePasswordHash = async (userId: string, password: string) => {
  await credentialsRef(userId).set({
    passwordHash: await hashPassword(password),
    updatedAt: new Date().toISOString(),
  });
};
