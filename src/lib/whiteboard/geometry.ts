import type { BoardObjectSchemaType } from "./schemas";

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Unrotated geometry bounds. Rotation is applied around this box's center. */
export function objectBounds(obj: BoardObjectSchemaType): Bounds {
  if (obj.object === "circle") {
    return {
      minX: obj.x - obj.r,
      minY: obj.y - obj.r,
      maxX: obj.x + obj.r,
      maxY: obj.y + obj.r,
    };
  }
  if (obj.object === "arrow") {
    const pad = 8;
    return {
      minX: Math.min(obj.x, obj.x2) - pad,
      minY: Math.min(obj.y, obj.y2) - pad,
      maxX: Math.max(obj.x, obj.x2) + pad,
      maxY: Math.max(obj.y, obj.y2) + pad,
    };
  }
  if (obj.object === "rect" || obj.object === "textbox") {
    return {
      minX: obj.x,
      minY: obj.y,
      maxX: obj.x + obj.w,
      maxY: obj.y + obj.h,
    };
  }
  const xs = obj.points.map((point) => point.x);
  const ys = obj.points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
