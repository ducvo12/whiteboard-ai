# Whiteboard AI

An interactive whiteboard with a Codex-powered assistant for drawing diagrams and explaining ideas. Built with Next.js, React, and tldraw.

## Features

- Drawing tools, editable polygons, and movable labels
- AI-assisted drawing with streamed answers and Markdown/LaTeX support
- Automatic local saves, board download/restore, and undo/redo
- Responsive canvas with collapsible chat and Cartesian axes

## Run locally

Requires Node.js 22.18+ and npm.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000).

## Connect Codex

Install the [Codex CLI](https://github.com/openai/codex) and sign in with your ChatGPT account using file-backed authentication:

```sh
codex -c 'cli_auth_credentials_store="file"' login
```

The app automatically uses your existing login. On macOS, it checks the ChatGPT app's bundled CLI before `codex` on `PATH`. To select a different executable, set `CODEX_BIN` in `.env.local`; see `.env.example` for optional settings. Use `npm run dev` for AI chat.
