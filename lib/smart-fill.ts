/**
 * Smart fill: derive style code, color and view angle from filenames like
 * "CC2045_black_side.jpg" or "AR-1001-tan-suede-pair-02.png".
 */
export type ViewAngleValue = "SIDE" | "FRONT" | "BACK" | "TOP" | "SOLE" | "PAIR" | "DETAIL" | "LIFESTYLE" | "OTHER";

const VIEW_SYNONYMS: Record<string, ViewAngleValue> = {
  side: "SIDE",
  lateral: "SIDE",
  medial: "SIDE",
  profile: "SIDE",
  left: "SIDE",
  right: "SIDE",
  front: "FRONT",
  toe: "FRONT",
  back: "BACK",
  rear: "BACK",
  heel: "BACK",
  top: "TOP",
  overhead: "TOP",
  above: "TOP",
  sole: "SOLE",
  bottom: "SOLE",
  outsole: "SOLE",
  pair: "PAIR",
  both: "PAIR",
  detail: "DETAIL",
  closeup: "DETAIL",
  close: "DETAIL",
  macro: "DETAIL",
  lifestyle: "LIFESTYLE",
  model: "LIFESTYLE",
  onfoot: "LIFESTYLE",
  worn: "LIFESTYLE",
  other: "OTHER",
};

export interface SmartFillResult {
  styleCode: string | null;
  colorName: string | null;
  viewAngle: ViewAngleValue | null;
}

export function parseFilename(filename: string): SmartFillResult {
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{2,5}$/, "");
  const tokens = base
    .split(/[_\-\s.]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return { styleCode: null, colorName: null, viewAngle: null };

  let viewAngle: ViewAngleValue | null = null;
  let viewIdx = -1;
  // Prefer the last view-like token (views usually come after color).
  for (let i = tokens.length - 1; i >= 0; i--) {
    const v = VIEW_SYNONYMS[tokens[i].toLowerCase()];
    if (v) {
      viewAngle = v;
      viewIdx = i;
      break;
    }
  }

  // Style code: first token containing a digit (e.g. CC2045). If none, the first token.
  // A style can be split across two tokens like "AR-1001": letters-only prefix + number.
  let styleIdxs: number[] = [];
  const firstDigit = tokens.findIndex((t, i) => i !== viewIdx && /\d/.test(t));
  if (firstDigit === -1) {
    styleIdxs = viewIdx === 0 ? [] : [0];
  } else if (
    firstDigit === 1 &&
    /^[A-Za-z]{1,4}$/.test(tokens[0]) &&
    /^\d+[A-Za-z]?$/.test(tokens[1]) &&
    !VIEW_SYNONYMS[tokens[0].toLowerCase()]
  ) {
    styleIdxs = [0, 1];
  } else {
    styleIdxs = [firstDigit];
  }
  const styleCode = styleIdxs.length
    ? styleIdxs
        .map((i) => tokens[i])
        .join("-")
        .toUpperCase()
    : null;

  // Color: remaining tokens that are not purely numeric (sequence numbers like "02").
  const colorTokens = tokens.filter(
    (t, i) => i !== viewIdx && !styleIdxs.includes(i) && !/^\d+$/.test(t) && !/^(img|dsc|photo|copy|final)$/i.test(t),
  );
  const colorName = colorTokens.length ? colorTokens.map((t) => t.toLowerCase()).join(" ") : null;

  return { styleCode, colorName, viewAngle };
}
