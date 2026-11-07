import type { BoardObjectSchemaType } from "./schemas";
import { objectBounds } from "./geometry.ts";
import type { TLDefaultColorStyle, TLDefaultSizeStyle, TLDefaultFillStyle, TLDefaultDashStyle, TLShape } from "tldraw";

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    "board-object": ExactBoardProps;
  }
}

export type ExactBoardShape = TLShape<"board-object">;
export type ExactBoardProps = {
  w: number;
  h: number;
  data: string;
  color: TLDefaultColorStyle;
  size: TLDefaultSizeStyle;
  fill: TLDefaultFillStyle;
  dash: TLDefaultDashStyle;
};

export function boardBounds(object: BoardObjectSchemaType) {
  return objectBounds(object);
}

export function boardProps(object: BoardObjectSchemaType): ExactBoardProps {
  const bounds = boardBounds(object);
  const data = { ...object } as BoardObjectSchemaType & { id?: string };
  delete data.id;
  return {
    color: "green", size: "s", fill: "solid", dash: "solid",
    w: Math.max(bounds.maxX - bounds.minX, 1),
    h: Math.max(bounds.maxY - bounds.minY, 1),
    data: JSON.stringify(data),
  };
}

export function boardPosition(object: BoardObjectSchemaType) {
  const bounds = boardBounds(object);
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const rotation = -object.rotation * Math.PI / 180;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = -(bounds.minY + bounds.maxY) / 2;
  // Board rotations use the center; native records rotate around their origin.
  return {
    x: cx - (w * Math.cos(rotation) - h * Math.sin(rotation)) / 2,
    y: cy - (w * Math.sin(rotation) + h * Math.cos(rotation)) / 2,
    rotation,
  };
}

/** Materialize resized geometry in local Y-up coordinates, with top-left at (0, 0). */
export function localBoardObject(props: ExactBoardProps): BoardObjectSchemaType {
  const object = JSON.parse(props.data) as BoardObjectSchemaType;
  const bounds = boardBounds(object);
  const sx = props.w / Math.max(bounds.maxX - bounds.minX, 1);
  const sy = props.h / Math.max(bounds.maxY - bounds.minY, 1);
  const point = (x: number, y: number) => ({ x: (x - bounds.minX) * sx, y: (y - bounds.maxY) * sy });
  const position = { ...point(object.x, object.y), rotation: 0 };
  if (object.object === "polygon") {
    return { ...object, ...position, points: object.points.map((p) => point(p.x, p.y)) };
  }
  if (object.object === "arrow") {
    const end = point(object.x2, object.y2);
    return { ...object, ...position, x2: end.x, y2: end.y };
  }
  if (object.object === "circle") return { ...object, ...position, r: object.r * sx };
  return { ...object, ...position, w: object.w * sx, h: object.h * sy };
}

export function exactShapeObject(props: ExactBoardProps, center: { x: number; y: number }, rotation: number): BoardObjectSchemaType {
  const local = localBoardObject(props);
  const dx = center.x - props.w / 2;
  const dy = -center.y + props.h / 2;
  const degrees = -rotation * 180 / Math.PI;
  const position = { x: local.x + dx, y: local.y + dy, rotation: ((degrees % 360 + 360) % 360) || 0 };
  if (local.object === "polygon") {
    return { ...local, ...position, points: local.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  if (local.object === "arrow") return { ...local, ...position, x2: local.x2 + dx, y2: local.y2 + dy };
  return { ...local, ...position };
}
