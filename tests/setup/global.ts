import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Fresh SQLite DB + storage dir for the test run. */
export default function setup() {
  const dir = path.resolve("tmp/test");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "storage"), { recursive: true });
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: `file:${path.join(dir, "test.db")}` },
    stdio: "ignore",
  });
}
