/**
 * ZIP export planning (pure) + streaming (archiver). ZIPs are streamed from
 * storage — never built in memory — and split into parts of 100 images.
 */
import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import { sanitizeFilenamePart } from "./naming";
import type { StorageAdapter } from "./storage";

export const PART_SIZE = 100;

export type ExportScope = "approved" | "done" | "selected";
export type ExportGroup = "flat" | "style" | "view" | "color";

export interface ExportImage {
  id: string;
  status: string;
  sortOrder: number;
  originalKey: string;
  originalFilename: string;
  editedKey: string | null;
  outputFilename: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  outputSizeKb: number | null;
  styleCode: string | null;
  colorName: string | null;
  viewAngle: string | null;
  qcScore: number | null;
}

export interface ExportOptions {
  scope: ExportScope;
  ids?: string[];
  group: ExportGroup;
  originals: boolean;
  manifest: boolean;
}

export interface ZipEntry {
  path: string;
  key: string;
}

export function selectForExport(images: ExportImage[], scope: ExportScope, ids?: string[]): ExportImage[] {
  const idSet = new Set(ids ?? []);
  return images
    .filter((i) => i.editedKey && i.outputFilename)
    .filter((i) =>
      scope === "approved" ? i.status === "APPROVED" : scope === "done" ? i.status === "DONE" || i.status === "APPROVED" : idSet.has(i.id),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function partCount(n: number): number {
  return Math.max(1, Math.ceil(n / PART_SIZE));
}

function folderFor(img: ExportImage, group: ExportGroup): string {
  const raw = group === "style" ? img.styleCode : group === "view" ? img.viewAngle?.toLowerCase() : group === "color" ? img.colorName : null;
  if (group === "flat") return "";
  return sanitizeFilenamePart(raw ?? "") || "unassigned";
}

function uniquePath(path: string, taken: Set<string>): string {
  let p = path;
  let n = 2;
  const m = path.match(/^(.*?)(\.[A-Za-z0-9]+)?$/)!;
  while (taken.has(p.toLowerCase())) p = `${m[1]}_${n++}${m[2] ?? ""}`;
  taken.add(p.toLowerCase());
  return p;
}

const CSV_COLUMNS = [
  "output_filename",
  "original_filename",
  "style_code",
  "color",
  "view_angle",
  "width",
  "height",
  "size_kb",
  "qc_score",
  "status",
] as const;

export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Quote when needed; neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Plan the entries (and manifest rows) for one part. `part` is 1-based. */
export function planPart(selected: ExportImage[], opts: ExportOptions, part: number): { entries: ZipEntry[]; manifest: string | null } {
  const slice = selected.slice((part - 1) * PART_SIZE, part * PART_SIZE);
  const taken = new Set<string>();
  const entries: ZipEntry[] = [];
  const rows: string[] = [CSV_COLUMNS.join(",")];
  for (const img of slice) {
    const folder = folderFor(img, opts.group);
    const path = uniquePath(folder ? `${folder}/${img.outputFilename}` : img.outputFilename!, taken);
    entries.push({ path, key: img.editedKey! });
    if (opts.originals) {
      const orig = sanitizeFilenamePart(img.originalFilename) || `${img.id}.jpg`;
      entries.push({ path: uniquePath(`originals/${folder ? `${folder}/` : ""}${orig}`, taken), key: img.originalKey });
    }
    rows.push(
      [
        path.split("/").pop(),
        img.originalFilename,
        img.styleCode,
        img.colorName,
        img.viewAngle,
        img.outputWidth,
        img.outputHeight,
        img.outputSizeKb,
        img.qcScore,
        img.status.toLowerCase(),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return { entries, manifest: opts.manifest ? rows.join("\r\n") + "\r\n" : null };
}

/** Stream a ZIP of the given entries as a web ReadableStream. */
export function streamZip(entries: ZipEntry[], manifest: string | null, store: StorageAdapter): ReadableStream {
  const archive = new ZipArchive({ zlib: { level: 1 } }); // images are already compressed
  const out = new PassThrough();
  archive.on("warning", (err) => console.warn("[export] warning", err));
  archive.on("error", (err) => out.destroy(err));
  archive.pipe(out);
  (async () => {
    try {
      for (const e of entries) {
        if (!(await store.exists(e.key))) continue;
        archive.append(store.getStream(e.key), { name: e.path, store: true });
      }
      if (manifest) archive.append(manifest, { name: "manifest.csv" });
      await archive.finalize();
    } catch (err) {
      out.destroy(err as Error);
    }
  })();
  return Readable.toWeb(out) as ReadableStream;
}
