import { objectBounds } from "./geometry.ts";
import type { BoardObjectSchemaType } from "./schemas";

export const LABEL_FONT = 14;
export const LABEL_COLOR = "#1f241c";
export const LABEL_BACKGROUND = "#fbfbf8";

let measure: CanvasRenderingContext2D | null | undefined;

function measureWidth(text: string, fontSize: number) {
  if (measure === undefined && typeof document !== "undefined") {
    measure = document.createElement("canvas").getContext("2d");
  }
  if (measure) {
    measure.font = `${fontSize}px Helvetica, Arial, sans-serif`;
    return measure.measureText(text).width;
  }
  return text.length * fontSize * 0.56;
}

export function labelMetrics(text: string, fontSize = LABEL_FONT) {
  return { w: Math.max(measureWidth(text, fontSize), 1), h: fontSize };
}

/** Preserve the old clamped position only when migrating legacy polygon labels. */
export function labelPlacement(obj: BoardObjectSchemaType, text: string) {
  const bounds = objectBounds(obj);
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const fontSize = obj.labelFontSize != null && obj.labelFontSize > 0 ? obj.labelFontSize : LABEL_FONT;
  const size = labelMetrics(text, fontSize);
  let cx = bounds.minX + (obj.labelX ?? 0.5) * spanX;
  let cy = bounds.minY + (obj.labelY ?? 0.5) * spanY;
  cx = Math.min(bounds.maxX + size.w / 2, Math.max(bounds.minX - size.w / 2, cx));
  cy = Math.min(bounds.maxY + size.h / 2, Math.max(bounds.minY - size.h / 2, cy));
  return {
    cx,
    cy,
    w: size.w,
    h: size.h,
    labelX: (cx - bounds.minX) / spanX,
    labelY: (cy - bounds.minY) / spanY,
  };
}

/** Current labels may sit anywhere in the parent's local coordinate system. */
export function labelLayout(object: BoardObjectSchemaType, text: string) {
  const bounds = objectBounds(object);
  const fontSize = object.labelFontSize ?? LABEL_FONT;
  const lines = text.split("\n");
  const lineHeight = fontSize * 1.2;
  return {
    cx: bounds.minX + (object.labelX ?? 0.5) * (bounds.maxX - bounds.minX),
    cy: bounds.minY + (object.labelY ?? 0.5) * (bounds.maxY - bounds.minY),
    w: Math.max(...lines.map((line) => labelMetrics(line, fontSize).w)) + 12,
    h: lines.length * lineHeight + 6,
    fontSize,
    lineHeight,
    lines,
  };
}
