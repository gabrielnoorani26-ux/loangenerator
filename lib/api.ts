/**
 * Route-handler helpers: consistent JSON error shape {error: {code, message}},
 * zod validation, and a wrapper that turns thrown errors into responses.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);
export const badRequest = (message: string, code = "bad_request") => new ApiError(400, code, message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function zodMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input";
  const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue.message}`;
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap a route handler so all errors produce the standard JSON error shape. */
export function route<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message);
      if (err instanceof z.ZodError) return errorResponse(400, "validation_error", zodMessage(err));
      console.error("[api] unhandled error", err);
      return errorResponse(500, "internal_error", "Something went wrong. Please try again.");
    }
  };
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    const text = await req.text();
    json = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest("Request body must be valid JSON", "invalid_json");
  }
  return schema.parse(json);
}

export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const url = new URL(req.url);
  const obj: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  return schema.parse(obj);
}

export const ok = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);

export const IdParam = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const IdList = z.array(IdParam).min(1).max(1000);
