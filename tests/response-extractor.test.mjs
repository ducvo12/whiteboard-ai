import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponseExtractor } from '../src/lib/response-extractor.ts';

test('answers decode correctly across every possible chunk boundary', () => {
  const answer = 'A quote: " and slash: \\; LaTeX: \\(x\\).\nEmoji: 😀; Unicode: Ω.';
  const json = JSON.stringify({ status: 'success', res: answer });
  for (let split = 1; split < json.length; split++) {
    const extractor = createResponseExtractor();
    assert.equal(extractor.push(json.slice(0, split)) + extractor.push(json.slice(split)), answer);
  }
  const escaped = '{"status":"failure","res":"Escaped \\uD83D\\uDE00 and \\u03a9"}';
  const extractor = createResponseExtractor();
  assert.equal([...escaped].map(char => extractor.push(char)).join(''), 'Escaped 😀 and Ω');
});

test('tool arguments never appear as answer text', () => {
  const extractor = createResponseExtractor();
  const text = '{"status":"tool_call","res":[{"tool_name":"add_textbox","arguments":{"status":"success","res":"secret"}}]}';
  assert.equal([...text].map(char => extractor.push(char)).join(''), '');
});

test('fenced replies stream but valid reordered keys defer to complete validation', () => {
  assert.equal(createResponseExtractor().push('```json\n{"status":"success","res":"Hello"}\n```'), 'Hello');
  assert.equal(createResponseExtractor().push('{"res":"Answer","status":"success"}'), '');
});

test('invalid JSON escapes are detected and later text is not treated as part of a closed answer', () => {
  assert.throws(() => createResponseExtractor().push('{"status":"success","res":"bad \\q"}'));
  const extractor = createResponseExtractor();
  assert.equal(extractor.push('{"status":"success","res":"Done"}'), 'Done');
  assert.equal(extractor.push(' trailing data'), '');
});
