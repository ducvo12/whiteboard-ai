import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentRepository } from '../src/lib/whiteboard/document-store.ts';
import { createShape, updateObject, listObjects } from '../src/lib/whiteboard/services.ts';

test('updates reject incompatible fields and avoid durable writes for no-ops', () => {
  const directory = mkdtempSync(join(tmpdir(), 'board-services-'));
  const previous = globalThis.whiteboardDocumentRepository;
  const repository = new DocumentRepository(join(directory, 'board.json'));
  globalThis.whiteboardDocumentRepository = repository;
  try {
    createShape({ object: 'rect', x: 0, y: 0, w: 100, h: 80, rotation: 0,
      strokeColor: '#123456', fillColor: 'transparent', strokeWidth: 2 }, 'rect');
    assert.equal(updateObject({ id: 'rect', patch: { r: 50 } }).success, false);
    assert.equal(updateObject({ id: 'rect', patch: { x: 10, r: 50 } }).success, false);
    assert.equal(repository.read().sequence, 1);
    assert.equal(listObjects()[0].x, 0);
    assert.equal(updateObject({ id: 'rect', patch: {} }).success, true);
    assert.equal(updateObject({ id: 'rect', patch: { x: 0 } }).success, true);
    assert.equal(repository.read().sequence, 1);
    const result = updateObject({ id: 'rect', patch: { x: 10 } });
    assert.deepEqual(result.new_values, { x: 10 });
    assert.deepEqual(result.old_values, { x: 0 });
    assert.equal(listObjects()[0].x, 10);
  } finally {
    globalThis.whiteboardDocumentRepository = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
