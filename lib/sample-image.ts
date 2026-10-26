/** A synthetic product photo used for preset previews when no real image is at hand. */
import sharp from "sharp";
import { storage } from "./storage";

export function shoeSvg(w: number, h: number, color: string, bg: string | null, accent = "#d4d4d4"): string {
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

export const SAMPLE_KEY = "samples/sample-shoe.png";

export async function getSampleImage(): Promise<Buffer> {
  const store = storage();
  if (await store.exists(SAMPLE_KEY)) return store.get(SAMPLE_KEY);
  const buf = await sharp(Buffer.from(shoeSvg(1800, 1200, "#8b5a2b", "#e6e6e6")))
    .png()
    .toBuffer();
  await store.put(SAMPLE_KEY, buf);
  return buf;
}
