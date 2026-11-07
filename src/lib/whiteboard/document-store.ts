import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { TLStoreSnapshot, TLShapeId } from "tldraw";
import { StoredObjectSchema, type StoredObjectSchemaType } from "./schemas.ts";
import { validateDocument } from "./document-schema.ts";

const BoardCommandSchema = z.discriminatedUnion("kind", [
  z.object({ seq: z.number().int().positive(), kind: z.literal("put"), object: StoredObjectSchema }),
  z.object({ seq: z.number().int().positive(), kind: z.literal("delete"), id: z.string().min(1) }),
  z.object({ seq: z.number().int().positive(), kind: z.literal("clear") }),
]);
const SavedBoardSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  document: z.unknown(),
  projection: StoredObjectSchema.array(),
  commands: BoardCommandSchema.array(),
});

export type BoardCommand = z.infer<typeof BoardCommandSchema>;
type NewCommand =
  | { kind: "put"; object: StoredObjectSchemaType }
  | { kind: "delete"; id: string }
  | { kind: "clear" };
export type SavedBoard = {
  version: 1;
  revision: number;
  document: TLStoreSnapshot | null;
  projection: StoredObjectSchemaType[];
  commands: BoardCommand[];
  sequence: number;
};
export class BoardConflict extends Error {}
export class BoardValidationError extends Error {}

/** Local, single-process repository. Publish state only after atomically replacing its file. */
export class DocumentRepository {
  private state: SavedBoard;
  private readonly path: string;

  constructor(path: string, legacy: StoredObjectSchemaType[] = []) {
    this.path = path;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      this.state = { version: 1, revision: 0, document: null, projection: [], commands: [], sequence: 0 };
      for (const object of StoredObjectSchema.array().parse(legacy)) this.enqueue({ kind: "put", object });
      return;
    }

    const parsed = SavedBoardSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error("Invalid saved board", { cause: parsed.error });
    const saved = parsed.data;
    // Unacknowledged commands must be the contiguous tail of the sequence.
    const firstSequence = saved.sequence - saved.commands.length + 1;
    if (saved.commands.some((command, index) => command.seq !== firstSequence + index)) {
      throw new Error("Invalid command sequence");
    }
    this.state = { ...saved, document: saved.document === null ? null : validateDocument(saved.document) };
  }

  read(): SavedBoard {
    return structuredClone(this.state);
  }

  view(): StoredObjectSchemaType[] {
    const objects = new Map(this.state.projection.map((object) => [object.id, object]));
    for (const command of this.state.commands) {
      if (command.kind === "clear") objects.clear();
      else if (command.kind === "delete") objects.delete(command.id);
      else objects.set(command.object.id, command.object);
    }
    return structuredClone([...objects.values()]);
  }

  private publish(next: SavedBoard) {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(next));
      const fd = openSync(temporary, "r");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    this.state = next;
  }

  enqueue(command: NewCommand) {
    const validated = BoardCommandSchema.parse({ ...command, seq: this.state.sequence + 1 });
    const next = { ...this.state, sequence: validated.seq, commands: [...this.state.commands, validated] };
    this.publish(next);
  }

  commit(expectedRevision: number, acknowledged: number, document: unknown, projection: unknown) {
    if (expectedRevision !== this.state.revision) throw new BoardConflict("The board was saved from another tab. Reload before continuing.");
    if (acknowledged !== this.state.sequence) throw new BoardConflict("New agent edits arrived. Apply them before saving.");

    let validated: TLStoreSnapshot;
    let objects: StoredObjectSchemaType[];
    try {
      validated = validateDocument(document);
      objects = StoredObjectSchema.array().parse(projection);
      const ids = new Set<string>();
      for (const object of objects) {
        const id = (object.id.startsWith("shape:") ? object.id : `shape:${object.id}`) as TLShapeId;
        if (validated.store[id]?.typeName !== "shape" || ids.has(id)) throw new Error("Invalid compatibility projection");
        ids.add(id);
      }
    } catch (error) {
      throw new BoardValidationError(error instanceof Error ? error.message : "Invalid board save", { cause: error });
    }

    const next: SavedBoard = {
      version: 1,
      revision: this.state.revision + 1,
      document: validated,
      projection: objects,
      commands: [],
      sequence: this.state.sequence,
    };
    this.publish(next);
    return next.revision;
  }
}

const root = globalThis as typeof globalThis & {
  whiteboardDocumentRepository?: DocumentRepository;
  whiteboardObjects?: StoredObjectSchemaType[];
};

export function getBoardRepository() {
  return root.whiteboardDocumentRepository ??= new DocumentRepository(
    process.env.WHITEBOARD_DATA_PATH ?? resolve(process.cwd(), ".data/whiteboard.json"),
    root.whiteboardObjects ?? [],
  );
}
