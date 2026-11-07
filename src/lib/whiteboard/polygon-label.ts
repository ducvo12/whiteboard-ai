import type { TLShape, TLShapePartial } from "tldraw";
import { labelFromObject, readAttachedLabel, type AttachedLabel } from "./attached-label.ts";
import { localBoardObject } from "./tldraw-board-model.ts";
import { labelPlacement } from "./label.ts";

/** Read old polygon labels at their rendered, previously clamped position. */
export function readShapeLabel(shape: TLShape) {
  const attached = readAttachedLabel(shape);
  if (attached || shape.type !== "board-object" || shape.meta.polygonLabelVersion === 1) return attached;
  const object = localBoardObject(shape.props);
  if (object.label === undefined) return null;
  const label = labelFromObject(object);
  const position = labelPlacement(object, label.text.trim());
  return { ...label, x: position.labelX, y: position.labelY };
}

export function withoutPolygonLabel(data: string) {
  const object = JSON.parse(data);
  for (const key of ["label", "labelX", "labelY", "labelFontSize", "labelColor", "labelBackground"]) delete object[key];
  return JSON.stringify(object);
}

export function attachedLabelUpdate(shape: TLShape, label: AttachedLabel | null): TLShapePartial {
  if (shape.type === "board-object") {
    return {
      id: shape.id, type: shape.type,
      meta: { ...shape.meta, attachedLabel: label, polygonLabelVersion: 1 },
      props: { data: withoutPolygonLabel(shape.props.data) },
    };
  }
  return { id: shape.id, type: shape.type, meta: { ...shape.meta, attachedLabel: label } };
}

export function polygonLabelMigration(shape: TLShape) {
  if (shape.type !== "board-object" || shape.meta.polygonLabelVersion === 1) return null;
  return attachedLabelUpdate(shape, readShapeLabel(shape));
}
