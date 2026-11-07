import {
  toRichText, createShapeId, getArrowBindings, getArrowTerminalsInArrowSpace,
  renderPlaintextFromRichText, type Editor, type TLDefaultColorStyle, type TLShape, type TLShapePartial,
} from "tldraw";
import { labelFields, labelFromObject, needsAttachedLabel } from "./attached-label.ts";
import { readShapeLabel, withoutPolygonLabel } from "./polygon-label.ts";
import { boardPosition, boardProps, exactShapeObject, localBoardObject, type ExactBoardProps } from "./tldraw-board-model.ts";
import { equalValues } from "./object-values.ts";
import type { BoardObjectSchemaType, StoredObjectSchemaType } from "./schemas";

export const colors: Record<TLDefaultColorStyle, string> = {
  white: "#ffffff", black: "#1d1d1d", grey: "#9fa8b2",
  "light-violet": "#e085f4", violet: "#ae3ec9",
  blue: "#4465e9", "light-blue": "#4ba1f1",
  yellow: "#f1ac4b", orange: "#e16919",
  green: "#099268", "light-green": "#4cb05e",
  "light-red": "#f87777", red: "#e03131",
};
export const widths = { s: 2, m: 3.5, l: 5, xl: 10 };
export const fonts = { s: 18, m: 24, l: 36, xl: 44 };

export function shapeId(id: string) {
  return id.startsWith("shape:") ? id as TLShape["id"] : createShapeId(id);
}

export function nearestColor(value: string): TLDefaultColorStyle {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return "black";
  const rgb = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const target = rgb(value);
  const distance = (hex: string) => rgb(hex).reduce((sum, channel, index) => sum + (channel - target[index]) ** 2, 0);
  let best: TLDefaultColorStyle = "black";
  let bestDistance = distance(colors.black);
  for (const key of Object.keys(colors) as TLDefaultColorStyle[]) {
    const candidate = distance(colors[key]);
    if (candidate < bestDistance) {
      best = key;
      bestDistance = candidate;
    }
  }
  return best;
}

export function nearestSize(value: number, sizes = widths): keyof typeof widths {
  return (Object.keys(sizes) as (keyof typeof widths)[]).reduce((a, b) =>
    Math.abs(sizes[a] - value) < Math.abs(sizes[b] - value) ? a : b,
  );
}

export function objectToShape(object: StoredObjectSchemaType): TLShapePartial {
  const position = boardPosition(object);
  const bounds = boardProps(object);
  const needsLabel = object.object === "polygon" ? object.label !== undefined : needsAttachedLabel(object);
  const attached = needsLabel ? labelFromObject(object) : null;
  const meta = { boardId: object.id, boardKind: object.object, attachedLabel: attached };
  const style = {
    color: nearestColor(object.strokeColor),
    size: nearestSize(object.strokeWidth),
    fill: object.fillColor === "transparent" || object.fillOpacity === 0 ? "none" as const : "solid" as const,
    dash: "solid" as const,
  };

  if (object.object === "polygon") {
    return {
      id: shapeId(object.id), type: "board-object", ...position,
      meta: { ...meta, polygonLabelVersion: 1 },
      props: { ...bounds, ...style, data: withoutPolygonLabel(bounds.data) },
    };
  }
  if (object.object === "arrow") {
    const local = localBoardObject(bounds);
    if (local.object !== "arrow") throw new Error("Expected arrow");
    return {
      id: shapeId(object.id), type: "arrow", ...position, meta,
      props: {
        ...style,
        start: { x: local.x, y: -local.y }, end: { x: local.x2, y: -local.y2 }, bend: 0,
        richText: toRichText(attached ? "" : object.label ?? ""),
        labelColor: nearestColor(object.labelColor ?? object.strokeColor), font: "sans",
      },
    };
  }
  return {
    id: shapeId(object.id), type: "geo", ...position, meta,
    props: {
      ...style,
      geo: object.object === "circle" ? "ellipse" : "rectangle",
      w: bounds.w, h: bounds.h, growY: 0,
      richText: toRichText(object.object === "textbox" ? object.text : attached ? "" : object.label ?? ""),
      font: "sans",
      labelColor: nearestColor(object.object === "textbox" ? object.textColor : object.labelColor ?? object.strokeColor),
      ...(object.object === "textbox" ? { size: nearestSize(object.fontSize, fonts) } : {}),
    },
  };
}

export function shapeToObject(editor: Editor, shape: TLShape): BoardObjectSchemaType | null {
  const object = nativeShapeToObject(editor, shape);
  const label = readShapeLabel(shape);
  return object && label ? { ...object, ...labelFields(label) } : object;
}

function nativeShapeToObject(editor: Editor, shape: TLShape): BoardObjectSchemaType | null {
  const transform = editor.getShapePageTransform(shape);
  if (shape.type === "board-object") {
    const center = transform.applyToPoint({ x: shape.props.w / 2, y: shape.props.h / 2 });
    return withPolygonStyles(exactShapeObject(shape.props, center, transform.rotation()), shape.props);
  }
  const rotation = -transform.rotation() * 180 / Math.PI;
  const base = { x: 0, y: 0, rotation, strokeColor: "#1d1d1d", fillColor: "transparent", strokeWidth: 2 };

  if (shape.type === "arrow") {
    if (shape.props.bend !== 0 || shape.props.kind !== "arc") return null;
    const { start, end } = getArrowTerminalsInArrowSpace(editor, shape, getArrowBindings(editor, shape));
    const center = transform.applyToPoint({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
    return {
      ...base, object: "arrow",
      x: center.x - (end.x - start.x) / 2, y: -center.y + (end.y - start.y) / 2,
      x2: center.x + (end.x - start.x) / 2, y2: -center.y - (end.y - start.y) / 2,
      strokeColor: colors[shape.props.color], strokeWidth: widths[shape.props.size] * shape.props.scale,
      label: renderPlaintextFromRichText(editor, shape.props.richText), labelColor: colors[shape.props.labelColor],
    };
  }
  if (shape.type === "text") {
    const bounds = editor.getShapeGeometry(shape).bounds;
    const center = transform.applyToPoint(bounds.center);
    const text = renderPlaintextFromRichText(editor, shape.props.richText);
    if (!text.trim()) return null;
    return {
      ...base, object: "textbox",
      x: center.x - bounds.w / 2, y: -center.y - bounds.h / 2, w: bounds.w, h: bounds.h,
      text, textColor: colors[shape.props.color], fontSize: fonts[shape.props.size] * shape.props.scale,
    };
  }
  if (shape.type !== "geo" || !["rectangle", "ellipse"].includes(shape.props.geo)) return null;
  const { w, h: rawH, growY, scale } = shape.props;
  const h = rawH + growY;
  if (shape.props.geo === "ellipse" && Math.abs(w - h) > 0.01) return null;
  const center = transform.applyToPoint({ x: w / 2, y: h / 2 });
  const text = renderPlaintextFromRichText(editor, shape.props.richText);
  const shared = {
    ...base,
    strokeColor: colors[shape.props.color], strokeWidth: widths[shape.props.size] * scale,
    fillColor: shape.props.fill === "none" ? "transparent" : colors[shape.props.color],
    fillOpacity: shape.props.fill === "none" ? 0 : 1,
    label: text, labelColor: colors[shape.props.labelColor],
  };
  if (shape.props.geo === "ellipse") return { ...shared, object: "circle", x: center.x, y: -center.y, r: w / 2 };
  const box = { ...shared, x: center.x - w / 2, y: -center.y - h / 2, w, h };
  if (shape.meta.boardKind === "textbox") {
    if (!text.trim()) return null;
    return {
      ...box, label: "", object: "textbox", text,
      textColor: colors[shape.props.labelColor], fontSize: fonts[shape.props.size] * scale,
    };
  }
  return { ...box, object: "rect" };
}

export function changedFields(before: BoardObjectSchemaType, after: BoardObjectSchemaType) {
  const old = before as unknown as Record<string, unknown>;
  const next = after as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(old), ...Object.keys(next)])];
  return Object.fromEntries(keys
    .filter((key) => key !== "object" && !equalValues(next[key], old[key]))
    .map((key) => [key, next[key]]));
}

export function assertCompatibleProjection(before: BoardObjectSchemaType, current: BoardObjectSchemaType | null) {
  if (!current || before.object !== current.object) {
    throw new Error("The shape changed type locally while the agent was editing it. Download your unsaved board before reloading.");
  }
}

export function polygonObject(props: ExactBoardProps) {
  const object = localBoardObject(props);
  if (object.object !== "polygon") throw new Error("Expected polygon data");
  return withPolygonStyles(object, props);
}

function withPolygonStyles<T extends BoardObjectSchemaType>(object: T, props: ExactBoardProps): T {
  return {
    ...object,
    strokeColor: colors[props.color], strokeWidth: widths[props.size],
    fillColor: props.fill === "none" ? "transparent" : colors[props.color],
    fillOpacity: props.fill === "semi" ? 0.25 : props.fill === "none" ? 0 : 1,
  };
}

/** Agent updates only replace native styles they explicitly changed. */
export function preserveNativeStyles(previous: BoardObjectSchemaType, next: BoardObjectSchemaType, incoming: Record<string, unknown>) {
  const changed = changedFields(previous, next);
  const props = { ...incoming };
  delete props.dash;
  delete props.font;
  if (!("strokeColor" in changed)) delete props.color;
  if (!("strokeWidth" in changed) && !("fontSize" in changed)) delete props.size;
  if (!("fillColor" in changed) && !("fillOpacity" in changed)) delete props.fill;
  if (!("labelColor" in changed) && !("textColor" in changed)) delete props.labelColor;
  if (!("label" in changed) && !("text" in changed)) delete props.richText;
  return props;
}

/** Duplicates inherit metadata, but must receive their own server identity. */
export function serverObjectId(shape: Pick<TLShape, "id" | "meta">) {
  return typeof shape.meta.boardId === "string" && shapeId(shape.meta.boardId) === shape.id ? shape.meta.boardId : shape.id;
}
