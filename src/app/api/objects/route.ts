import { z } from "zod";
import { BoardObjectSchema, DeleteObjectSchema, ObjectPatchSchemas, StoredObjectSchema, UpdateObjectSchema } from "@/lib/whiteboard/schemas";
import { createShape, createTextbox, deleteObject, listObjects, updateObject } from "@/lib/whiteboard/services";
import { equalValues } from "@/lib/whiteboard/object-values";

const CreateRequestSchema = z.preprocess(
  (input) => input && typeof input === "object" && !Array.isArray(input) ? { rotation: 0, ...input } : input,
  z.intersection(BoardObjectSchema, z.object({ id: z.string().min(1).optional() })),
);
const UpdateRequestSchema = UpdateObjectSchema.extend({
  expected: z.record(z.string(), z.unknown()).optional(),
});
const DeleteRequestSchema = DeleteObjectSchema.extend({ expected: StoredObjectSchema.optional() });

export async function GET() {
  return Response.json(listObjects(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const parsed = CreateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

  // Stable client IDs make create retries idempotent.
  const { id, ...object } = parsed.data;
  const existing = id && listObjects().find((item) => item.id === id);
  if (existing) return Response.json(existing);
  const created = object.object === "textbox" ? createTextbox(object, id) : createShape(object, id);
  return Response.json(created.obj);
}

export async function PATCH(request: Request) {
  const parsed = UpdateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

  const { id, patch, expected } = parsed.data;
  const current = listObjects().find((item) => item.id === id);
  if (!current && expected) return Response.json({ error: "This object was deleted elsewhere." }, { status: 409 });
  if (current && expected) {
    // A null expected value represents an absent optional field in JSON requests.
    const fields = Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, value ?? undefined]));
    const checked = ObjectPatchSchemas[current.object].safeParse(fields);
    if (!checked.success) return Response.json({ error: checked.error.issues }, { status: 400 });
    const values = current as unknown as Record<string, unknown>;
    const updates = patch as Record<string, unknown>;
    const conflict = Object.entries(checked.data).some(([key, value]) =>
      !equalValues(values[key], value) && !equalValues(values[key], updates[key]),
    );
    if (conflict) return Response.json({ error: "This object was changed elsewhere. The server version was kept." }, { status: 409 });
  }

  const result = updateObject({ id, patch });
  return result.success ? Response.json(result) : Response.json({ error: result.message }, { status: 400 });
}

export async function DELETE(request: Request) {
  const parsed = DeleteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

  const { id, expected } = parsed.data;
  const current = listObjects().find((item) => item.id === id);
  if (!current && expected) return Response.json({ success: true });
  if (current && expected && !equalValues(current, expected)) {
    return Response.json({ error: "This object changed before deletion. The server version was kept." }, { status: 409 });
  }
  const result = deleteObject({ id });
  return result.success ? Response.json(result) : Response.json({ error: result.message }, { status: 400 });
}
