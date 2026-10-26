import path from "node:path";

const dir = path.resolve("tmp/test");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.STORAGE_DIR = path.join(dir, "storage");
process.env.IMAGE_PROVIDER = "mock";
process.env.MOCK_FAIL_RATE = "0";
process.env.MOCK_DELAY_MS = "0-0";
process.env.ANTHROPIC_API_KEY = "";
process.env.BG_REMOVAL_PROVIDER = "";
