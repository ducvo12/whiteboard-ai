import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { renderBoardScreenshot, writeBoardScreenshot } from '../src/lib/whiteboard/screenshot.ts';
import { labelLayout } from '../src/lib/whiteboard/label.ts';

const rectangle = { id: 'rect', object: 'rect', x: 0, y: 0, w: 20, h: 400, rotation: 0,
  strokeColor: '#123456', fillColor: 'transparent', strokeWidth: 2 };

test('screenshot framing follows rotated geometry instead of clipping a tall shape', () => {
  const portrait = renderBoardScreenshot([rectangle]);
  const landscape = renderBoardScreenshot([{ ...rectangle, rotation: 90 }]);
  assert.ok(portrait.height > portrait.width * 3);
  assert.ok(landscape.width > landscape.height * 3);
  assert.deepEqual([...landscape.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const png = Buffer.from(landscape.png);
  assert.equal(png.readUInt32BE(16), landscape.width);
  assert.equal(png.readUInt32BE(20), landscape.height);
});

test('labels remain outside shape bounds, with space for all text lines', () => {
  const object = { ...rectangle, w: 100, h: 100, label: 'First\nSecond', labelX: 10, labelY: -5, labelFontSize: 20 };
  const label = labelLayout(object, object.label);
  assert.equal(label.cx, 1000);
  assert.equal(label.cy, -500);
  assert.deepEqual(label.lines, ['First', 'Second']);
  assert.ok(label.h > 40);
  const original = renderBoardScreenshot([{ ...object, label: '' }]);
  const labeled = renderBoardScreenshot([object]);
  assert.ok(labeled.width / labeled.height > original.width / original.height);
});

test('PNG file output matches the rendered bytes and empty boards render successfully', () => {
  const shot = writeBoardScreenshot([]);
  try {
    assert.deepEqual(readFileSync(shot.imagePath), Buffer.from(renderBoardScreenshot([]).png));
  } finally {
    rmSync(shot.imagePath, { force: true });
  }
});
