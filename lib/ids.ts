import { randomBytes } from "node:crypto";

/** Short, URL- and filesystem-safe unique id (used before a DB row exists). */
export function createId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}
