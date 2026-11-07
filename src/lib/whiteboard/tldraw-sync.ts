import { getSnapshot, loadSnapshot, type Editor, type TLShapeId } from "tldraw";
import { StoredObjectSchema, type BoardObjectSchemaType, type StoredObjectSchemaType } from "./schemas.ts";
import { assertCompatibleProjection, changedFields, serverObjectId, shapeId, shapeToObject } from "./tldraw-adapter.ts";
import { applyAgentObject } from "./apply-board-command.ts";
import { polygonLabelMigration } from "./polygon-label.ts";
import type { SavedBoard } from "./document-store";

export const UNSAVED_BOARD_KEY = "whiteboard-unsaved-document";

class BoardRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Save complete documents; the object projection exists only for agent tools. */
export function connectBoard(editor: Editor, report: (message: string) => void) {
  const controller = new AbortController();
  let stopped = false;
  let initialized = false;
  let blocked = false;
  let pending = false;
  let revision = -1;
  let sequence = 0;
  let generation = 0;
  let appliedSequence = 0;
  let timer: ReturnType<typeof setTimeout>;
  let base = new Map<string, StoredObjectSchemaType>();
  let nativeBase = new Map<TLShapeId, BoardObjectSchemaType>();

  editor.updateInstanceState({ isReadonly: true });
  report("Loading saved board…");
  const unsubscribe = editor.store.listen(() => {
    if (!initialized || blocked) return;
    generation++;
    pending = true;
    report("Saving board…");
  }, { source: "user", scope: "document" });
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!pending) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", beforeUnload);

  function nativeProjection() {
    const result = new Map<TLShapeId, BoardObjectSchemaType>();
    for (const shape of editor.store.allRecords()) {
      if (shape.typeName !== "shape") continue;
      const object = shapeToObject(editor, shape);
      if (object && StoredObjectSchema.safeParse({ ...object, id: serverObjectId(shape) }).success) {
        result.set(shape.id, object);
      }
    }
    return result;
  }

  function compatibilityProjection(native: Map<TLShapeId, BoardObjectSchemaType>) {
    return [...native].map(([id, object]) => {
      const shape = editor.getShape(id)!;
      const serverId = serverObjectId(shape);
      const old = base.get(serverId);
      const before = nativeBase.get(id);
      const projected = old && before && before.object === object.object
        ? { ...old, ...changedFields(before, object), id: serverId }
        : { ...object, id: serverId };

      // Polygon migration replaces legacy label fields with the actual shared label.
      if (shape.type === "board-object") {
        const fields = projected as unknown as Record<string, unknown>;
        const current = object as unknown as Record<string, unknown>;
        for (const key of ["label", "labelX", "labelY", "labelFontSize", "labelColor", "labelBackground"]) {
          if (key in current) fields[key] = current[key];
          else delete fields[key];
        }
      }
      return projected;
    });
  }

  async function request(method: "GET" | "PUT", body?: unknown) {
    const response = await fetch("/api/board", {
      method,
      cache: "no-store",
      signal: controller.signal,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new BoardRequestError(data.error ?? "Board storage is unavailable.", response.status);
    return data;
  }

  function protectLocalCopy(message: string) {
    blocked = true;
    pending = true;
    editor.updateInstanceState({ isReadonly: true });
    let saved = false;
    try {
      localStorage.setItem(UNSAVED_BOARD_KEY, JSON.stringify(getSnapshot(editor.store).document));
      saved = true;
    } catch {
      // Large boards can exceed localStorage; downloading remains available.
    }
    report(`${message} ${saved ? "An unsaved recovery copy is available." : "Keep this tab open."} Use Download board before reloading; Recover copy can restore it after reload.`);
  }

  function applyRemote(change: () => void) {
    const readonly = editor.getIsReadonly();
    editor.updateInstanceState({ isReadonly: false });
    try {
      editor.store.mergeRemoteChanges(() => editor.run(change, { ignoreShapeLock: true, history: "ignore" }));
    } finally {
      editor.updateInstanceState({ isReadonly: blocked || readonly });
    }
  }

  function load(state: SavedBoard) {
    applyRemote(() => {
      if (state.document) loadSnapshot(editor.store, { document: state.document });
      for (const record of editor.store.allRecords()) {
        if (record.typeName !== "shape") continue;
        const migration = polygonLabelMigration(record);
        if (migration) {
          editor.updateShape(migration);
          pending = true;
          generation++;
        }
      }
      editor.clearHistory();
    });
    base = new Map(state.projection.map((object) => [object.id, object]));
    nativeBase = nativeProjection();
    revision = state.revision;
    appliedSequence = state.commands.length ? state.commands[0].seq - 1 : state.sequence;
  }

  function applyCommands(state: SavedBoard) {
    applyRemote(() => {
      for (const command of state.commands.filter((command) => command.seq > appliedSequence)) {
        if (command.kind === "clear") {
          if (pending && initialized) throw new Error("The agent cleared the board while local edits were unsaved.");
          const shapes = editor.store.allRecords().filter((record) => record.typeName === "shape");
          editor.deleteShapes(shapes.map((shape) => shape.id));
          base.clear();
          nativeBase.clear();
          continue;
        }

        if (command.kind === "delete") {
          const id = shapeId(command.id);
          const shape = editor.getShape(id);
          const before = nativeBase.get(id);
          if (shape && before) {
            const current = shapeToObject(editor, shape);
            assertCompatibleProjection(before, current);
            if (current && Object.keys(changedFields(before, current)).length) {
              throw new Error("An agent deletion overlaps unsaved local edits.");
            }
          }
          editor.deleteShapes([id]);
          base.delete(command.id);
          nativeBase.delete(id);
          continue;
        }

        const id = shapeId(command.object.id);
        const existing = editor.getShape(id);
        const before = nativeBase.get(id);
        const current = existing ? shapeToObject(editor, existing) : null;
        const local = before && current ? changedFields(before, current) : {};
        applyAgentObject(editor, command.object, base.get(command.object.id), before);
        base.set(command.object.id, command.object);
        const updated = editor.getShape(id);
        const after = updated ? shapeToObject(editor, updated) : null;
        if (after) {
          // Keep unsaved local fields out of the remote baseline until they are committed.
          const baseline = { ...after } as Record<string, unknown>;
          const original = before as Record<string, unknown> | undefined;
          for (const key of Object.keys(local)) {
            if (original?.[key] === undefined) delete baseline[key];
            else baseline[key] = original[key];
          }
          nativeBase.set(id, baseline as BoardObjectSchemaType);
        }
      }
    });
    appliedSequence = state.sequence;
    generation++;
    pending = true;
  }

  async function save() {
    const savedGeneration = generation;
    const native = nativeProjection();
    const projection = compatibilityProjection(native);
    const document = getSnapshot(editor.store).document;
    try {
      const result = await request("PUT", { expectedRevision: revision, acknowledged: sequence, document, projection });
      if (stopped) return;
      revision = result.revision;
      base = new Map(projection.map((object) => [object.id, object]));
      nativeBase = native;
      pending = generation !== savedGeneration;
    } catch (error) {
      if (!(error instanceof BoardRequestError) || error.status !== 409) throw error;
      // A new command is applied on the next read; a competing save requires recovery.
      const latest = await request("GET") as SavedBoard;
      if (latest.revision !== revision) protectLocalCopy("Another tab saved while this board was saving.");
    }
  }

  async function tick() {
    try {
      if (editor.inputs.getIsPointing() || editor.getEditingShapeId()) return;
      const state = await request("GET") as SavedBoard;
      if (stopped || editor.inputs.getIsPointing() || editor.getEditingShapeId()) return;
      if (!initialized) load(state);
      else if (state.revision !== revision) {
        if (pending) {
          protectLocalCopy("Another tab saved a different board.");
          return;
        }
        load(state);
      }

      if (state.commands.some((command) => command.seq > appliedSequence)) {
        try {
          applyCommands(state);
        } catch (error) {
          protectLocalCopy(error instanceof Error ? error.message : "Agent edits conflict with local edits.");
          return;
        }
      }
      sequence = state.sequence;

      if (!initialized) {
        initialized = true;
        editor.updateInstanceState({ isReadonly: false });
        if (editor.getCurrentPageShapeIds().size) editor.zoomToFit();
        else editor.centerOnPoint({ x: 0, y: 0 });
        if (!state.document) {
          pending = true;
          generation++;
        }
      }
      if (pending) await save();
      if (!stopped && !blocked) report(pending ? "Saving board…" : "");
    } catch (error) {
      if (!stopped) report(`${error instanceof Error ? error.message : "Board storage is unavailable."} Your edits remain in this tab; saving will retry.`);
    } finally {
      if (!stopped && !blocked) timer = setTimeout(() => void tick(), 800);
    }
  }

  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
    unsubscribe();
    window.removeEventListener("beforeunload", beforeUnload);
  };
}
