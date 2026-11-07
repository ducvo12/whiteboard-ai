import "server-only";
import { z } from "zod";
import { CreateShapeSchema, DeleteObjectSchema, NoArgumentsSchema, TextboxSchema, UpdateObjectSchema } from "../whiteboard/schemas.ts";
import { createShape, createTextbox, deleteObject, listObjects, updateObject } from "../whiteboard/services.ts";

function defineTool<T extends z.ZodType>(
  name: string,
  description: string,
  schema: T,
  execute: (input: z.output<T>) => unknown,
) {
  return {
    tool_name: name,
    tool_description: description,
    arguments: z.toJSONSchema(schema),
    execute(input: unknown) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) return { success: false, message: "Invalid tool arguments", error: parsed.error.issues };
      return execute(parsed.data);
    },
  };
}

export const toolDescriptions = [
  defineTool("get_objects", "Returns all supported objects on the whiteboard.", NoArgumentsSchema, listObjects),
  defineTool("add_shape", "Adds a rect, circle, polygon, or arrow to the canvas.", CreateShapeSchema, createShape),
  defineTool("add_textbox", "Adds a textbox to the canvas.", TextboxSchema, createTextbox),
  defineTool("delete_object", "Deletes an object with the given id.", DeleteObjectSchema, deleteObject),
  defineTool("update_object", "Updates an object with the given id. labelX and labelY position a label relative to its bounds: 0 is left/bottom, 0.5 is middle, 1 is right/top; values outside 0..1 are allowed.", UpdateObjectSchema, updateObject),
];
