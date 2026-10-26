import { describe, expect, it } from "vitest";
import { csvCell, partCount, planPart, selectForExport, type ExportImage } from "@/lib/export";

const img = (i: number, o: Partial<ExportImage> = {}): ExportImage => ({
  id: `id${i}`,
  status: "APPROVED",
  sortOrder: i,
  originalKey: `o/${i}.jpg`,
  originalFilename: `IMG_${i}.jpg`,
  editedKey: `e/${i}.jpg`,
  outputFilename: `CC${i}_black_side.jpg`,
  outputWidth: 2000,
  outputHeight: 2000,
  outputSizeKb: 300,
  styleCode: `CC${i % 3}`,
  colorName: i % 2 ? "black" : "tan",
  viewAngle: "SIDE",
  qcScore: 90,
  ...o,
});

describe("export planning", () => {
  it("selects by scope", () => {
    const imgs = [img(1), img(2, { status: "DONE" }), img(3, { status: "REJECTED" }), img(4, { status: "FAILED", editedKey: null })];
    expect(selectForExport(imgs, "approved").map((i) => i.id)).toEqual(["id1"]);
    expect(selectForExport(imgs, "done").map((i) => i.id)).toEqual(["id1", "id2"]);
    expect(selectForExport(imgs, "selected", ["id3", "id4"]).map((i) => i.id)).toEqual(["id3"]);
  });
  it("splits into parts of 100", () => {
    expect(partCount(0)).toBe(1);
    expect(partCount(100)).toBe(1);
    expect(partCount(101)).toBe(2);
    const imgs = Array.from({ length: 150 }, (_, i) => img(i));
    expect(planPart(imgs, { scope: "approved", group: "flat", originals: false, manifest: false }, 2).entries).toHaveLength(50);
  });
  it("groups into folders and de-duplicates paths", () => {
    const imgs = [img(1, { outputFilename: "a.jpg", styleCode: "CC1" }), img(2, { outputFilename: "a.jpg", styleCode: "CC1" }), img(3, { styleCode: null })];
    const { entries } = planPart(imgs, { scope: "approved", group: "style", originals: false, manifest: false }, 1);
    expect(entries.map((e) => e.path)).toEqual(["CC1/a.jpg", "CC1/a_2.jpg", "unassigned/CC3_black_side.jpg"]);
  });
  it("includes originals and a manifest with the spec columns", () => {
    const { entries, manifest } = planPart([img(1)], { scope: "approved", group: "color", originals: true, manifest: true }, 1);
    expect(entries.map((e) => e.path)).toEqual(["black/CC1_black_side.jpg", "originals/black/IMG_1.jpg"]);
    const [header, row] = manifest!.trim().split("\r\n");
    expect(header).toBe("output_filename,original_filename,style_code,color,view_angle,width,height,size_kb,qc_score,status");
    expect(row).toBe("CC1_black_side.jpg,IMG_1.jpg,CC1,black,SIDE,2000,2000,300,90,approved");
  });
  it("escapes CSV and neutralizes formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(csvCell(null)).toBe("");
  });
});
