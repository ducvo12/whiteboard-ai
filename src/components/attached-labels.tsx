"use client";

import { useRef, type ReactNode } from "react";
import { Mat, toRichText, useEditor, useValue, type TLShape } from "tldraw";
import { labelFractions, labelFromObject, labelPoint, type AttachedLabel } from "@/lib/whiteboard/attached-label";
import { readShapeLabel, attachedLabelUpdate } from "@/lib/whiteboard/polygon-label";
import { shapeToObject } from "@/lib/whiteboard/tldraw-adapter";

const LABEL_FIELDS = [
  { key: "x", title: "Label X", numeric: true },
  { key: "y", title: "Label Y", numeric: true },
  { key: "size", title: "Label size", numeric: true },
  { key: "color", title: "Label color", numeric: false },
  { key: "background", title: "Label background", numeric: false },
] as const;

export function LabelOptions({ shape, children }: { shape: TLShape; children?: ReactNode }) {
  const editor = useEditor();
  const label = readShapeLabel(shape);
  const object = shapeToObject(editor, shape);
  if (!object) return null;
  const locked = editor.getIsReadonly() || editor.isShapeOrAncestorLocked(shape);

  function update(next: AttachedLabel | null) {
    if (locked) return;
    editor.markHistoryStoppingPoint("Edit attached label");
    editor.updateShape(attachedLabelUpdate(shape, next));
  }

  function attach() {
    if (locked || !object) return;
    const attached = labelFromObject(object);
    const next = { ...attached, text: attached.text || "Label" };
    editor.markHistoryStoppingPoint("Attach label");
    if (shape.type === "board-object") {
      editor.updateShape(attachedLabelUpdate(shape, next));
      return;
    }
    if (shape.type !== "geo" && shape.type !== "arrow" && shape.type !== "text") return;
    const nativeLabel = shape.type === "arrow" || (shape.type === "geo" && shape.meta.boardKind !== "textbox");
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      meta: { ...shape.meta, attachedLabel: next },
      ...(nativeLabel ? { props: { richText: toRichText("") } } : {}),
    });
  }

  return <details className="board-properties" open key={shape.id} onPointerDown={(event) => event.stopPropagation()}>
    <summary>Label options</summary>
    <div className="board-property-fields">
      {!label ? <>
        <p>Keep native text editing, or use a separately positioned label.</p>
        <button disabled={locked} onClick={attach}>Add advanced label</button>
      </> : <>
        <p>Drag the label on the canvas. It follows its shape when moved, resized, or rotated.</p>
        <label>
          Label text
          <textarea
            aria-label="Advanced label text"
            value={label.text}
            disabled={locked}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => update({ ...label, text: event.target.value })}
          />
        </label>
        {LABEL_FIELDS.map(({ key, title, numeric }) => <label key={key}>
          {title}
          <input
            aria-label={`Advanced label ${key}`}
            value={label[key]}
            disabled={locked}
            type={numeric ? "number" : "text"}
            step={key === "size" ? 1 : 0.05}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = numeric ? event.target.valueAsNumber : event.target.value;
              if (typeof value === "number" && (!Number.isFinite(value) || (key === "size" && value <= 0))) return;
              update({ ...label, [key]: value });
            }}
          />
        </label>)}
        <button disabled={locked} onClick={() => update(null)}>Clear label</button>
      </>}
      {children}
    </div>
  </details>;
}

type LabelDrag = {
  id: string;
  label: AttachedLabel;
  point: { x: number; y: number };
};

export function AttachedLabels() {
  const editor = useEditor();
  const drag = useRef<LabelDrag | null>(null);
  const state = useValue("attached label positions", () => ({
    shapes: editor.getCurrentPageShapes(),
    screen: editor.getViewportScreenBounds(),
    selected: editor.getSelectedShapeIds(),
    // Subscribe to camera movement as well as zoom.
    camera: editor.getCamera(),
  }), [editor]);

  return <div className="attached-label-layer">{state.shapes.map((shape) => {
    const label = readShapeLabel(shape);
    if (!label?.text.trim()) return null;
    const bounds = editor.getShapeGeometry(shape).bounds;
    const transform = editor.getShapePageTransform(shape);
    const center = editor.pageToScreen(transform.applyToPoint(labelPoint(bounds, label)));
    const localPointer = (event: React.PointerEvent) => Mat.From(Mat.Inverse(transform)).applyToPoint(
      editor.screenToPage({ x: event.clientX, y: event.clientY }),
    );

    return <button
      key={shape.id}
      className="attached-label"
      aria-label={`Move label: ${label.text}`}
      data-selected={state.selected.includes(shape.id)}
      style={{
        left: center.x - state.screen.x,
        top: center.y - state.screen.y,
        fontSize: label.size,
        color: label.color,
        background: label.background,
        opacity: shape.opacity,
        transform: `translate(-50%, -50%) rotate(${transform.rotation()}rad) scale(${state.camera.z})`,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (editor.getIsReadonly() || editor.isShapeOrAncestorLocked(shape)) return;
        // Property inputs are inside the editor, so editor.focus() may be a no-op.
        // Move DOM focus too, so keyboard undo targets the drag rather than the input.
        editor.getContainer().focus();
        editor.markHistoryStoppingPoint("Move attached label");
        editor.setSelectedShapes([shape.id]);
        drag.current = { id: shape.id, label, point: localPointer(event) };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current?.id !== shape.id) return;
        event.stopPropagation();
        const original = labelPoint(bounds, drag.current.label);
        const pointer = localPointer(event);
        const position = labelFractions(bounds, {
          x: original.x + pointer.x - drag.current.point.x,
          y: original.y + pointer.y - drag.current.point.y,
        });
        editor.updateShape(attachedLabelUpdate(shape, { ...label, ...position }));
      }}
      onPointerUp={(event) => {
        if (drag.current?.id !== shape.id) return;
        event.stopPropagation();
        drag.current = null;
        editor.markHistoryStoppingPoint("Finish moving label");
      }}
      onPointerCancel={() => {
        if (drag.current?.id !== shape.id) return;
        editor.updateShape(attachedLabelUpdate(shape, drag.current.label));
        drag.current = null;
      }}
    >{label.text}</button>;
  })}</div>;
}
