import { z } from "zod";
import { BoardConflict, BoardValidationError, getBoardRepository } from "@/lib/whiteboard/document-store";

export const runtime = "nodejs";

const SaveRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  acknowledged: z.number().int().nonnegative(),
  document: z.unknown(),
  projection: z.unknown(),
});

export async function GET() {
  try {
    return Response.json(getBoardRepository().read(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Board read failed:", error);
    return Response.json({ error: "Saved board could not be read. The stored file has been kept intact." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 30_000_000) {
    return Response.json({ error: "Board exceeds the 30 MB local storage limit." }, { status: 413 });
  }
  let input;
  try {
    input = SaveRequestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return Response.json({ error: "Send a valid board save with nonnegative integer revisions." }, { status: 400 });
  }

  try {
    const revision = getBoardRepository().commit(input.expectedRevision, input.acknowledged, input.document, input.projection);
    return Response.json({ revision });
  } catch (error) {
    if (error instanceof BoardConflict) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof BoardValidationError) return Response.json({ error: error.message }, { status: 400 });
    console.error("Board save failed:", error);
    return Response.json({ error: "The board could not be written. Check the server's data path and available disk space." }, { status: 500 });
  }
}
