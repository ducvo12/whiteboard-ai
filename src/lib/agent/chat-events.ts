import { z } from "zod";

const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("replace"), text: z.string() }),
  z.object({ type: z.literal("reset") }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;

/** Read newline-delimited JSON, regardless of HTTP or UTF-8 chunk boundaries. */
export async function readChatEvents(stream: ReadableStream<Uint8Array>, receive: (event: ChatEvent) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        if (completed) throw new Error("Unexpected data after the response completed.");
        const event = ChatEventSchema.parse(JSON.parse(line));
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") completed = true;
        receive(event);
      }
    }
    if (!completed || buffer.trim()) throw new Error("The response was interrupted. Please try again.");
  } finally {
    // Cancellation also stops the server if parsing or the consumer fails mid-stream.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
