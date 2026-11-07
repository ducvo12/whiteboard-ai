import { z } from "zod";
import { generateResponse } from "@/lib/agent/ai";
import type { ChatEvent } from "@/lib/agent/chat-events";

export const runtime = "nodejs";

const PromptSchema = z.object({ prompt: z.string().trim().min(1).max(20_000) });
// Preserve admission state across route bundles and development hot reloads.
const shared = globalThis as typeof globalThis & { whiteboardChatBusy?: boolean };

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Local chat is available only with npm run dev." }, { status: 403 });
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || (origin && origin !== url.origin)) {
    return Response.json({ error: "Use chat from this app on localhost." }, { status: 403 });
  }

  const parsed = PromptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Send a JSON prompt between 1 and 20,000 characters." }, { status: 400 });
  }
  if (shared.whiteboardChatBusy) {
    return Response.json({ error: "The assistant is already working in another request. Wait for it to finish and try again." }, { status: 409 });
  }
  shared.whiteboardChatBusy = true;

  const encoder = new TextEncoder();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => {
        if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        signal.throwIfAborted();
        await generateResponse(parsed.data.prompt, signal, send);
        send({ type: "done" });
      } catch (error) {
        if (!signal.aborted) {
          console.error("Chat generation failed:", error);
          send({ type: "reset" });
          send({ type: "error", message: "Codex could not finish. Check codex login status and try again." });
        }
      } finally {
        shared.whiteboardChatBusy = false;
        if (!signal.aborted) controller.close();
      }
    },
    cancel() {
      cancellation.abort();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
