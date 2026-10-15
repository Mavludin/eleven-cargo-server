import type { DocumentSnapshot, QueryDocumentSnapshot } from "firebase-admin/firestore";

import { connect, getArg } from "./lib";

const FIRESTORE_BATCH_LIMIT = 500;
const GET_ALL_CHUNK_SIZE = 100;

type Mode = "dry-run" | "hash" | "remove-plaintext";

type UserState = {
  user: QueryDocumentSnapshot;
  credentials: DocumentSnapshot;
  plaintext?: string;
};

const parseArgs = (argv: string[]) => {
  const hash = argv.includes("--hash");
  const removePlaintext = argv.includes("--remove-plaintext");
  if (hash && removePlaintext) throw new Error("Use --hash and --remove-plaintext in separate runs");

  const mode: Mode = hash ? "hash" : removePlaintext ? "remove-plaintext" : "dry-run";

  return { env: getArg(argv, "env"), confirmProject: getArg(argv, "confirm-project"), mode };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const { db, projectId } = await connect(args.env);
  const { FieldValue } = await import("firebase-admin/firestore");
  const {
    credentialsRef,
    hashPassword,
    isPasswordMatchingHash,
    toPlaintextPassword,
  } = await import("../src/credentials");

  console.log(`Project: ${projectId} | mode: ${args.mode}`);

  const users = (await db.collection("users").get()).docs;
  const states: UserState[] = [];

  for (let i = 0; i < users.length; i += GET_ALL_CHUNK_SIZE) {
    const chunk = users.slice(i, i + GET_ALL_CHUNK_SIZE);
    const credentials = await db.getAll(...chunk.map((user) => credentialsRef(user.id)));

    chunk.forEach((user, index) => {
      states.push({ user, credentials: credentials[index], plaintext: toPlaintextPassword(user.get("password")) });
    });
  }

  const inSync: UserState[] = [];
  const needsHash: UserState[] = [];
  const hashOnly: UserState[] = [];
  const noPassword: UserState[] = [];

  for (const state of states) {
    const passwordHash = state.credentials.get("passwordHash");
    const hash = typeof passwordHash === "string" ? passwordHash : undefined;

    if (state.plaintext === undefined) {
      (hash ? hashOnly : noPassword).push(state);
    } else if (await isPasswordMatchingHash(state.plaintext, hash)) {
      inSync.push(state);
    } else {
      needsHash.push(state);
    }
  }

  console.table({
    "users total": states.length,
    "plaintext + matching hash (ready to remove plaintext)": inSync.length,
    "plaintext without matching hash (need --hash)": needsHash.length,
    "hash only (done)": hashOnly.length,
    "no password at all (cannot log in)": noPassword.length,
  });

  if (noPassword.length > 0) {
    console.log("No password, set one in the admin panel:", noPassword.map(({ user }) => user.get("code")).join(", "));
  }

  if (args.mode === "dry-run") {
    console.log(`Step 1: --hash --confirm-project=${projectId}`);
    console.log(`Step 2: --remove-plaintext --confirm-project=${projectId}  (after the admin panel sets passwords via the server)`);
    return;
  }

  if (args.confirmProject !== projectId) {
    throw new Error(`Refusing to write: pass --confirm-project=${projectId}`);
  }

  const targets = args.mode === "hash" ? needsHash : inSync;

  for (let i = 0; i < targets.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = db.batch();

    for (const { user, credentials, plaintext } of targets.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
      if (args.mode === "remove-plaintext") {
        batch.update(user.ref, { password: FieldValue.delete() }, { lastUpdateTime: user.updateTime });
        continue;
      }

      if (plaintext === undefined) continue;

      const data = { passwordHash: await hashPassword(plaintext), updatedAt: new Date().toISOString() };

      if (credentials.exists && credentials.updateTime) {
        batch.update(credentials.ref, data, { lastUpdateTime: credentials.updateTime });
      } else {
        batch.create(credentials.ref, data);
      }
    }

    try {
      await batch.commit();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Batch failed, data changed while the script was running? ${reason}. Run the same command again.`);
    }
  }

  console.log(`${args.mode === "hash" ? "Hashed" : "Plaintext removed"}: ${targets.length}`);

  if (args.mode === "remove-plaintext" && needsHash.length > 0) {
    console.log(`Skipped ${needsHash.length} users without a matching hash — run --hash, then --remove-plaintext again`);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
