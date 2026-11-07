import { Mat, toRichText, type Editor, type TLTextShape } from "tldraw";
import {
  assertCompatibleProjection, changedFields, nearestColor, nearestSize, fonts,
  objectToShape, preserveNativeStyles, shapeId, shapeToObject,
} from "./tldraw-adapter.ts";
import { readAttachedLabel } from "./attached-label.ts";
import { boardPosition } from "./tldraw-board-model.ts";
import { equalValues } from "./object-values.ts";
import type { BoardObjectSchemaType, StoredObjectSchemaType } from "./schemas";

const GEOMETRY_FIELDS = ["x", "y", "w", "h", "r", "points", "x2", "y2", "rotation"];
const LABEL_FIELDS = ["label", "labelX", "labelY", "labelFontSize", "labelColor", "labelBackground"];

/** Translate agent field edits without replacing native records, groups, or styles. */
export function applyAgentObject(
  editor: Editor,
  object: StoredObjectSchemaType,
  previous?: StoredObjectSchemaType,
  nativeBefore?: BoardObjectSchemaType,
) {
  const id = shapeId(object.id);
  const existing = editor.getShape(id);
  if (!existing) {
    if (previous && nativeBefore) {
      throw new Error("The agent updated a shape that was deleted locally. Download your unsaved board before reloading.");
    }
    editor.createShape(objectToShape(object));
    return;
  }

  const current = shapeToObject(editor, existing);
  if (nativeBefore) assertCompatibleProjection(nativeBefore, current);
  const agentPatch = previous ? changedFields(previous, object) : { ...object };
  const localPatch = nativeBefore && current ? changedFields(nativeBefore, current) : {};
  for (const key of Object.keys(agentPatch)) {
    if (key in localPatch && !equalValues(localPatch[key], (agentPatch as Record<string, unknown>)[key])) {
      throw new Error("The same shape was edited locally and by the agent. Download your unsaved board before reloading.");
    }
  }

  const merged = { ...object, ...localPatch };
  const partial = objectToShape(merged);
  const geometryChanged = GEOMETRY_FIELDS.some((key) => key in agentPatch);
  const labelsChanged = LABEL_FIELDS.some((key) => key in agentPatch);
  const props = previous
    ? preserveNativeStyles(previous, object, partial.props as Record<string, unknown>)
    : { ...partial.props };
  if (!geometryChanged) {
    for (const key of ["w", "h", "growY", "start", "end", "bend"]) delete props[key];
  }
  const meta = {
    ...existing.meta,
    boardId: object.id,
    boardKind: object.object,
    ...(labelsChanged ? { attachedLabel: partial.meta?.attachedLabel ?? null } : {}),
  };

  if (existing.type === "text" && merged.object === "textbox") {
    // Preserve native text records, whose height is determined by their contents.
    const textProps: Partial<TLTextShape["props"]> = {};
    if ("text" in agentPatch) textProps.richText = toRichText(merged.text);
    if ("fontSize" in agentPatch) textProps.size = nearestSize(merged.fontSize / existing.props.scale, fonts);
    if ("textColor" in agentPatch) textProps.color = nearestColor(merged.textColor);
    if ("w" in agentPatch) {
      textProps.w = merged.w / existing.props.scale;
      textProps.autoSize = false;
    }
    editor.updateShape({ id, type: "text", props: textProps, meta });
    if (geometryChanged) {
      // tldraw's layout cache reads stored records, not hypothetical shape objects.
      const bounds = editor.getShapeGeometry(id).bounds;
      const position = boardPosition({ ...merged, w: bounds.w, h: bounds.h });
      const offset = Mat.Rotate(position.rotation).applyToPoint({ x: bounds.x, y: bounds.y });
      const parent = editor.getShapeParentTransform(existing);
      const point = Mat.From(Mat.Inverse(parent)).applyToPoint({ x: position.x - offset.x, y: position.y - offset.y });
      editor.updateShape({ id, type: "text", x: point.x, y: point.y, rotation: position.rotation - parent.rotation() });
    }
    return;
  }

  if (existing.type !== partial.type) {
    throw new Error("This agent edit cannot be applied to the current native shape. Download your unsaved board before reloading.");
  }
  const ownsNativeLabel = existing.type === "arrow" || (existing.type === "geo" && existing.meta.boardKind !== "textbox");
  if (labelsChanged && ownsNativeLabel) {
    const wasAttached = readAttachedLabel(existing);
    const attached = readAttachedLabel({ meta });
    if (attached && !wasAttached) props.richText = toRichText("");
    else if (wasAttached && !attached) props.richText = toRichText(merged.label ?? "");
  }

  if (geometryChanged) {
    const parent = editor.getShapeParentTransform(existing);
    const point = Mat.From(Mat.Inverse(parent)).applyToPoint({ x: partial.x!, y: partial.y! });
    partial.x = point.x;
    partial.y = point.y;
    partial.rotation = partial.rotation! - parent.rotation();
    if (existing.type === "arrow") editor.deleteBindings(editor.getBindingsFromShape(existing.id, "arrow"));
  } else {
    delete partial.x;
    delete partial.y;
    delete partial.rotation;
  }
  editor.updateShape({ ...partial, props, meta });
}
