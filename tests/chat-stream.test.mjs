import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readChatEvents } from '../src/lib/agent/chat-events.ts';

let generate;
mock.module('../src/lib/agent/ai.ts', { namedExports: {
  generateResponse: (...args) => generate(...args),
} });
const { POST } = await import('../src/app/api/chat/route.ts');

function request(signal) {
  return new Request('http://localhost:3000/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Hello' }), signal,
  });
}

test('event decoding preserves split UTF-8, reset, and replacement boundaries', async () => {
  const events = [{ type: 'delta', text: 'Wrong' }, { type: 'reset' }, { type: 'delta', text: '😀' }, { type: 'replace', text: 'Correct 😀' }, { type: 'done' }];
  const bytes = new TextEncoder().encode(events.map(event => JSON.stringify(event) + '\n').join(''));
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const received = [];
  await readChatEvents(stream, event => received.push(event));
  assert.deepEqual(received, events);
});

test('a truncated stream fails rather than presenting an incomplete answer as finished', async () => {
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"Partial"}\n'));
    controller.close();
  } });
  await assert.rejects(() => readChatEvents(stream, () => {}), /interrupted/);
});

test('the route admits one request and releases admission after success, failure, and cancellation', async () => {
  const environment = process.env.NODE_ENV;
  const originalError = console.error;
  process.env.NODE_ENV = 'development';
  try {
    let finish;
    generate = () => new Promise(resolve => { finish = resolve; });
    const first = await POST(request());
    assert.equal(first.status, 200);
    assert.equal((await POST(request())).status, 409);
    finish();
    await readChatEvents(first.body, () => {});

    generate = async () => { throw new Error('Expected test failure'); };
    console.error = () => {};
    const failed = await POST(request());
    assert.equal(failed.status, 200);
    await assert.rejects(() => readChatEvents(failed.body, () => {}), /Codex could not finish/);

    let cancelled;
    generate = (_prompt, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true });
    });
    const active = await POST(request());
    assert.equal(active.status, 200);
    await active.body.cancel();
    assert.equal(cancelled, true);
    await new Promise(resolve => setImmediate(resolve));
    generate = async (_prompt, _signal, send) => send({ type: 'delta', text: 'Ready again' });
    const next = await POST(request());
    assert.equal(next.status, 200);
    await readChatEvents(next.body, () => {});
  } finally {
    process.env.NODE_ENV = environment;
    console.error = originalError;
    delete globalThis.whiteboardChatBusy;
  }
});
