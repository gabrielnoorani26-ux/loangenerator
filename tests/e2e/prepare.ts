import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Fresh e2e database + storage. Runs before the e2e web server starts. */
function prepare() {
  const dir = path.resolve("tmp/e2e");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "storage"), { recursive: true });
  const env = {
    ...process.env,
    DATABASE_URL: `file:${path.join(dir, "e2e.db")}`,
    STORAGE_DIR: path.join(dir, "storage"),
  };
  execSync("npx prisma migrate deploy", { env, stdio: "ignore" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "ignore" });
}

prepare();
