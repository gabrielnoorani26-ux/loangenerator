/**
 * Output filename patterns.
 * Tokens: {original} {batch} {brand} {style} {color} {view} {index} {date} {width} {height}
 */
export const NAMING_TOKENS = [
  "original",
  "batch",
  "brand",
  "style",
  "color",
  "view",
  "index",
  "date",
  "width",
  "height",
] as const;

export interface NamingContext {
  originalFilename: string;
  batchName: string;
  brand: string;
  styleCode?: string | null;
  colorName?: string | null;
  viewAngle?: string | null;
  /** 1-based position in the batch */
  index: number;
  date: Date;
  width?: number | null;
  height?: number | null;
}

const MAX_BASE_LENGTH = 150;

/** Make a single path segment safe on Windows/macOS/Linux. */
export function sanitizeFilenamePart(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^A-Za-z0-9._-]+/g, "_") // anything else → underscore (incl. / \ : * ? " < > | and spaces)
    .replace(/_{2,}/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function stripExtension(filename: string): string {
  return filename.replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

/** Render a pattern to a sanitized base name (no extension). */
export function renderPattern(pattern: string, ctx: NamingContext): string {
  const values: Record<(typeof NAMING_TOKENS)[number], string> = {
    original: stripExtension(ctx.originalFilename),
    batch: ctx.batchName,
    brand: ctx.brand,
    style: ctx.styleCode ?? "",
    color: ctx.colorName ?? "",
    view: ctx.viewAngle ? ctx.viewAngle.toLowerCase() : "",
    index: String(ctx.index).padStart(3, "0"),
    date: yyyymmdd(ctx.date),
    width: ctx.width ? String(ctx.width) : "",
    height: ctx.height ? String(ctx.height) : "",
  };
  const rendered = pattern.replace(/\{([a-z]+)\}/g, (m, token: string) =>
    token in values ? sanitizeFilenamePart(values[token as keyof typeof values]) : m,
  );
  let base = sanitizeFilenamePart(rendered)
    .replace(/([_-])[_-]+/g, "$1") // collapse separators left by empty tokens
    .slice(0, MAX_BASE_LENGTH)
    .replace(/[._-]+$/g, "");
  // Reserved device names on Windows
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `${base}_`;
  return base || sanitizeFilenamePart(values.original) || `image_${values.index}`;
}

/**
 * Pick a filename not already in `taken` (case-insensitive) by appending _2, _3…
 * Adds the chosen name to `taken`.
 */
export function uniqueFilename(base: string, ext: string, taken: Set<string>): string {
  let name = `${base}.${ext}`;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base}_${n++}.${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

export function exampleFilename(
  pattern: string,
  ext: string,
  batchName = "Spring Drop",
  brand = "Chelsea Crew",
): string {
  return `${renderPattern(pattern, {
    originalFilename: "IMG_0042.jpg",
    batchName,
    brand,
    styleCode: "CC2045",
    colorName: "black",
    viewAngle: "SIDE",
    index: 1,
    date: new Date(),
    width: 2000,
    height: 2000,
  })}.${ext}`;
}
