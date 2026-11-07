import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentRepository } from '../src/lib/whiteboard/document-store.ts';

let steps = [];
let requests = [];
mock.module('../src/lib/codex/server.ts', { namedExports: {
  askCodex: async request => {
    requests.push(request);
    const step = steps.shift();
    assert.ok(step, 'unexpected model call');
    return step(request);
  },
} });
const { generateResponse } = await import('../src/lib/agent/ai.ts');

async function runAgent(replies, check) {
  const directory = mkdtempSync(join(tmpdir(), 'board-agent-'));
  const previous = globalThis.whiteboardDocumentRepository;
  const repository = new DocumentRepository(join(directory, 'board.json'));
  globalThis.whiteboardDocumentRepository = repository;
  steps = [...replies];
  requests = [];
  const events = [];
  const cancellation = new AbortController();
  try {
    await check({ repository, events, cancellation, run: () => generateResponse('Draw a box', cancellation.signal, event => events.push(event)) });
    assert.equal(steps.length, 0);
  } finally {
    globalThis.whiteboardDocumentRepository = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

const finish = () => JSON.stringify({ status: 'success', res: 'Finished.' });
const rectangle = { object: 'rect', x: 0, y: 0, w: 100, h: 80, rotation: 0, strokeColor: '#123456', fillColor: 'transparent', strokeWidth: 2 };

test('malformed response members reject the entire envelope before any mutation', async () => {
  await runAgent([
    () => JSON.stringify({ status: 'tool_call', res: [{ tool_name: 'add_shape', arguments: rectangle }, null] }),
    request => { assert.match(request.prompt, /valid response object/); return finish(); },
  ], async ({ run, repository, events }) => {
    await run();
    assert.deepEqual(repository.view(), []);
    assert.deepEqual(events, [{ type: 'reset' }, { type: 'replace', text: 'Finished.' }]);
  });
});

test('invalid streamed replies reset before retry and final-only answers replace partial output', async () => {
  await runAgent([
    request => { request.onDelta('{"status":"success","res":"Wrong'); return '{"status":"success","res":"Wrong'; },
    () => JSON.stringify({ status: 'success', res: 'Correct.' }),
  ], async ({ run, events }) => {
    await run();
    assert.deepEqual(events, [{ type: 'delta', text: 'Wrong' }, { type: 'reset' }, { type: 'replace', text: 'Correct.' }]);
  });
});

test('incremental parsing errors stay inside the attempt and a canonical answer repairs mismatched deltas', async () => {
  await runAgent([
    request => { request.onDelta('{"status":"success","res":"bad \\q"}'); return JSON.stringify({ status: 'success', res: 'Canonical answer.' }); },
  ], async ({ run, events }) => {
    await run();
    assert.deepEqual(events, [{ type: 'replace', text: 'Canonical answer.' }]);
  });
});

test('a valid answer streams without duplicating its final text', async () => {
  await runAgent([
    request => { const answer = finish(); for (const char of answer) request.onDelta(char); return answer; },
  ], async ({ run, events }) => {
    await run();
    assert.ok(events.every(event => event.type === 'delta'));
    assert.equal(events.map(event => event.text).join(''), 'Finished.');
  });
});

test('tool errors are actionable, valid calls still run, and screenshot files are cleaned up', async () => {
  let image;
  await runAgent([
    () => JSON.stringify({ status: 'tool_call', res: [
      { tool_name: 'unknown', arguments: {} },
      { tool_name: 'add_shape', arguments: {} },
      { tool_name: 'add_shape', arguments: rectangle },
    ] }),
    request => {
      const results = JSON.parse(request.prompt).filter(message => message.role === 'tool_call_result');
      assert.match(results[0].content.message, /Unknown tool/);
      assert.ok(results[1].content.error.length);
      assert.equal(results[2].content.message, 'shape created');
      image = request.images[0];
      assert.ok(existsSync(image));
      return finish();
    },
  ], async ({ run, repository }) => {
    await run();
    assert.equal(repository.view().length, 1);
    assert.equal(existsSync(image), false);
  });
});

test('screenshot attachments are removed when the next model call fails', async () => {
  let image;
  await runAgent([
    () => JSON.stringify({ status: 'tool_call', res: [{ tool_name: 'get_objects', arguments: {} }] }),
    request => { image = request.images[0]; throw new Error('Model unavailable'); },
  ], async ({ run }) => {
    await assert.rejects(run, /Model unavailable/);
    assert.equal(existsSync(image), false);
  });
});

test('cancellation between tool rounds preserves completed changes and removes attachments', async () => {
  let image;
  let cancel;
  await runAgent([
    () => JSON.stringify({ status: 'tool_call', res: [{ tool_name: 'add_shape', arguments: rectangle }] }),
    request => { image = request.images[0]; cancel.abort(); request.signal.throwIfAborted(); },
  ], async ({ run, repository, cancellation }) => {
    cancel = cancellation;
    await assert.rejects(run, { name: 'AbortError' });
    assert.equal(repository.view().length, 1);
    assert.equal(existsSync(image), false);
  });
});
