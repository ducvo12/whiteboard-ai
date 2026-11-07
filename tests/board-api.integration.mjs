import test from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_BOARD_URL;
if (!url) throw new Error('Set TEST_BOARD_URL to an isolated test server before running API tests.');
test('board API supports stable creates, field conflicts, and safe deletion', async () => {
  const id = `shape:pass2-test-${crypto.randomUUID()}`;
  const object = { id, object: 'rect', x: 100, y: 200, w: 120, h: 80, rotation: 30,
    strokeColor: '#123456', fillColor: 'transparent', strokeWidth: 2 };
  const call = (method, body) => fetch(`${url}/api/objects`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await call('PUT', object)).status, 200);
    assert.equal((await call('PUT', object)).status, 200);
    let list = await (await fetch(`${url}/api/objects`)).json();
    assert.equal(list.filter((item) => item.id === id).length, 1);
    assert.equal((await call('PATCH', { id, patch: { x: 125 }, expected: { x: 100 } })).status, 200);
    assert.equal((await call('PATCH', { id, patch: { x: 150 }, expected: { x: 100 } })).status, 409);
    assert.equal((await call('PATCH', { id, patch: { y: 250 }, expected: { y: 200 } })).status, 200);
    assert.equal((await call('PATCH', { id, patch: { r: 50 } })).status, 400);
    assert.equal((await call('PATCH', { id, patch: { x: 999 }, expected: [] })).status, 400);
    assert.equal((await call('PATCH', { id, patch: { x: 999 }, expected: { unexpected: true } })).status, 400);
    assert.equal((await call('DELETE', { id, expected: object })).status, 409);
    list = await (await fetch(`${url}/api/objects`)).json();
    const current = list.find((item) => item.id === id);
    assert.equal(current.x, 125);
    assert.equal(current.y, 250);
    assert.equal(current.strokeColor, '#123456');
    const reordered = Object.fromEntries(Object.entries(current).reverse());
    assert.equal((await call('DELETE', { id, expected: reordered })).status, 200);
    assert.equal((await call('DELETE', { id, expected: current })).status, 200);
    assert.equal((await call('PATCH', { id, patch: { x: 400 }, expected: { x: 125 } })).status, 409);
  } finally {
    await call('DELETE', { id });
  }
});

test('object mutations reject malformed JSON without changing the board', async () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const result = await fetch(`${url}/api/objects`, { method, headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(result.status, 400);
  }
});
