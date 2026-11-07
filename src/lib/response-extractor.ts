/** Incrementally decode answer text. Complete-response validation belongs to the agent loop. */
export function createResponseExtractor() {
  let buffer = "";
  let started = false;
  let finished = false;
  let pendingSurrogate = "";

  return {
    push(chunk: string): string {
      if (finished) return "";
      buffer += chunk;
      if (!started) {
        // Only stream the requested top-level key order, never nested tool arguments.
        // Valid replies with another key order are displayed after full validation.
        const header = /^\s*(?:```(?:json)?\s*)?\{\s*"status"\s*:\s*"(success|failure|tool_call)"\s*,\s*"res"\s*:\s*/.exec(buffer);
        if (!header) return "";
        if (header[1] === "tool_call") {
          finished = true;
          buffer = "";
          return "";
        }
        const rest = buffer.slice(header[0].length);
        if (!rest.length) return "";
        if (rest[0] !== '"') throw new Error("Expected an answer string.");
        buffer = rest.slice(1);
        started = true;
      }

      let delta = pendingSurrogate;
      pendingSurrogate = "";
      let consumed = 0;
      while (consumed < buffer.length) {
        const char = buffer[consumed];
        if (char === '"') {
          finished = true;
          consumed++;
          break;
        }
        if (char === "\\") {
          const length = buffer[consumed + 1] === "u" ? 6 : 2;
          if (buffer.length - consumed < length) break;
          delta += JSON.parse(`"${buffer.slice(consumed, consumed + length)}"`);
          consumed += length;
        } else {
          if (char.charCodeAt(0) < 32) throw new Error("Unescaped control character in answer.");
          delta += char;
          consumed++;
        }
      }
      buffer = finished ? "" : buffer.slice(consumed);
      if (!finished && /[\uD800-\uDBFF]$/.test(delta)) {
        pendingSurrogate = delta.slice(-1);
        delta = delta.slice(0, -1);
      }
      return delta;
    },
  };
}
