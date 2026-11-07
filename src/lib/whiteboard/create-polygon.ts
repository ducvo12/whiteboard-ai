import { createShapeId, type Editor } from "tldraw";
import { objectToShape } from "./tldraw-adapter";

export function createPolygon(editor: Editor) {
  if (editor.getIsReadonly()) return;
  editor.complete();
  editor.setCurrentTool("select");
  const center = editor.getViewportPageBounds().center;
  const x = center.x - 70;
  const y = -center.y - 45;
  const id = createShapeId();
  editor.markHistoryStoppingPoint("Add board shape");
  const partial = objectToShape({
    id, object: "polygon", x, y, rotation: 0,
    strokeColor: "#344b2d", fillColor: "#c5d4b4", strokeWidth: 2,
    points: [{ x, y }, { x: x + 140, y }, { x: x + 110, y: y + 90 }, { x: x + 30, y: y + 110 }],
  });
  // The editor applies shared styles automatically when omitted from the partial.
  if (partial.props) {
    const props = { ...partial.props } as Record<string, unknown>;
    for (const key of ['color', 'size', 'fill', 'dash']) delete props[key];
    partial.props = props;
  }
  editor.createShape(partial);
  editor.setSelectedShapes([id]);
}
