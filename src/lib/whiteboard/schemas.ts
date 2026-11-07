import { z } from "zod";

const ShapeBaseSchema = z.object({
    x: z.number().describe("World X. Origin is bottom-left; X increases to the right."),
    y: z.number().describe("World Y. Origin is bottom-left; Y increases upward. Larger y is visually above; smaller y is visually below."),
    strokeColor: z.string().min(1),
    fillColor: z.string().min(1),
    fillOpacity: z.number().min(0).max(1).optional(),
    strokeWidth: z.number().nonnegative(),
    rotation: z.number().describe("Degrees counterclockwise around the object center. 0 is unrotated. Y increases upward, so 90 turns the object's right side toward the top of the board."),
    label: z.string().optional().describe("Optional text drawn in a small box on the object. An empty string draws nothing. Position comes from labelX and labelY."),
    labelX: z.number().optional().describe("Label center as a fraction of the object width. 0 is the left edge, 1 is the right edge, 0.5 is the middle. Values may sit slightly outside 0..1 so the text can hang off an edge."),
    labelY: z.number().optional().describe("Label center as a fraction of the object height. 0 is the bottom edge, 1 is the top edge, 0.5 is the middle. Y increases upward."),
    labelFontSize: z.number().positive().optional(),
    labelColor: z.string().min(1).optional(),
    labelBackground: z.string().min(1).optional(),
});

export const CircleSchema = ShapeBaseSchema.extend({
    object: z.literal("circle"),
    r: z.number().positive(),
}).describe("Circle. (x, y) is the center in world coordinates (y-up).");

export const RectSchema = ShapeBaseSchema.extend({
    object: z.literal("rect"),
    w: z.number().positive(),
    h: z.number().positive()
}).describe("Rectangle. (x, y) is the bottom-left corner in world coordinates (y-up). The rectangle extends right by w and up by h.");

export const PolygonSchema = ShapeBaseSchema.extend({
    object: z.literal("polygon"),
    points: z.array(z.object({
        x: z.number().describe("Vertex world X. Origin is bottom-left; X increases to the right."),
        y: z.number().describe("Vertex world Y. Origin is bottom-left; Y increases upward."),
    })).min(3).describe("Absolute world vertices. Y increases upward, so a vertex with a larger y is visually above one with a smaller y.")
}).describe("Polygon. Drawn from points in world coordinates (y-up). (x, y) should match the first point.");

export const ArrowSchema = ShapeBaseSchema.extend({
    object: z.literal("arrow"),
    x2: z.number().describe("Tip world X. The arrow points toward (x2, y2)."),
    y2: z.number().describe("Tip world Y. Origin is bottom-left; Y increases upward."),
}).describe("Arrow. (x, y) is the tail. (x2, y2) is the tip. Y increases upward.");

export const TextboxSchema = ShapeBaseSchema.extend({
    object: z.literal("textbox"),
    w: z.number().positive(),
    h: z.number().positive(),
    text: z.string().min(1).describe("Text shown inside the box."),
    fontSize: z.number().positive().describe("Font size in world units (same space as w and h)."),
    textColor: z.string().min(1),
}).describe("Textbox. (x, y) is the bottom-left corner in world coordinates (y-up). The box extends right by w and up by h. Text is drawn inside that box.");

const StoredShapeSchema = z.object({
    id: z.string().min(1),
});

export type ShapeBaseSchemaType = z.infer<typeof ShapeBaseSchema>;
export type CircleSchemaType = z.infer<typeof CircleSchema>;
export type RectSchemaType = z.infer<typeof RectSchema>;
export type PolygonSchemaType = z.infer<typeof PolygonSchema>;
export type ArrowSchemaType = z.infer<typeof ArrowSchema>;
export type TextboxSchemaType = z.infer<typeof TextboxSchema>;

export const CreateShapeSchema = z.discriminatedUnion("object", [CircleSchema, RectSchema, PolygonSchema, ArrowSchema]);
export type CreateShapeSchemaType = z.infer<typeof CreateShapeSchema>;

export const BoardObjectSchema = z.discriminatedUnion("object", [CircleSchema, RectSchema, PolygonSchema, ArrowSchema, TextboxSchema]);
export type BoardObjectSchemaType = z.infer<typeof BoardObjectSchema>;

export const StoredObjectSchema = z.intersection(StoredShapeSchema, BoardObjectSchema)
export type StoredObjectSchemaType = z.infer<typeof StoredObjectSchema>;

export const DeleteObjectSchema = z.strictObject({
    id: z.string().min(1)
})
export type DeleteObjectSchemaType = z.infer<typeof DeleteObjectSchema>;

export const NoArgumentsSchema = z.strictObject({});
export type NoArgumentsSchemaType = z.infer<typeof NoArgumentsSchema>;



// update schemas
const RectUpdateSchema = RectSchema
    .omit({ object: true })
    .partial()
    .strict();

const CircleUpdateSchema = CircleSchema
    .omit({ object: true })
    .partial()
    .strict();

const PolygonUpdateSchema = PolygonSchema
    .omit({ object: true })
    .partial()
    .strict();

const ArrowUpdateSchema = ArrowSchema
    .omit({ object: true })
    .partial()
    .strict();

const TextboxUpdateSchema = TextboxSchema
    .omit({ object: true })
    .partial()
    .strict();

export const UpdateObjectSchema = z.object({
    id: z.string().min(1),
    patch: z.union([
        RectUpdateSchema,
        CircleUpdateSchema,
        PolygonUpdateSchema,
        ArrowUpdateSchema,
        TextboxUpdateSchema,
    ]),
});

export type UpdateObjectSchemaType = z.infer<typeof UpdateObjectSchema>;

export const ObjectPatchSchemas = {
    rect: RectUpdateSchema,
    circle: CircleUpdateSchema,
    polygon: PolygonUpdateSchema,
    arrow: ArrowUpdateSchema,
    textbox: TextboxUpdateSchema,
};
