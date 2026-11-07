# Whiteboard AI

An interactive whiteboard with an AI assistant that can draw diagrams, arrange shapes, and explain ideas alongside the canvas. Built with Next.js, React, and tldraw, with a local Codex integration for AI requests.

**Status:** a locally runnable prototype; there is no hosted demo yet. The editor works independently of AI setup.

## Features

- **Native drawing tools:** shapes, freehand, arrows, text, notes, images, grouping, and undo/redo through tldraw.
- **Editable polygons:** draggable vertices, native fill/stroke styles, and controls to add or remove vertices.
- **Advanced labels:** independently positioned annotations that follow their parent shape when moved, resized, or rotated.
- **AI-assisted drawing:** supported shape tools, screenshot feedback between tool rounds, streamed answers, and Markdown/LaTeX rendering.
- **Local persistence:** the full native document survives refreshes and server restarts, including assets, bindings, styles, and rich text.
- **Board files:** download and restore the complete document as JSON, with a recovery copy when browser storage permits.
- **Responsive workspace:** collapsible chat, Cartesian axes, and a Y-up pointer readout.

Try prompts such as **“Draw a login flowchart”** or **“Draw and label the forces on a block resting on an inclined plane.”** Each prompt starts a fresh conversation and can inspect the existing board with tools.

## Run locally

### Requirements

- Node.js **22.18 or newer** and npm. A current LTS release is recommended.
- For AI chat: a compatible [Codex CLI](https://github.com/openai/codex) with `app-server` support and a ChatGPT-backed login. The adapter uses a version-sensitive protocol; it has been developed against the CLI bundled with the macOS ChatGPT app.

### Start the editor

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Drawings are saved to `.data/whiteboard.json`, which is ignored by Git. No environment variables are required for the editor.

### Enable AI chat

If using a separately installed CLI, log in from your terminal:

```sh
codex -c 'cli_auth_credentials_store="file"' login
codex -c 'cli_auth_credentials_store="file"' login status
```

File-backed authentication is required because the adapter reads the existing `auth.json` login. It starts Codex with isolated configuration rather than loading personal skills, plugins, or project instructions.

On macOS, the app also checks these bundled executables before trying `codex` on `PATH`:

```text
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
/Applications/ChatGPT.app/Contents/Resources/codex
```

You can run the same login command using the executable's quoted full path. Set `CODEX_BIN` to explicitly select another executable. If using a custom `CODEX_HOME`, use that same directory when logging in.

Chat currently runs **only in development on localhost**. One prompt may run at a time across tabs; another request receives a busy message. Successful tool changes are retained even if a later tool or model request fails.

### Optional configuration

Use `.env.example` as a reference for `.env.local`. It contains commented examples and no credentials.

| Variable | Purpose |
| --- | --- |
| `CODEX_BIN` | Explicit Codex executable path or command name. |
| `CODEX_MODEL` | Model override; otherwise Codex uses its default. |
| `CODEX_HOME` | Existing login directory; defaults to `~/.codex`. |
| `WHITEBOARD_DATA_PATH` | Writable document-file path; defaults to `.data/whiteboard.json`. |
| `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | Appropriate tldraw license key for your intended use. |

## Saving, restoring, and conflicts

The **full tldraw document** is authoritative. A smaller supported-object projection lets the AI interact with it without discarding native-only content.

Agent edits enter a durable command queue. An open editor applies them to native shapes and saves the resulting document. Commands can remain queued while the editor is closed. Saves validate the document, check its revision, and atomically replace the file.

Use **Main menu → Board file** to:

- **Download board:** export the complete document as JSON.
- **Restore board:** validate and replace the current document from a downloaded file.
- **Recover copy:** restore the browser recovery copy after reloading.

Overlapping local/agent changes or competing tab saves stop synchronization instead of silently overwriting local work. Download the unsaved board before reloading. Where space permits, the app also preserves a browser recovery copy. Restoring a file keeps a recovery copy of the replaced document; invalid files leave the current board intact.

## How it works

```text
Browser editor ── full document + projection ── /api/board ── local JSON file
       ↑                                              ↑
       └──────── durable agent commands ──────────────┘
                                                      ↑
Chat sidebar ── /api/chat ── Codex ↔ validated tools ──┘
```

- **UI:** React 19 and tldraw, hosted by the Next.js 16 App Router. App-owned styling uses plain CSS in `src/app/globals.css`; Tailwind 4 remains configured as part of the existing CSS pipeline.
- **Board bridge:** converts between the agent's Cartesian Y-up coordinates and tldraw's Y-down coordinates. Field-level edits preserve unrelated native styling and local changes.
- **Storage:** a single-process repository with revision checks, validated document imports, and durable queued commands.
- **Agent:** a bounded tool loop with schema validation and supported-object PNG feedback. Typed stream events allow partial answers to be reset when an attempt must be retried.

### Source map

| Path | Responsibility |
| --- | --- |
| `src/app/` | Workspace, global styles, and HTTP routes. |
| `src/components/` | Editor integration, board controls, labels, and chat UI. |
| `src/lib/whiteboard/` | Document storage, validation, geometry, synchronization, and rendering. |
| `src/lib/agent/` | Tool definitions, agent loop, and chat-stream contract. |
| `src/lib/codex/` | Local Codex process and JSON-RPC transport. |
| `tests/` | Board, persistence, agent, streaming, and API regressions. |

## Development checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Unit tests use Node's built-in test runner and TypeScript stripping. External model calls are mocked; tests do not require a Codex login or modify your saved board. Node's module-mocking API is experimental, so its warning is expected.

The HTTP regression suite needs a running, isolated server. For example, in one terminal:

```sh
WHITEBOARD_DATA_PATH=/tmp/whiteboard-ai-api-test.json npm run dev -- --port 3100
```

Then in another:

```sh
TEST_BOARD_URL=http://localhost:3100 npm run test:api
```

Choose a fresh data-file path for each isolated run. API tests intentionally require `TEST_BOARD_URL` and create/delete test shapes on that server.

To run the compiled editor locally:

```sh
npm run build
npm start
```

AI chat remains disabled under `npm start`; use `npm run dev` for chat.

## Current limitations

- **Local, single-process storage:** one shared board per server, rather than separate user workspaces or multiplayer collaboration. Durable storage requires a writable filesystem.
- **Partial AI access:** tools support rectangles, circles, polygons, straight arrows, and textboxes. Other native content is preserved but is not exposed through those tools.
- **Approximate screenshot feedback:** `/api/screenshot` and agent screenshots render the supported-object projection, not the native editor. Native-only content, rich formatting, wrapping, dash/fill details, and overall opacity can differ.
- **Label exports:** advanced native-shape labels are HTML overlays and are not included in tldraw's native image/SVG exports. Full-document JSON exports retain them; polygon SVG exports include their labels.
- **File sizes:** board saves and restores have a 30 MB limit. Large documents may exceed browser recovery-storage capacity.
- **Hosting is future work:** the current local Codex adapter and single-process file repository are not a hosted-service backend.
