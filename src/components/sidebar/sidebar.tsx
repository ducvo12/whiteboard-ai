"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import AIResponse from "./ai-response";
import { readChatEvents } from "@/lib/agent/chat-events";

const EXAMPLES = [
    "Draw a login flowchart",
    "Add a labeled box",
    "Clear and start over",
];

export default function Sidebar({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [prompt, setPrompt] = useState("");
    const [response, setResponse] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const requestRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (open) textareaRef.current?.focus();
    }, [open]);

    useEffect(() => () => requestRef.current?.abort(), []);

    async function send(nextPrompt: string) {
        const text = nextPrompt.trim();
        if (requestRef.current || !text) return;
        const cancellation = new AbortController();
        requestRef.current = cancellation;
        setLoading(true);
        setError("");
        setResponse("");
        setPrompt("");
        try {
            const result = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: text }),
                signal: cancellation.signal,
            });

            if (!result.ok) {
                const data = await result.json();
                throw new Error(data.error || "Something went wrong. Try again.");
            }
            if (!result.body) throw new Error("No response stream. Try again.");

            await readChatEvents(result.body, (event) => {
                if (event.type === "delta") setResponse((current) => current + event.text);
                else if (event.type === "replace") setResponse(event.text);
                else if (event.type === "reset") setResponse("");
            });
        } catch (err) {
            if (!cancellation.signal.aborted) {
                setError(err instanceof Error ? err.message : "Could not connect. Try again.");
            }
        } finally {
            requestRef.current = null;
            setLoading(false);
        }
    }

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void send(prompt);
    }

    function onEnterKey(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send(prompt);
        }
    }

    return (
        <>
            <aside
                className={`chat-panel${open ? " is-open" : ""}`}
                aria-label="Ask AI"
                aria-hidden={!open}
            >
                <header className="chat-header">
                    <div>
                        <div className="eyebrow">Whiteboard</div>
                        <h1>Ask AI</h1>
                        <p>Each prompt starts fresh.</p>
                    </div>
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label="Close chat"
                        onClick={() => onOpenChange(false)}
                    >
                        <CloseIcon />
                    </button>
                </header>

                <section className="chat-transcript" aria-label="AI response" aria-busy={loading}>
                    {response ? (
                        <AIResponse content={response} />
                    ) : loading ? (
                        <p className="muted">Working on the board…</p>
                    ) : (
                        <div className="chat-empty">
                            <p className="muted">Your answer will appear here.</p>
                            <div className="chips">
                                {EXAMPLES.map((example) => (
                                    <button
                                        key={example}
                                        type="button"
                                        className="chip"
                                        disabled={loading}
                                        onClick={() => {
                                            setPrompt(example);
                                            void send(example);
                                        }}
                                    >
                                        {example}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {error && (
                        <p className="error" role="alert">
                            {error}
                        </p>
                    )}
                </section>

                <form className="composer" onSubmit={submit}>
                    <label htmlFor="prompt">Your prompt</label>
                    <textarea
                        ref={textareaRef}
                        id="prompt"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        onKeyDown={onEnterKey}
                        placeholder="What should appear on the board?"
                        maxLength={20_000}
                        rows={3}
                        required
                    />
                    <div className="form-footer">
                        <span>Enter to send · Shift+Enter for a new line</span>
                        <button className="btn" type="submit" disabled={loading || !prompt.trim()}>
                            {loading ? "Working…" : (
                                <>
                                    Send
                                    <SendIcon />
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </aside>

            {!open && (
                <button
                    type="button"
                    className="chat-fab"
                    onClick={() => onOpenChange(true)}
                    aria-expanded={false}
                >
                    Ask AI
                </button>
            )}
        </>
    );
}

function CloseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    );
}

function SendIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M5 12h14M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
