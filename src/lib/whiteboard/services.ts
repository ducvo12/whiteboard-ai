import { getBoardRepository } from "./document-store.ts";
import { equalValues } from "./object-values.ts";
import {
  ObjectPatchSchemas, StoredObjectSchema,
  type BoardObjectSchemaType, type UpdateObjectSchemaType, type CreateShapeSchemaType,
  type DeleteObjectSchemaType, type TextboxSchemaType,
} from "./schemas.ts";

export function listObjects() {
  return getBoardRepository().view();
}

function createObject(input: BoardObjectSchemaType, id: string, message: string) {
  const obj = { ...input, id };
  getBoardRepository().enqueue({ kind: "put", object: obj });
  return { message, obj };
}

export function createShape(input: CreateShapeSchemaType, id = crypto.randomUUID()) {
  return createObject(input, id, "shape created");
}

export function createTextbox(input: TextboxSchemaType, id = crypto.randomUUID()) {
  return createObject(input, id, "textbox created");
}

export function deleteObject(input: DeleteObjectSchemaType) {
  if (!listObjects().some((object) => object.id === input.id)) {
    return { success: false, message: `Object with id ${input.id} not found` };
  }
  getBoardRepository().enqueue({ kind: "delete", id: input.id });
  return { success: true, deleted_id: input.id };
}

export function clearObjects() {
  getBoardRepository().enqueue({ kind: "clear" });
  return { success: true };
}

export function updateObject(input: UpdateObjectSchemaType) {
  const current = listObjects().find((object) => object.id === input.id);
  if (!current) return { success: false, message: `Object with id ${input.id} not found` };

  const patch = ObjectPatchSchemas[current.object].safeParse(input.patch);
  if (!patch.success) {
    return { success: false, message: `Invalid ${current.object} update`, error: patch.error.issues };
  }
  const parsed = StoredObjectSchema.safeParse({ ...current, ...patch.data });
  if (!parsed.success) {
    return { success: false, message: "Invalid updated object", error: parsed.error.issues };
  }

  const oldValues = Object.fromEntries(Object.keys(patch.data).map((key) => [key, current[key as keyof typeof current]]));
  if (!equalValues(current, parsed.data)) {
    getBoardRepository().enqueue({ kind: "put", object: parsed.data });
  }
  return { success: true, old_values: oldValues, new_values: patch.data };
}
