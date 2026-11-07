"use client";

import {
  Polygon2d, ShapeUtil, Vec, getIndexAbove, resizeBox,
  type TLHandle, type TLHandleDragInfo, type TLResizeInfo, type SvgExportContext,
} from "tldraw";
import { polygonRecordProps } from "@/lib/whiteboard/document-schema";
import { PolygonGeoStyleUtil, polygonNativeShape } from "@/lib/whiteboard/polygon-native-style";
import { polygonObject } from "@/lib/whiteboard/tldraw-adapter";
import { boardBounds, boardProps, type ExactBoardShape } from "@/lib/whiteboard/tldraw-board-model";
import { labelMetrics } from "@/lib/whiteboard/label";
import { labelPoint } from "@/lib/whiteboard/attached-label";
import { readShapeLabel } from "@/lib/whiteboard/polygon-label";

function PolygonLabels({ shape }: { shape: ExactBoardShape }) {
  const label = readShapeLabel(shape);
  if (!label?.text.trim()) return null;
  const center = labelPoint({ x: 0, y: 0, w: shape.props.w, h: shape.props.h }, label);
  const lines = label.text.split("\n");
  const width = Math.max(...lines.map((line) => labelMetrics(line, label.size).w)) + 12;
  const lineHeight = label.size * 1.2;
  const height = lines.length * lineHeight + 6;
  return <g>
    <rect
      x={center.x - width / 2} y={center.y - height / 2} width={width} height={height}
      rx={3} fill={label.background} stroke="#e3e5dc"
    />
    <text fill={label.color} fontSize={label.size} textAnchor="middle" dominantBaseline="central">
      {lines.map((line, index) => <tspan key={index} x={center.x} y={center.y + (index - (lines.length - 1) / 2) * lineHeight}>
        {line}
      </tspan>)}
    </text>
  </g>;
}

function Drawing({ shape, util }: { shape: ExactBoardShape; util: PolygonGeoStyleUtil }) {
  return util.component(polygonNativeShape(shape, util));
}

export class ExactBoardShapeUtil extends ShapeUtil<ExactBoardShape> {
  static override type = "board-object" as const;
  static override props = polygonRecordProps;
  private nativeStyle = new PolygonGeoStyleUtil(this.editor);

  getDefaultProps() {
    return boardProps({
      object: "polygon", x: 0, y: 0, rotation: 0,
      points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 60, y: 80 }],
      strokeColor: "#344b2d", fillColor: "#c5d4b4", strokeWidth: 2,
    });
  }

  override canEdit() { return false; }

  getGeometry(shape: ExactBoardShape) {
    const object = polygonObject(shape.props);
    return new Polygon2d({ points: object.points.map((point) => new Vec(point.x, -point.y)), isFilled: true });
  }

  component(shape: ExactBoardShape) {
    return <Drawing shape={shape} util={this.nativeStyle} />;
  }

  getIndicatorPath(shape: ExactBoardShape) {
    return new Path2D(this.getGeometry(shape).getSvgPathData());
  }

  override getCanvasSvgDefs() {
    return this.nativeStyle.getCanvasSvgDefs();
  }

  override toSvg(shape: ExactBoardShape, context: SvgExportContext) {
    return <g fontFamily="Helvetica, Arial, sans-serif">
      {this.nativeStyle.toSvg(polygonNativeShape(shape, this.nativeStyle), context)}
      <PolygonLabels shape={shape} />
    </g>;
  }

  override onResize(shape: ExactBoardShape, info: TLResizeInfo<ExactBoardShape>) {
    return resizeBox(shape, info);
  }

  override getHandles(shape: ExactBoardShape): TLHandle[] {
    const object = polygonObject(shape.props);
    let index = getIndexAbove();
    return object.points.map((point, vertex) => {
      const handle: TLHandle = { id: `vertex-${vertex}`, label: `Vertex ${vertex + 1}`, x: point.x, y: -point.y, type: "vertex", index };
      index = getIndexAbove(index);
      return handle;
    });
  }

  override onHandleDrag(current: ExactBoardShape, { handle, initial }: TLHandleDragInfo<ExactBoardShape>) {
    if (!handle.id.startsWith("vertex-")) return;
    const shape = initial ?? current;
    const object = polygonObject(shape.props);
    const vertex = Number(handle.id.slice(7));
    const points = object.points.map((point, index) => index === vertex ? { x: handle.x, y: -handle.y } : point);
    const updated = { ...object, points, x: points[0].x, y: points[0].y };
    const bounds = boardBounds(updated);
    const dx = bounds.minX;
    const dy = -bounds.maxY;
    return {
      id: shape.id, type: shape.type,
      x: shape.x + dx * Math.cos(shape.rotation) - dy * Math.sin(shape.rotation),
      y: shape.y + dx * Math.sin(shape.rotation) + dy * Math.cos(shape.rotation),
      props: { ...boardProps(updated), color: shape.props.color, size: shape.props.size, fill: shape.props.fill, dash: shape.props.dash },
    };
  }
}
