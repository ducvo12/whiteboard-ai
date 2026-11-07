import test from 'node:test';
import assert from 'node:assert/strict';
import { createTLStore, GeoShapeUtil, ArrowShapeUtil, Mat } from 'tldraw';
import { boardDocumentSchema } from '../src/lib/whiteboard/document-schema.ts';
import { boardProps } from '../src/lib/whiteboard/tldraw-board-model.ts';
import { objectToShape } from '../src/lib/whiteboard/tldraw-adapter.ts';
import { connectBoard, UNSAVED_BOARD_KEY } from '../src/lib/whiteboard/tldraw-sync.ts';

const paint = { rotation: 0, strokeColor: '#123456', fillColor: 'transparent', strokeWidth: 2 };

async function waitFor(check) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(check(), 'timed out waiting for board synchronization');
}

async function withBoard(object, run, legacy = false) {
  const original = {
    fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  };
  const store = createTLStore({ schema: boardDocumentSchema });
  const partial = objectToShape(object);
  const defaults = partial.type === 'geo' ? GeoShapeUtil.prototype.getDefaultProps()
    : partial.type === 'arrow' ? ArrowShapeUtil.prototype.getDefaultProps() : {};
  const shape = { typeName: 'shape', parentId: 'page:test', index: 'a1', isLocked: legacy, opacity: 1,
    ...partial, props: { ...defaults, ...partial.props } };
  if (legacy) {
    shape.props = boardProps(object);
    shape.meta = { boardId: object.id };
  }
  store.put([{ id: 'page:test', typeName: 'page', name: 'Test', index: 'a1', meta: {} }, shape]);
  let state = { version: 1, revision: 0, sequence: 0, commands: [], projection: [object], document: store.getStoreSnapshot() };
  let readonly = false;
  let ignoreLock = false;
  let notice = '';
  let writes = 0;
  const recovery = new Map();
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: (key, value) => recovery.set(key, value) } });
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      state = { ...state, ...body, revision: state.revision + 1, commands: [] };
      writes++;
      return Response.json({ revision: state.revision });
    }
    return Response.json(state);
  };
  const editor = {
    store,
    inputs: { getIsPointing: () => false },
    getEditingShapeId: () => null,
    getIsReadonly: () => readonly,
    updateInstanceState: update => { readonly = update.isReadonly; },
    getShape: id => store.get(id),
    getShapePageTransform: s => Mat.Translate(s.x, s.y).rotate(s.rotation),
    getShapeParentTransform: () => Mat.Identity(),
    getTextOptions: () => ({}),
    getBindingsFromShape: () => [],
    getCurrentPageShapeIds: () => new Set(store.allRecords().filter(r => r.typeName === 'shape').map(r => r.id)),
    zoomToFit() {}, centerOnPoint() {}, clearHistory() {},
    run: (change, options) => {
      ignoreLock = options.ignoreShapeLock;
      try { change(); } finally { ignoreLock = false; }
    },
    updateShape: patch => {
      const current = store.get(patch.id);
      if (readonly || current.isLocked && !ignoreLock) return;
      store.put([{ ...current, ...patch, props: { ...current.props, ...patch.props } }]);
    },
    deleteShapes: ids => { if (!readonly) store.remove(ids); },
  };
  let disconnect;
  try {
    disconnect = connectBoard(editor, message => { notice = message; });
    await waitFor(() => {
      assert.doesNotMatch(notice, /saving will retry/, notice);
      return !readonly;
    });
    await run({ editor, store, recovery, getNotice: () => notice, getWrites: () => writes,
      queue: command => { state = { ...state, sequence: 1, commands: [{ ...command, seq: 1 }] }; } });
  } finally {
    disconnect?.();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('initial load migrates legacy labels even while loading readonly and locked polygons', async () => {
  const polygon = { id: 'polygon', object: 'polygon', ...paint, x: 0, y: 0,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }], label: 'Legacy label', labelX: 2 };
  await withBoard(polygon, async f => {
    await waitFor(() => f.getWrites() === 1);
    const shape = f.store.get('shape:polygon');
    assert.equal(shape.meta.attachedLabel.text, 'Legacy label');
    assert.equal(shape.meta.polygonLabelVersion, 1);
    assert.equal(JSON.parse(shape.props.data).label, undefined);
    assert.equal(shape.isLocked, true);
  }, true);
});

for (const change of ['triangle', 'circle', 'bent arrow']) {
  test(`agent deletion preserves an incompatible local change (${change})`, async () => {
    const object = change === 'bent arrow'
      ? { id: 'shape', object: 'arrow', ...paint, x: 0, y: 0, x2: 100, y2: 100 }
      : { id: 'shape', object: 'rect', ...paint, x: 0, y: 0, w: 100, h: 100 };
    await withBoard(object, async f => {
      const shape = f.store.get('shape:shape');
      const props = change === 'bent arrow' ? { bend: 40 } : { geo: change === 'circle' ? 'ellipse' : 'triangle' };
      f.editor.updateShape({ id: shape.id, props });
      f.queue({ kind: 'delete', id: object.id });
      await waitFor(() => f.editor.getIsReadonly());
      assert.match(f.getNotice(), /locally/);
      assert.ok(f.store.get(shape.id));
      assert.ok(f.recovery.has(UNSAVED_BOARD_KEY));
      assert.equal(f.getWrites(), 0);
    });
  });
}
