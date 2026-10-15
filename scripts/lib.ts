import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { config as loadEnv } from "dotenv";

export const getArg = (argv: string[], name: string) => {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
};

export const connect = async (envFile?: string) => {
  if (envFile) {
    const envPath = path.resolve(envFile);
    if (!fs.existsSync(envPath)) throw new Error(`Env file not found: ${envPath}`);
    loadEnv({ path: envPath, override: true });
  }

  const { env } = await import("../src/config");
  const { db } = await import("../src/firebase");

  const projectId = env.FIREBASE_PROJECT_ID;
  if (!env.FIREBASE_CLIENT_EMAIL.endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
    throw new Error(`Service account ${env.FIREBASE_CLIENT_EMAIL} does not belong to project ${projectId}`);
  }

  return { db, projectId };
};

const WORKSPACE_ROOT = path.resolve(__dirname, "../..");

export const resolveOutsideWorkspace = (target: string) => {
  const resolved = path.resolve(target.replace(/^~(?=$|\/)/, os.homedir()));
  const relative = path.relative(WORKSPACE_ROOT, resolved);

  const isOutside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

  if (!isOutside) {
    throw new Error(`Backups contain personal data and margins — keep them outside ${WORKSPACE_ROOT}`);
  }

  return resolved;
};
