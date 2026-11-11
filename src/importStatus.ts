import { env } from "./config";

type ImportProblem = "import_failed" | "import_stale";

export type ImportStatus = {
  ok: boolean;
  problem?: ImportProblem;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

const startedAt = Date.now();
let lastSuccessAt: number | undefined;
let lastFailureAt: number | undefined;

export const recordImportSuccess = () => {
  lastSuccessAt = Date.now();
};

export const recordImportFailure = () => {
  lastFailureAt = Date.now();
};

const toISOString = (time: number | undefined) => {
  return time === undefined ? null : new Date(time).toISOString();
};

export const getImportStatus = (now = Date.now()): ImportStatus => {
  const times = {
    lastSuccessAt: toISOString(lastSuccessAt),
    lastFailureAt: toISOString(lastFailureAt),
  };

  const isLastImportFailed =
    lastFailureAt !== undefined && (lastSuccessAt === undefined || lastFailureAt > lastSuccessAt);

  if (isLastImportFailed) {
    return { ok: false, problem: "import_failed", ...times };
  }

  const maxAgeMs = env.IMPORT_MAX_AGE_HOURS * 60 * 60 * 1000;
  const isImportStale = env.CRON_ENABLED && now - (lastSuccessAt ?? startedAt) > maxAgeMs;

  if (isImportStale) {
    return { ok: false, problem: "import_stale", ...times };
  }

  return { ok: true, ...times };
};
