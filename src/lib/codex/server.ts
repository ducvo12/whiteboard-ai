import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { CODEX_CONFIG_ARGS, CODEX_POLICY_VERSION } from "./policy.ts";
import { join } from "node:path";

type TurnResult = { status: string; error?: { message: string } | null };
type Message = {
  id?: number; method?: string; result?: unknown;
  error?: { message: string };
  params?: { delta?: string; threadId?: string; item?: { type: string; text?: string }; turn?: TurnResult };
};
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type ActiveTurn = { onDelta?: (delta: string) => void; text: string; resolve: (text: string) => void; reject: (error: Error) => void };

export type CodexRequest = {
  instructions: string;
  prompt: string;
  images?: string[];
  signal: AbortSignal;
  onDelta?: (delta: string) => void;
};

class CodexServer {
  private child: ChildProcessWithoutNullStreams;
  readonly policyVersion = CODEX_POLICY_VERSION;
  private isolatedHome: string;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private turns = new Map<string, ActiveTurn>();
  readonly ready: Promise<unknown>;
  alive = true;
  readonly binary: string;

  constructor(binary: string) {
    this.binary = binary;
    // Load only the existing login, not personal config, skills, plugins, or history.
    const authHome = process.env.CODEX_HOME || join(homedir(), ".codex");
    this.isolatedHome = mkdtempSync(join(tmpdir(), "whiteboard-codex-"));
    const codexHome = join(this.isolatedHome, ".codex");
    mkdirSync(codexHome, { mode: 0o700 });
    symlinkSync(join(authHome, "auth.json"), join(codexHome, "auth.json"));
    this.child = spawn(binary, ["app-server", "--listen", "stdio://", ...CODEX_CONFIG_ARGS], {
      cwd: this.isolatedHome,
      env: {
        ...process.env,
        HOME: this.isolatedHome,
        CODEX_HOME: codexHome,
        TMPDIR: tmpdir(),
      },
      stdio: "pipe",
    });
    // Drain diagnostic output without exposing credentials or prompts to the client.
    this.child.stderr.resume();
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try { this.receive(JSON.parse(line)); }
      catch (error) {
        console.error("Codex response processing failed:", error);
        this.stop(new Error("Invalid Codex server response.", { cause: error }));
      }
    });
    this.child.on("error", (error) => this.stop(error));
    this.child.on("exit", () => {
      this.stop(new Error("Codex server exited."));
    });
    // close also fires when spawning fails before an exit event is possible.
    this.child.on("close", () => {
      rmSync(this.isolatedHome, { recursive: true, force: true });
    });
    this.child.stdin.on("error", (error) => this.stop(error));
    this.ready = this.request("initialize", {
      clientInfo: { name: "whiteboard_chat", version: "0.1.0" },
    }).then(() => this.send({ method: "initialized", params: {} }));
  }

  private send(message: unknown) {
    if (!this.alive) throw new Error("Codex server is unavailable.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      try { this.send({ id, method, params }); }
      catch (error) {
        this.pending.get(id)?.reject(error as Error);
        this.pending.delete(id);
      }
    });
  }

  private receive(message: Message) {
    if (message.id !== undefined) {
      if (message.method) {
        // This chat client does not execute tools or grant agent approvals.
        this.send({ id: message.id, error: { code: -32601, message: "Tools are unavailable in this chat client." } });
        return;
      }
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error.message));
      else pending?.resolve(message.result);
      return;
    }
    const params = message.params;
    if (message.method === "item/started" && params?.item &&
      !["userMessage", "agentMessage", "reasoning", "imageView"].includes(params.item.type)) {
      this.stop(new Error("Unexpected agent activity; text-only session stopped."));
      return;
    }
    const turn = params?.threadId ? this.turns.get(params.threadId) : undefined;
    if (!turn) return;
    if (message.method === "item/agentMessage/delta" && params?.delta) {
      turn.onDelta?.(params.delta);
    }
    if (message.method === "item/completed" && params?.item?.type === "agentMessage") {
      turn.text = params.item.text || "";
    }
    if (message.method === "turn/completed") {
      if (params?.turn?.status === "completed" && turn.text.trim()) turn.resolve(turn.text.trim());
      else turn.reject(new Error(params?.turn?.error?.message || "Codex returned no answer."));
    }
  }

  stop(error = new Error("Codex server stopped.")) {
    if (!this.alive) return;
    this.alive = false;
    this.child.kill();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const turn of this.turns.values()) turn.reject(error);
    this.turns.clear();
  }

  async answer({ instructions, prompt, images = [], signal, onDelta }: CodexRequest) {
    await this.ready;
    signal.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), "whiteboard-chat-"));
    let threadId: string | undefined;
    try {
      const result = await this.request("thread/start", {
        model: process.env.CODEX_MODEL || undefined,
        modelProvider: "openai", cwd: directory, ephemeral: true,
        approvalPolicy: "never", personality: "none",
        baseInstructions: instructions,
      }) as { thread: { id: string } };
      threadId = result.thread.id;
      signal.throwIfAborted();
      return await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => { this.stop(new Error("Codex response timed out.")); }, 120_000);
        const abort = () => this.stop(new Error("Request cancelled."));
        const finish = (error?: Error, text?: string) => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", abort);
          this.turns.delete(threadId!);
          if (error) reject(error);
          else resolve(text!);
        };
        this.turns.set(threadId!, { text: "", onDelta, resolve: (text) => finish(undefined, text), reject: finish });
        signal.addEventListener("abort", abort, { once: true });
        void this.request("turn/start", {
          threadId,
          input: [
            { type: "text", text: prompt },
            ...images.map((path) => ({ type: "localImage", path })),
          ],
        }).catch((error) => finish(error));
      });
    } finally {
      // Completed ephemeral threads are unloaded after the no-subscriber grace period.
      if (threadId && this.alive) await this.request("thread/unsubscribe", { threadId }).catch(() => { });
      await rm(directory, { recursive: true, force: true });
    }
  }
}

// Preserve one child process across requests and Next.js development hot reloads.
const shared = globalThis as typeof globalThis & { whiteboardCodex?: CodexServer };
const BUNDLED_CODEX = [
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
  "/Applications/ChatGPT.app/Contents/Resources/codex",
];

function codexBinary(): string {
  const configured = process.env.CODEX_BIN;
  if (configured) return configured;
  const bundled = BUNDLED_CODEX.find((path) => existsSync(path));
  if (bundled) return bundled;
  return "codex";
}

function getCodex(): CodexServer {
  const binary = codexBinary();
  if (!shared.whiteboardCodex?.alive || shared.whiteboardCodex.binary !== binary || shared.whiteboardCodex.policyVersion !== CODEX_POLICY_VERSION) {
    shared.whiteboardCodex?.stop();
    shared.whiteboardCodex = new CodexServer(binary);
  }
  return shared.whiteboardCodex;
}

export async function askCodex(request: CodexRequest): Promise<string> {
  const codex = getCodex();

  try {
    return await codex.answer(request);
  } catch (error) {
    // A failed initialization must not poison the singleton for later requests.
    await codex.ready.catch(() => codex.stop());
    throw error;
  }
}
