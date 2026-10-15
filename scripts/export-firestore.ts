import fs from "node:fs";
import path from "node:path";

import { connect, getArg, resolveOutsideWorkspace } from "./lib";

const COLLECTIONS = ["orders", "users", "credentials", "screens", "config"];

const OMITTED_FIELDS: Record<string, string[]> = {
  users: ["password"],
};

const omitFields = (data: Record<string, unknown>, fields: string[] = []) => {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !fields.includes(key)));
};

const main = async () => {
  const argv = process.argv.slice(2);
  const out = getArg(argv, "out");
  if (!out) throw new Error("Pass --out=<directory outside the repos>, e.g. --out=~/eleven-cargo-backups");

  const { db, projectId } = await connect(getArg(argv, "env"));

  const dir = path.join(
    resolveOutsideWorkspace(out),
    `${projectId}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  fs.mkdirSync(dir, { recursive: true });

  for (const name of COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    const docs = snapshot.docs.map((doc) => ({
      id: doc.id,
      createTime: doc.createTime.toDate().toISOString(),
      updateTime: doc.updateTime.toDate().toISOString(),
      data: omitFields(doc.data(), OMITTED_FIELDS[name]),
    }));

    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(docs, null, 2));
    console.log(`${name}: ${docs.length}`);
  }

  console.log(`Exported ${projectId} to ${dir}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
