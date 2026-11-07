import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentRepository } from '../src/lib/whiteboard/document-store.ts';
import { PUT } from '../src/app/api/board/route.ts';
import { fullDocument } from './fixtures/full-document.mjs';

function save(body) {
  return PUT(new Request('http://localhost/api/board', { method: 'PUT', body: JSON.stringify(body) }));
}

test('save responses distinguish invalid documents, conflicts, and filesystem failures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'board-route-'));
  const path = join(directory, 'board.json');
  const original = globalThis.whiteboardDocumentRepository;
  const originalError = console.error;
  const repository = new DocumentRepository(path);
  globalThis.whiteboardDocumentRepository = repository;
  try {
    const document = fullDocument();
    const body = { expectedRevision: 0, acknowledged: 0, projection: [], document };
    assert.equal((await save({ ...body, document: {} })).status, 400);
    assert.equal((await save({ ...body, expectedRevision: -1 })).status, 400);
    assert.equal((await save({ ...body, expectedRevision: 1 })).status, 409);
    assert.equal(repository.read().revision, 0);

    // A directory where the destination file should be makes atomic replacement fail.
    mkdirSync(path);
    console.error = () => {};
    assert.equal((await save(body)).status, 500);
    assert.equal(repository.read().revision, 0);
    rmSync(path, { recursive: true });
    assert.equal((await save(body)).status, 200);
    assert.equal(repository.read().revision, 1);
  } finally {
    globalThis.whiteboardDocumentRepository = original;
    console.error = originalError;
    rmSync(directory, { recursive: true, force: true });
  }
});
