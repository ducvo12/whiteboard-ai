"use client";

import { Mat, useEditor, useValue } from "tldraw";
import { AttachedLabels, LabelOptions } from "./attached-labels";
import { useBoardPreferences } from "./board-preferences";
import { BoardObjectSchema } from "@/lib/whiteboard/schemas";
import { objectToShape, serverObjectId, shapeToObject } from "@/lib/whiteboard/tldraw-adapter";

export function BoardControls() {
  const editor = useEditor();
  const { axes } = useBoardPreferences();
  const state = useValue("board controls", () => {
    const shape = editor.getOnlySelectedShape();
    return {
      shape,
      object: shape?.type === "board-object" ? shapeToObject(editor, shape) : null,
      view: editor.getViewportPageBounds(),
      zoom: editor.getCamera().z,
      pointer: editor.inputs.getCurrentPagePoint(),
      readonly: editor.getIsReadonly(),
    };
  }, [editor]);
  const { object, shape, view, zoom } = state;
  const locked = state.readonly || !!shape && editor.isShapeOrAncestorLocked(shape);

  function patch(values: Record<string, unknown>) {
    if (!object || shape?.type !== "board-object" || locked) return;
    const parsed = BoardObjectSchema.safeParse({ ...object, ...values });
    if (!parsed.success) return;
    const update = objectToShape({ ...parsed.data, id: serverObjectId(shape) });
    if (update.type !== "board-object") return;
    const parent = editor.getShapeParentTransform(shape);
    const point = Mat.From(Mat.Inverse(parent)).applyToPoint({ x: update.x!, y: update.y! });
    editor.markHistoryStoppingPoint("Edit board properties");
    editor.updateShape({
      ...update,
      x: point.x,
      y: point.y,
      rotation: update.rotation! - parent.rotation(),
      props: { ...update.props, color: shape.props.color, size: shape.props.size, fill: shape.props.fill, dash: shape.props.dash },
    });
  }

  const originX = -view.x * zoom;
  const originY = -view.y * zoom;
  return <>
    <AttachedLabels />
    {shape && <LabelOptions shape={shape}>
      {object?.object === "polygon" && <>
        <p>Drag the vertex handles to reshape the polygon.</p>
        <button disabled={locked} onClick={() => {
          const first = object.points[0];
          const last = object.points.at(-1)!;
          const midpoint = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
          patch({ points: [...object.points, midpoint] });
        }}>Add vertex</button>
        <button disabled={locked || object.points.length <= 3} onClick={() => patch({ points: object.points.slice(0, -1) })}>
          Remove last vertex
        </button>
      </>}
    </LabelOptions>}
    {axes && <svg className="board-axes" aria-hidden="true" width="100%" height="100%">
      <line x1={originX} x2={originX} y1="0" y2="100%" />
      <line x1="0" x2="100%" y1={originY} y2={originY} />
      <text x={originX + 5} y={originY - 5}>(0, 0)</text>
    </svg>}
    <output className="board-coordinates">({Math.round(state.pointer.x)}, {Math.round(-state.pointer.y)}) · Y ↑</output>
  </>;
}
