import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, GeoShapeUtil, getDisplayValues } from 'tldraw';
import { PolygonGeoStyleUtil, polygonNativeShape } from '../src/lib/whiteboard/polygon-native-style.ts';
import { objectToShape } from '../src/lib/whiteboard/tldraw-adapter.ts';

for (const mode of ['light','dark']) for (const fill of ['none','semi','solid','pattern','fill','lined-fill']) {
  test(`${mode}: polygon ${fill} uses native fill and stroke display values`, () => {
    const editor = {getCurrentTheme:()=>DEFAULT_THEME,getColorMode:()=>mode};
    const polygon = objectToShape({id:'test',object:'polygon',x:0,y:0,rotation:0,strokeColor:'#4465e9',fillColor:'#4465e9',strokeWidth:2,
      points:[{x:0,y:0},{x:100,y:0},{x:20,y:80}]});
    polygon.props.fill = fill;
    const polygonUtil = new PolygonGeoStyleUtil(editor);
    const shape = polygonNativeShape(polygon,polygonUtil);
    const nativeUtil = new GeoShapeUtil(editor);
    const native = {...shape,props:{...shape.props,geo:'rectangle'}};
    assert.deepEqual(getDisplayValues(polygonUtil,shape),getDisplayValues(nativeUtil,native));
    assert.equal(shape.props.fill,fill);
    const path = polygonUtil.options.customGeoTypes['board-polygon-body'].getPath(100,80,shape,2);
    assert.ok(path.toD().length>0);
    const definitions=[];
    assert.ok(polygonUtil.toSvg(shape,{colorMode:mode,addExportDef:def=>definitions.push(def)}));
    assert.equal(definitions.length,1);
  });
}
