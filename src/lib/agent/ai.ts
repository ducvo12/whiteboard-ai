import "server-only";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { askCodex } from "../codex/server.ts";
import { createResponseExtractor } from "../response-extractor.ts";
import { writeBoardScreenshot } from "../whiteboard/screenshot.ts";
import { listObjects } from "../whiteboard/services.ts";
import { toolDescriptions } from "./tools.ts";
import type { ChatEvent } from "./chat-events";

const ToolCallSchema = z.object({
  tool_name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});
const AnswerSchema = z.string().refine((text) => text.trim().length > 0, "An answer must not be empty.");
const AgentResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("tool_call"), res: ToolCallSchema.array().min(1) }),
  z.strictObject({ status: z.literal("success"), res: AnswerSchema }),
  z.strictObject({ status: z.literal("failure"), res: AnswerSchema }),
]);

type AgentMessage = {
  role: "user" | "assistant" | "error" | "tool_call_result" | "board_screenshot";
  content: unknown;
  specific?: string;
  call_id?: string;
};

const BASE_INSTRUCTIONS = `
You are an educational assistant that can draw on a whiteboard.
You receive a JSON array of chat history, oldest message first. Each user prompt starts a fresh conversation.
Only use the whiteboard tools listed below. Do not access external resources.

Return one JSON object, without Markdown fences or surrounding text. Put status before res:
- {"status":"success","res":"your complete answer"}
- {"status":"failure","res":"explain why you cannot finish"}
- {"status":"tool_call","res":[{"tool_name":"name","arguments":{}}]}
Success and failure answers may contain Markdown and LaTeX.

Tools:
${JSON.stringify(toolDescriptions.map(({ tool_name, tool_description, arguments: args }) => ({
  tool_name, tool_description, arguments: args,
})), null, 2)}

Example tool call:
{"status":"tool_call","res":[{"tool_name":"add_shape","arguments":{"object":"rect","x":570,"y":350,"w":120,"h":80,"rotation":0,"strokeColor":"#344b2d","fillColor":"transparent","strokeWidth":2}}]}

The board is infinite and uses Cartesian coordinates:
- (0, 0) is the origin shown by the axes. X increases right; Y increases upward.
- Above means increase y; below means decrease y. Do not invert y.
- rect and textbox: (x, y) is the bottom-left corner; bounds are x..x+w and y..y+h.
- circle: (x, y) is the center.
- polygon: points are absolute world vertices; (x, y) matches the first point.
- arrow: (x, y) is the tail; (x2, y2) is the tip.
- rotation is degrees counterclockwise around the object center. Use 0 unless an angle is requested.
- Prefer changing rotation to calculating rotated polygon vertices.
- Downhill follows the endpoint with smaller y; kinetic friction points the opposite way along a slope.

Tool calls run sequentially and successful changes are durable, even if a later call fails.
Fix reported tool errors. Do not repeat a successful mutation of the same property unless the user requested iteration or screenshot feedback shows it needs correction.
After each tool round, a rendering of supported objects, including queued changes, is attached automatically.
It is not a native editor capture: notes, images, freehand, rich formatting, and native-only styles are omitted or approximated.
Use it to check supported-object positions and directions. Fix incorrect drawings with tools rather than reporting failure merely because a drawing is wrong.
`;

export async function generateResponse(prompt: string, signal: AbortSignal, send: (event: ChatEvent) => void): Promise<void> {
  const messages: AgentMessage[] = [{ role: "user", content: prompt }];
  let images: string[] = [];

  try {
    for (let round = 0; round < 8; round++) {
      signal.throwIfAborted();
      const extractor = createResponseExtractor();
      let streamed = "";
      let extractionFailed = false;
      const attached = images;
      images = [];
      let answer: string;
      try {
        answer = await askCodex({
          instructions: BASE_INSTRUCTIONS,
          prompt: JSON.stringify(messages),
          images: attached,
          signal,
          onDelta(chunk) {
            if (signal.aborted || extractionFailed) return;
            let delta: string;
            try {
              delta = extractor.push(chunk);
            } catch {
              // Bad model text must not crash the shared JSON-RPC transport.
              extractionFailed = true;
              return;
            }
            if (delta) {
              streamed += delta;
              send({ type: "delta", text: delta });
            }
          },
        });
      } finally {
        await Promise.all(attached.map((path) => rm(path, { force: true })));
      }
      signal.throwIfAborted();

      let response: z.infer<typeof AgentResponseSchema>;
      try {
        const fenced = answer.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
        response = AgentResponseSchema.parse(JSON.parse(fenced ? fenced[1] : answer));
      } catch (error) {
        send({ type: "reset" });
        messages.push({
          role: "error",
          content: {
            message: "Return one valid response object with status success, failure, or tool_call and the matching res value.",
            details: error instanceof z.ZodError ? error.issues : "The reply was not valid JSON.",
          },
        });
        continue;
      }

      if (response.status !== "tool_call") {
        // The validated answer is authoritative, even if deltas were missing or differed.
        if (streamed !== response.res) send({ type: "replace", text: response.res });
        return;
      }

      if (streamed) send({ type: "reset" });
      const calls = response.res.map((call) => ({ ...call, call_id: `call_${crypto.randomUUID()}` }));
      messages.push({ role: "assistant", content: calls });
      for (const call of calls) {
        signal.throwIfAborted();
        const tool = toolDescriptions.find((tool) => tool.tool_name === call.tool_name);
        const result = tool
          ? tool.execute(call.arguments)
          : { success: false, message: `Unknown tool: ${call.tool_name}. Use one of the provided tools.` };
        messages.push({ role: "tool_call_result", specific: call.tool_name, call_id: call.call_id, content: result });
      }

      const shot = writeBoardScreenshot(listObjects());
      images = [shot.imagePath];
      messages.push({
        role: "board_screenshot",
        content: `Supported-object rendering attached (${shot.width} × ${shot.height} pixels). World Y increases upward. Native-only content is not shown.`,
      });
    }
    send({ type: "replace", text: "Stopped before a final answer. Any completed board changes have been kept." });
  } finally {
    await Promise.all(images.map((path) => rm(path, { force: true })));
  }
}
