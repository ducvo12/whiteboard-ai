import { GeoShapeUtil, PathBuilder, createShapeId, type Editor, type TLGeoShape } from "tldraw";
import { localBoardObject, type ExactBoardShape } from "./tldraw-board-model.ts";

/** Reuse native fill, dash, theme, and zoom behavior instead of maintaining a second renderer. */
export class PolygonGeoStyleUtil extends GeoShapeUtil {
  constructor(editor: Editor) {
    super(editor);
    this.options = {
      ...this.options,
      customGeoTypes: {
        "board-polygon-body": {
          icon: "geo-triangle",
          snapType: "polygon",
          getPath(_w, _h, shape) {
            const points = shape.meta.boardPoints as { x: number; y: number }[];
            const path = new PathBuilder();
            points.forEach((point, index) => {
              if (index === 0) path.moveTo(point.x, -point.y, { geometry: { isFilled: shape.props.fill !== "none" } });
              else path.lineTo(point.x, -point.y);
            });
            return path.close();
          },
        },
      },
    };
  }
}

export function polygonNativeShape(shape: ExactBoardShape, util: PolygonGeoStyleUtil): TLGeoShape {
  const object = localBoardObject(shape.props);
  if (object.object !== "polygon") throw new Error("Expected polygon");
  // This record is rendering-only. A separate ID isolates native text editing
  // from the actual polygon's attached label and vertex handles.
  return {
    ...shape,
    id: createShapeId(`${shape.id}-body`),
    type: "geo",
    meta: { boardPoints: object.points },
    props: {
      ...util.getDefaultProps(),
      geo: "board-polygon-body" as TLGeoShape["props"]["geo"],
      w: shape.props.w, h: shape.props.h,
      color: shape.props.color, size: shape.props.size,
      fill: shape.props.fill, dash: shape.props.dash,
    },
  };
}
