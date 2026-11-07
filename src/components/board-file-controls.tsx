"use client";

import { useRef, useState } from "react";
import { getSnapshot, loadSnapshot, useEditor, useValue } from "tldraw";
import { validateDocument } from "@/lib/whiteboard/document-schema";
import { UNSAVED_BOARD_KEY } from "@/lib/whiteboard/tldraw-sync";

export function useBoardFiles() {
  const editor = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const readonly = useValue("board file readonly", () => editor.getIsReadonly(), [editor]);

  function restore(text: string) {
    const document = validateDocument(JSON.parse(text));
    // Preserve the replaced board, where browser storage has enough room.
    try {
      localStorage.setItem(UNSAVED_BOARD_KEY, JSON.stringify(getSnapshot(editor.store).document));
    } catch {
      // Downloads remain available for boards larger than localStorage.
    }
    loadSnapshot(editor.store, { document });
    editor.clearHistory();
    editor.zoomToFit();
    setError("");
  }

  function download() {
    const document = getSnapshot(editor.store).document;
    const blob = new Blob([JSON.stringify(document)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = "whiteboard.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function recover() {
    try {
      const copy = localStorage.getItem(UNSAVED_BOARD_KEY);
      if (!copy) throw new Error("No recovery copy is available.");
      restore(copy);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Recovery failed.");
    }
  }

  return {
    download,
    recover,
    readonly,
    restoreFile: () => input.current?.click(),
    controls: <>
      <input
        hidden
        ref={input}
        type="file"
        accept="application/json,.json"
        aria-label="Restore board file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            if (file.size > 30_000_000) throw new Error("Board exceeds the 30 MB limit.");
            restore(await file.text());
          } catch (error) {
            setError(error instanceof Error ? error.message : "Restore failed.");
          }
        }}
      />
      {error && <div className="board-file-error" role="alert">
        {error}{" "}
        <button aria-label="Dismiss board file error" onClick={() => setError("")}>Dismiss</button>
      </div>}
    </>,
  };
}
