import test from 'node:test';
import assert from 'node:assert/strict';
import {Mat,GeoShapeUtil,ArrowShapeUtil,TextShapeUtil,toRichText,createTLStore} from 'tldraw';
import {boardPosition} from '../src/lib/whiteboard/tldraw-board-model.ts';
import {objectToShape,shapeToObject} from '../src/lib/whiteboard/tldraw-adapter.ts';
import {applyAgentObject} from '../src/lib/whiteboard/apply-board-command.ts';

function fixture() {
  const object={id:'test',object:'rect',x:10,y:20,w:100,h:80,rotation:0,strokeColor:'#123456',fillColor:'transparent',strokeWidth:2};
  const partial=objectToShape(object);
  let shape={...partial,typeName:'shape',parentId:'shape:group',opacity:.4,props:{...GeoShapeUtil.prototype.getDefaultProps(),...partial.props,fill:'lined-fill',font:'mono',richText:toRichText('Keep me')},meta:{...partial.meta,custom:'keep'}};
  const editor={getShape:()=>shape,getShapePageTransform:s=>Mat.Translate(s.x,s.y).rotate(s.rotation),getShapeParentTransform:()=>Mat.Identity(),getBindingsFromShape:()=>[],getTextOptions:()=>({}),updateShape:patch=>{shape={...shape,...patch,props:{...shape.props,...patch.props}};}};
  return {object,editor,get:()=>shape};
}
test('agent position edit retains native fill, rich text, opacity, parent and metadata',()=>{
  const f=fixture(),before=shapeToObject(f.editor,f.get()),original=f.get();
  applyAgentObject(f.editor,{...f.object,x:40},f.object,before);
  assert.equal(f.get().x,40);
  for(const key of ['fill','font','richText'])assert.deepEqual(f.get().props[key],original.props[key]);
  assert.equal(f.get().opacity,.4);assert.equal(f.get().parentId,'shape:group');assert.equal(f.get().meta.custom,'keep');
});
test('agent edit preserves a simultaneous nonoverlapping local move',()=>{
  const f=fixture(),before=shapeToObject(f.editor,f.get());
  f.editor.updateShape({x:50,props:{}});
  applyAgentObject(f.editor,{...f.object,strokeColor:'#ff0000'},f.object,before);
  assert.equal(f.get().x,50);
});
test('overlapping local and agent position edits are rejected before mutation',()=>{
  const f=fixture(),before=shapeToObject(f.editor,f.get());
  f.editor.updateShape({x:50,props:{}});
  assert.throws(()=>applyAgentObject(f.editor,{...f.object,x:80},f.object,before),/edited locally/);
  assert.equal(f.get().x,50);
});

for (const geo of ['triangle', 'ellipse']) {
  test(`agent edits reject a locally changed rectangle (${geo})`, () => {
    const f = fixture();
    const before = shapeToObject(f.editor, f.get());
    f.editor.updateShape({ props: { geo, w: 100, h: 100 } });
    const local = f.get();
    assert.throws(() => applyAgentObject(f.editor, { ...f.object, strokeColor: '#ff0000' }, f.object, before), /locally/);
    assert.deepEqual(f.get(), local);
  });
}

function nativeTextFixture(rotation = 0, parent = Mat.Identity()) {
  const object = { id: 'text', object: 'textbox', x: 10, y: 20, w: 100, h: 80, rotation,
    strokeColor: '#1d1d1d', fillColor: 'transparent', strokeWidth: 2, text: 'Native text', fontSize: 18, textColor: '#1d1d1d' };
  const position = boardPosition(object);
  const point = Mat.From(Mat.Inverse(parent)).applyToPoint(position);
  let shape = { id: 'shape:text', type: 'text', typeName: 'shape', x: point.x, y: point.y, rotation: position.rotation - parent.rotation(),
    meta: {}, props: { ...TextShapeUtil.prototype.getDefaultProps(), w: 100, richText: toRichText(object.text) } };
  const editor = {
    getShape: () => shape,
    getShapePageTransform: s => Mat.Compose(parent, Mat.Translate(s.x, s.y).rotate(s.rotation)),
    getShapeParentTransform: () => parent,
    getTextOptions: () => ({}),
    getShapeGeometry: () => ({ bounds: { x: 0, y: 0, w: shape.props.w, h: 80, center: { x: shape.props.w / 2, y: 40 } } }),
    updateShape: patch => {
      assert.equal('z' in patch, false, 'native records cannot contain the vector pressure coordinate');
      shape = { ...shape, ...patch, props: { ...shape.props, ...patch.props } };
    },
  };
  return { editor, object, get: () => shape };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
}

for (const rotation of [0, 30, 90]) {
  for (const grouped of [false, true]) {
    test(`native text preserves a local X move during an agent Y move (${rotation}°, grouped=${grouped})`, () => {
      const parent = grouped ? Mat.Translate(300, 200).rotate(0.4) : Mat.Identity();
      const f = nativeTextFixture(rotation, parent);
      const before = shapeToObject(f.editor, f.get());
      const localDelta = Mat.From(Mat.Inverse(parent)).applyToPoint({ x: parent.e + 30, y: parent.f });
      f.editor.updateShape({ x: f.get().x + localDelta.x, y: f.get().y + localDelta.y });
      applyAgentObject(f.editor, { ...f.object, y: 40 }, f.object, before);
      const after = shapeToObject(f.editor, f.get());
      close(after.x, 40);
      close(after.y, 40);
      close(Math.sin(after.rotation * Math.PI / 180), Math.sin(rotation * Math.PI / 180));
      close(Math.cos(after.rotation * Math.PI / 180), Math.cos(rotation * Math.PI / 180));
    });
  }
}

test('native text uses its updated layout when width and rotation change together', () => {
  const f = nativeTextFixture();
  const before = shapeToObject(f.editor, f.get());
  f.editor.updateShape({ x: f.get().x + 30 });
  applyAgentObject(f.editor, { ...f.object, w: 150, rotation: 90 }, f.object, before);
  const after = shapeToObject(f.editor, f.get());
  close(after.x, 40);
  close(after.y, 20);
  close(after.w, 150);
});

for (const kind of ['rect', 'arrow']) {
  test(`${kind} keeps label text when switching advanced placement back to native`, () => {
    const object = { id: kind, object: kind, x: 10, y: 20, w: 100, h: 80, x2: 150, y2: 60,
      rotation: 0, strokeColor: '#123456', fillColor: 'transparent', strokeWidth: 2, label: 'Keep label' };
    const advanced = { ...object, labelX: 1.2, labelFontSize: 20 };
    const partial = objectToShape(advanced);
    const defaults = kind === 'arrow' ? ArrowShapeUtil.prototype.getDefaultProps() : GeoShapeUtil.prototype.getDefaultProps();
    let shape = { ...partial, typeName: 'shape', parentId: 'page:test', index: 'a1', isLocked: false, opacity: 1, props: { ...defaults, ...partial.props } };
    const store = createTLStore();
    store.put([shape]);
    const editor = { store, getShape: () => shape, getShapePageTransform: s => Mat.Translate(s.x, s.y).rotate(s.rotation),
      getTextOptions: () => ({}), getBindingsFromShape: () => [],
      updateShape: patch => { shape = { ...shape, ...patch, props: { ...shape.props, ...patch.props } }; store.put([shape]); } };
    applyAgentObject(editor, object, advanced, shapeToObject(editor, shape));
    assert.equal(shape.meta.attachedLabel, null);
    assert.equal(shapeToObject(editor, shape).label, 'Keep label');
  });
}
