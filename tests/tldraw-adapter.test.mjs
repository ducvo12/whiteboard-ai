import test from 'node:test';
import assert from 'node:assert/strict';
import { Mat, GeoShapeUtil, ArrowShapeUtil, createTLStore } from 'tldraw';
import { objectToShape, shapeToObject, changedFields, preserveNativeStyles, serverObjectId } from '../src/lib/whiteboard/tldraw-adapter.ts';

const paint = { strokeColor: '#344b2d', fillColor: '#c5d4b4', strokeWidth: 2, rotation: 0 };
test('clearing advanced label fields removes them from the compatibility projection', () => {
  const plain = { ...paint, object: 'rect', x: 0, y: 0, w: 100, h: 80, label: '' };
  const labeled = { ...plain, label: 'Before', labelX: 1.2, labelY: -.2, labelFontSize: 20, labelBackground: '#ffffff' };
  const merged = JSON.parse(JSON.stringify({ ...labeled, ...changedFields(labeled, plain) }));
  assert.deepEqual(merged, plain);
});
function fixture(object) {
  const partial = objectToShape(object);
  const defaults = partial.type === 'geo' ? GeoShapeUtil.prototype.getDefaultProps() : partial.type === 'arrow' ? ArrowShapeUtil.prototype.getDefaultProps() : {};
  const shape = { typeName: 'shape', parentId: 'page:page', index: 'a1', isLocked: false, opacity: 1, ...partial, props: { ...defaults, ...partial.props } };
  const store = createTLStore();
  if (shape.type !== 'board-object') store.put([shape]);
  const editor = { store, getBindingsFromShape: () => [], getTextOptions: () => ({}),
    getShapePageTransform: (s) => Mat.Translate(s.x, s.y).rotate(s.rotation) };
  return { shape, editor };
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }

for (const rotation of [0, 30, 90, 180, -45]) {
  for (const object of [
    { object: 'rect', x: -120, y: 240, w: 180, h: 90 },
    { object: 'circle', x: -40, y: 80, r: 33 },
    { object: 'textbox', x: 15, y: -70, w: 200, h: 100, text: 'Hello\nboard', textColor: '#123456', fontSize: 18 },
    { object: 'arrow', x: -40, y: 90, x2: 160, y2: -30 },
    { object: 'polygon', x: -30, y: 10, points: [{x:-30,y:10},{x:80,y:30},{x:15,y:140}] },
  ]) test(`${object.object}: coordinates and rotation ${rotation} round trip`, () => {
    const original = { id: 'roundtrip', ...paint, ...object, rotation };
    const { shape, editor } = fixture(original);
    const converted = shapeToObject(editor, shape);
    assert.equal(converted.object, object.object);
    for (const key of ['x', 'y', 'w', 'h', 'r', 'x2', 'y2']) if (key in object) close(converted[key], object[key]);
    close(Math.sin(converted.rotation * Math.PI / 180), Math.sin(rotation * Math.PI / 180));
    close(Math.cos(converted.rotation * Math.PI / 180), Math.cos(rotation * Math.PI / 180));
    if (object.text) assert.equal(converted.text, object.text);
    if (object.points) object.points.forEach((point,i) => { close(converted.points[i].x,point.x); close(converted.points[i].y,point.y); });

  });
}

test('moving an imported shape patches geometry without quantizing its original colors', () => {
  const original = { id: 'custom-color', ...paint, object: 'rect', x: 0, y: 0, w: 100, h: 100 };
  const { shape, editor } = fixture(original);
  const before = shapeToObject(editor, shape);
  const after = shapeToObject(editor, { ...shape, x: shape.x + 25 });
  assert.deepEqual(changedFields(before, after), { x: 25 });
});

test('standard objects import as native shapes; polygons retain custom geometry', () => {
  for (const object of ['rect', 'circle', 'arrow', 'textbox']) {
    const fields = object === 'circle' ? {r:30} : object === 'arrow' ? {x2:100,y2:50} : {w:100,h:80,text:'Hello',fontSize:18,textColor:'#000000'};
    assert.equal(objectToShape({id:object,...paint,object,x:0,y:0,...fields}).type, object === 'arrow' ? 'arrow' : 'geo');
  }
});

test('polygon shared styles reach the agent projection without changing vertices', () => {
  const {shape,editor} = fixture({id:'poly',...paint,object:'polygon',x:0,y:0,points:[{x:0,y:0},{x:100,y:0},{x:20,y:100}]});
  const result = shapeToObject(editor,{...shape,props:{...shape.props,color:'red',size:'xl',fill:'semi',dash:'dashed'}});
  assert.equal(result.strokeColor,'#e03131');
  assert.equal(result.strokeWidth,10);
  assert.equal(result.fillOpacity,.25);
  assert.deepEqual(result.points,[{x:0,y:0},{x:100,y:0},{x:20,y:100}]);
});

test('resizing polygons scales vertices and keeps font and stroke sizes exact', () => {
  const original = { id: 'resize', ...paint, object: 'polygon', x: 0, y: 0,
    points: [{x:0,y:0},{x:100,y:0},{x:20,y:100}], label: 'A', labelFontSize: 17 };
  const { shape, editor } = fixture(original);
  const resized = shapeToObject(editor, { ...shape, props: { ...shape.props, w: 200, h: 300 } });
  close(resized.points[1].x - resized.points[0].x, 200);
  close(resized.points[2].y - resized.points[0].y, 300);
  assert.equal(resized.strokeWidth, 2);
  assert.equal(resized.labelFontSize, 17);
});

test('agent geometry updates preserve native-only styling and rich text', () => {
  const before = { ...paint, object:'rect', x:0,y:0,w:100,h:80,label:'Hello' };
  const incoming = {w:100,h:80,color:'green',size:'s',fill:'solid',dash:'solid',font:'sans',richText:{type:'doc'}};
  assert.deepEqual(preserveNativeStyles(before,{...before,x:50},incoming),{w:100,h:80});
  assert.equal(preserveNativeStyles(before,{...before,strokeColor:'#e03131'},{color:'red'}).color,'red');
});

test('advanced labels round trip exact fields on native rectangles, arrows, and textboxes', () => {
  for (const object of ['rect','arrow','textbox']) {
    const original = { id:`attached-${object}`, ...paint, object, x:10,y:20,w:100,h:80,
      x2:150,y2:60,text:'Body text',fontSize:18,textColor:'#123456',
      label:'Separate\nlabel',labelX:1.2,labelY:-.1,labelFontSize:23,labelColor:'#abcdef',labelBackground:'transparent' };
    const {shape,editor} = fixture(original);
    const restored = shapeToObject(editor,shape);
    assert.equal(shape.type,object === 'arrow' ? 'arrow' : 'geo');
    for (const key of ['label','labelX','labelY','labelFontSize','labelColor','labelBackground']) assert.equal(restored[key],original[key]);
    if (object === 'textbox') assert.equal(restored.text,'Body text');
  }
});

test('plain native labels stay native until advanced options are needed', () => {
  const shape = objectToShape({id:'native-label',...paint,object:'rect',x:0,y:0,w:100,h:80,label:'Native'});
  assert.equal(shape.meta.attachedLabel,null);
  assert.ok(JSON.stringify(shape.props.richText).includes('Native'));
});

test('duplicates receive independent server IDs while undo restores the original ID', () => {
  assert.equal(serverObjectId({id:'shape:original',meta:{boardId:'original'}}),'original');
  assert.equal(serverObjectId({id:'shape:duplicate',meta:{boardId:'original'}}),'shape:duplicate');
});
