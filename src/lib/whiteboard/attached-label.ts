import type { BoardObjectSchemaType } from "./schemas";
import type { TLShape } from "tldraw";

export type AttachedLabel = {
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  background: string;
};

export function readAttachedLabel(shape: Pick<TLShape, "meta">): AttachedLabel | null {
  const value = shape.meta.attachedLabel as AttachedLabel | undefined;
  if (!value || typeof value.text !== "string" || ![value.x, value.y, value.size].every(Number.isFinite) ||
    value.size <= 0 || typeof value.color !== "string" || typeof value.background !== "string") return null;
  return value;
}

export function labelFromObject(object: BoardObjectSchemaType): AttachedLabel {
  return {
    text: object.label ?? "", x: object.labelX ?? 0.5, y: object.labelY ?? 0.5,
    size: object.labelFontSize ?? 14, color: object.labelColor ?? "#1f241c", background: object.labelBackground ?? "#fbfbf8",
  };
}

export function needsAttachedLabel(object: BoardObjectSchemaType) {
  if (object.object === "polygon") return false;
  if (object.object === "textbox") return !!object.label?.trim();
  return object.labelX !== undefined || object.labelY !== undefined ||
    object.labelFontSize !== undefined || object.labelBackground !== undefined;
}

export function labelFields(label: AttachedLabel) {
  return {
    label: label.text, labelX: label.x, labelY: label.y,
    labelFontSize: label.size, labelColor: label.color, labelBackground: label.background,
  };
}

type LabelBounds = { x: number; y: number; w: number; h: number };

export function labelPoint(bounds: LabelBounds, label: AttachedLabel) {
  return { x: bounds.x + bounds.w * label.x, y: bounds.y + bounds.h * (1 - label.y) };
}

export function labelFractions(bounds: LabelBounds, point: { x: number; y: number }) {
  return { x: (point.x - bounds.x) / Math.max(bounds.w, 1), y: 1 - (point.y - bounds.y) / Math.max(bounds.h, 1) };
}
