/**
 * Generates sample product-photo fixtures (no real photos needed):
 *   npm run fixtures            → a handful of JPG/PNG/WEBP/transparent PNG files in /fixtures
 *   npm run fixtures -- 50 dir  → 50 JPGs in <dir> for load testing
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

function shoeSvg(w: number, h: number, color: string, bg: string | null, accent = "#d4d4d4"): string {
  const cx = w / 2;
  const cy = h * 0.58;
  const bgRect = bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    ${bgRect}
    <ellipse cx="${cx}" cy="${cy + h * 0.16}" rx="${w * 0.3}" ry="${h * 0.035}" fill="#000" fill-opacity="0.18"/>
    <path d="M ${cx - w * 0.3} ${cy + h * 0.12} L ${cx - w * 0.3} ${cy - h * 0.05} Q ${cx - w * 0.28} ${cy - h * 0.25} ${cx - w * 0.12} ${cy - h * 0.25}
             L ${cx - w * 0.05} ${cy - h * 0.25} Q ${cx + w * 0.02} ${cy - h * 0.05} ${cx + w * 0.2} ${cy - h * 0.02}
             Q ${cx + w * 0.32} ${cy} ${cx + w * 0.31} ${cy + h * 0.12} Z" fill="${color}"/>
    <rect x="${cx - w * 0.31}" y="${cy + h * 0.1}" width="${w * 0.63}" height="${h * 0.045}" rx="${h * 0.02}" fill="${accent}"/>
    <circle cx="${cx - w * 0.08}" cy="${cy - h * 0.12}" r="${h * 0.012}" fill="#c9a227"/>
    <circle cx="${cx - w * 0.02}" cy="${cy - h * 0.08}" r="${h * 0.012}" fill="#c9a227"/>
    <text x="${cx + w * 0.12}" y="${cy + h * 0.06}" font-family="DejaVu Sans" font-size="${h * 0.035}" fill="#fff">CC</text>
  </svg>`;
}

async function make(file: string, w: number, h: number, color: string, bg: string | null, fmt: "jpg" | "png" | "webp") {
  let img = sharp(Buffer.from(shoeSvg(w, h, color, bg)));
  img = fmt === "jpg" ? img.flatten({ background: "#ffffff" }).jpeg({ quality: 92 }) : fmt === "png" ? img.png() : img.webp({ quality: 90 });
  await img.toFile(file);
  console.log("wrote", file);
}

async function main() {
  const count = Number(process.argv[2] || 0);
  const outDir = path.resolve(process.argv[3] || "fixtures");
  fs.mkdirSync(outDir, { recursive: true });
  if (count > 0) {
    const colors = ["#111111", "#8b5a2b", "#7a1f1f", "#1f3a7a", "#2f5d3a"];
    const views = ["side", "front", "back", "top", "pair"];
    for (let i = 0; i < count; i++) {
      const name = `CC${2000 + Math.floor(i / 5)}_${["black", "tan", "burgundy", "navy", "olive"][i % 5]}_${views[i % 5]}.jpg`;
      await make(path.join(outDir, name), 1600, 1200, colors[i % 5], "#ececec", "jpg");
    }
    return;
  }
  await make(path.join(outDir, "CC2045_black_side.jpg"), 3000, 2000, "#151515", "#e9e9e9", "jpg");
  await make(path.join(outDir, "CC2045_black_front.jpg"), 2000, 2400, "#151515", "#f0eeea", "jpg");
  await make(path.join(outDir, "AR1001_tan_pair.png"), 1800, 1200, "#a0703c", "#dcdcdc", "png");
  await make(path.join(outDir, "CC3000_white_top_transparent.png"), 1500, 1500, "#f4f4f4", null, "png");
  await make(path.join(outDir, "AR2002-navy-sole.webp"), 1200, 900, "#1d2c5a", "#efefef", "webp");
  fs.writeFileSync(path.join(outDir, "not-an-image.jpg"), "this is plain text pretending to be a jpg");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
