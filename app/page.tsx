"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { interpret, type Interpretation } from "../lib/site/interpret";
import { applyOps, type EditOp } from "../lib/site/ops";
import { renderSite } from "../lib/site/render";
import { createStarterDocument, type SiteDocument } from "../lib/site/schema";
import { loadCanvasState, saveCanvasState, type Message } from "../lib/storage";

type Device = "desktop" | "tablet" | "mobile";

type SpeechRecognitionEventLike = { results: ArrayLike<{ 0: { transcript: string } }> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const suggestions = [
  "Make it dark with a lime accent",
  "Add a gallery, process section and footer",
  "Change the headline to Architecture for modern life",
  "Make it modern, spacious and rounded",
];

/**
 * The realtime session's only tool. It deliberately does NOT try to emit
 * EditOp[] itself — that would duplicate (and risk drifting from) the schema
 * knowledge already encoded in /api/edit's system prompt. It just captures
 * what the user asked for; the browser then routes that through the exact
 * same requestEdits() → applyOps pipeline a typed prompt uses.
 */
const UPDATE_SITE_TOOL = {
  type: "function",
  name: "update_site",
  description:
    "Call this whenever the user asks to change the website in any way — colors, theme, copy, headline, adding or removing sections, reordering things. Pass their request through in their own words; a separate system decides exactly what to change.",
  parameters: {
    type: "object",
    properties: {
      request: {
        type: "string",
        description: "The user's request, as close to their own words as possible.",
      },
    },
    required: ["request"],
  },
};

const VOICE_INSTRUCTIONS = `You are Nova, a voice assistant inside Canvas, a live website builder. The user watches a live preview update in real time while they talk to you.

Whenever the user asks for any change to the site, call the update_site function with their request in their own words right away — don't describe the change yourself first. Once you get the result back, briefly confirm what happened in a sentence or two.

If the user is just chatting, asking a question unrelated to editing the site, or asking what you can do, respond naturally without calling the tool. Keep replies brief and conversational — this is a spoken conversation, not a chat log.`;

type RealtimeSession = {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  audioEl: HTMLAudioElement;
  stream: MediaStream;
};

/**
 * Calls the real model at /api/edit. If it's unreachable, errors, or no
 * ANTHROPIC_API_KEY is configured, falls back to the deterministic
 * interpret() so the app still works offline.
 */
async function requestEdits(site: SiteDocument, prompt: string): Promise<Interpretation> {
  try {
    const response = await fetch("/api/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: site, prompt }),
    });
    if (response.ok) {
      return (await response.json()) as Interpretation;
    }
  } catch {
    // Network error or dev server not running the route — fall through.
  }
  return interpret(site, prompt);
}

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { from: "ai", text: "Tell me what to change. I'll rebuild the preview while you watch." },
  ]);
  const [site, setSite] = useState<SiteDocument>(createStarterDocument);
  const [versions, setVersions] = useState<SiteDocument[]>(() => [createStarterDocument()]);
  const [versionIndex, setVersionIndex] = useState(0);
  const [building, setBuilding] = useState(false);
  const [listening, setListening] = useState(false);
  const [camera, setCamera] = useState(false);
  const [status, setStatus] = useState("Ready for your direction");
  const [progress, setProgress] = useState(0);
  const [device, setDevice] = useState<Device>("desktop");
  const [toast, setToast] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const realtime = useRef<RealtimeSession | null>(null);
  const onUpdateSiteRef = useRef<(request: string, callId: string) => void>(() => {});

  const srcDoc = useMemo(() => renderSite(site, { base: "about:srcdoc" }), [site]);

  useEffect(() => {
    // Restoring from localStorage (a browser-only external system) has to
    // happen after mount, not in a useState initializer — reading it during
    // render would run on the server too and produce a hydration mismatch.
    const saved = loadCanvasState();
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSite(saved.site);
      setVersions(saved.versions);
      setVersionIndex(saved.versionIndex);
      setMessages(saved.messages);
    }
    // Batched with the restore above, so the save effect below never fires
    // against the pre-restore defaults — only once this render has committed
    // the real (restored or starter) state.
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveCanvasState({ version: 1, site, versions, versionIndex, messages });
  }, [hydrated, site, versions, versionIndex, messages]);

  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout);
      stopRealtimeVoice();
    },
    [],
  );

  function notify(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(""), 2600);
  }

  function stopBuild(silent = false) {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setBuilding(false);
    setProgress(0);
    setStatus("Paused — your current preview is safe");
    if (!silent) {
      setMessages((current) => [
        ...current,
        { from: "ai", text: "Stopped immediately. Nothing was lost—tell me what to adjust." },
      ]);
    }
  }

  function commit(next: SiteDocument) {
    setSite(next);
    setVersions((current) => {
      const branch = current.slice(0, versionIndex + 1);
      const updated = [...branch, next];
      setVersionIndex(updated.length - 1);
      return updated;
    });
  }

  // Re-bound after every render so the long-lived realtime data channel
  // listener (registered once, in startRealtimeVoice) always calls into a
  // closure that sees the latest site/commit — not whatever they were when
  // the voice session first connected.
  useEffect(() => {
    onUpdateSiteRef.current = (request, callId) => {
      void (async () => {
        setMessages((current) => [...current, { from: "you", text: request }]);
        setBuilding(true);
        setStatus("Reading your direction");

        const { ops, reply, unmatched } = await requestEdits(site, request);
        let applied = false;

        if (!unmatched) {
          const result = applyOps(site, ops as EditOp[]);
          if (result.applied.length > 0) {
            commit(result.document);
            applied = true;
          }
        }

        setMessages((current) => [...current, { from: "ai", text: reply }]);
        setBuilding(false);
        setStatus(applied ? "Changes applied to the live preview" : "Ready for your next direction");
        sendVoiceResult(callId, { applied, summary: reply });
      })();
    };
  });

  async function runBuild(text: string) {
    stopBuild(true);
    setBuilding(true);
    setProgress(12);
    setStatus("Reading your direction");
    setMessages((current) => [...current, { from: "you", text }]);

    const { ops, reply, unmatched } = await requestEdits(site, text);

    if (unmatched) {
      setBuilding(false);
      setProgress(0);
      setStatus("Ready for your next direction");
      setMessages((current) => [...current, { from: "ai", text: reply }]);
      return;
    }

    const result = applyOps(site, ops as EditOp[]);

    if (result.applied.length === 0) {
      setBuilding(false);
      setProgress(0);
      setStatus("Nothing changed");
      setMessages((current) => [
        ...current,
        {
          from: "ai",
          text: "I understood that, but none of the edits were valid. Nothing changed.",
        },
      ]);
      return;
    }

    setMessages((current) => [...current, { from: "ai", text: reply }]);

    // Staged progress is cosmetic pacing, not real work. When /api/edit lands,
    // these stages come from server events instead.
    const stages = [
      { delay: 400, progress: 42, status: result.changes[0] ?? "Updating design tokens" },
      { delay: 900, progress: 74, status: result.changes[1] ?? "Rebuilding page sections" },
      { delay: 1350, progress: 90, status: "Checking responsive layout" },
    ];
    stages.forEach((stage) =>
      timers.current.push(
        window.setTimeout(() => {
          setProgress(stage.progress);
          setStatus(stage.status);
        }, stage.delay),
      ),
    );

    timers.current.push(
      window.setTimeout(() => {
        commit(result.document);
        setProgress(100);
        setStatus("Changes applied to the live preview");
      }, 1700),
    );

    timers.current.push(
      window.setTimeout(() => {
        setBuilding(false);
        setProgress(0);
        setStatus("Ready for your next direction");
        if (result.rejected.length > 0) {
          setMessages((current) => [
            ...current,
            {
              from: "ai",
              text: `${result.rejected.length} edit${
                result.rejected.length === 1 ? "" : "s"
              } didn't apply: ${result.rejected[0].reason}`,
            },
          ]);
        }
      }, 2200),
    );
  }

  function submitPrompt(event?: React.FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || building) return;
    setPrompt("");
    void runBuild(text);
  }

  function sendVoiceResult(callId: string, output: unknown) {
    const dc = realtime.current?.dc;
    if (!dc || dc.readyState !== "open") return;
    dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
      }),
    );
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  function handleRealtimeMessage(raw: string) {
    let event: { type?: string; response?: { output?: unknown[] } };
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (event.type !== "response.done" || !Array.isArray(event.response?.output)) return;

    for (const item of event.response.output) {
      const call = item as { type?: string; name?: string; call_id?: string; arguments?: string };
      if (call.type !== "function_call" || call.name !== "update_site" || !call.call_id) continue;
      let request = "";
      try {
        request = String((JSON.parse(call.arguments ?? "{}") as { request?: string }).request ?? "").trim();
      } catch {
        /* malformed arguments — treat as empty */
      }
      if (request) onUpdateSiteRef.current(request, call.call_id);
      else sendVoiceResult(call.call_id, { applied: false, summary: "I didn't catch a clear request." });
    }
  }

  function stopRealtimeVoice() {
    const session = realtime.current;
    if (!session) return;
    session.dc.close();
    session.pc.close();
    session.stream.getTracks().forEach((track) => track.stop());
    session.audioEl.remove();
    realtime.current = null;
  }

  /** Returns true if a realtime voice session started; false means "not configured", so the caller should fall back. */
  async function startRealtimeVoice(): Promise<boolean> {
    let tokenValue: string | undefined;
    try {
      const response = await fetch("/api/voice-token", { method: "POST" });
      if (!response.ok) return false;
      tokenValue = ((await response.json()) as { value?: string }).value;
    } catch {
      return false;
    }
    if (!tokenValue) return false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const pc = new RTCPeerConnection();
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel("oai-events");
      dc.addEventListener("open", () => {
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              instructions: VOICE_INSTRUCTIONS,
              tools: [UPDATE_SITE_TOOL],
              tool_choice: "auto",
            },
          }),
        );
      });
      dc.addEventListener("message", (event) => handleRealtimeMessage(event.data as string));
      dc.addEventListener("close", () => {
        if (realtime.current?.dc === dc) {
          realtime.current = null;
          setListening(false);
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenValue}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!sdpResponse.ok) throw new Error("Realtime SDP exchange failed");
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      realtime.current = { pc, dc, audioEl, stream };
      return true;
    } catch {
      notify("Couldn't start voice mode.");
      return false;
    }
  }

  async function toggleMic() {
    if (listening) {
      if (realtime.current) stopRealtimeVoice();
      else recognition.current?.stop();
      setListening(false);
      return;
    }

    setListening(true);
    const startedRealtime = await startRealtimeVoice();
    if (startedRealtime) return;

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setListening(false);
      notify("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    const speech = new Recognition();
    speech.continuous = false;
    speech.interimResults = false;
    speech.lang = "en-US";
    speech.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setPrompt(transcript);
      setListening(false);
      notify("Voice captured—review it, then press send.");
    };
    speech.onend = () => setListening(false);
    speech.onerror = () => {
      setListening(false);
      notify("I couldn't hear that. Please try again.");
    };
    recognition.current = speech;
    speech.start();
  }

  function restore(index: number) {
    stopBuild(true);
    setVersionIndex(index);
    setSite(versions[index]);
    setHistoryOpen(false);
    setStatus(`Restored version ${index + 1}`);
    notify(`Version ${index + 1} restored`);
  }

  async function share() {
    const url = publishedUrl ?? window.location.href;
    const data = {
      title: "Canvas website build",
      text: "Take a look at this AI-built website",
      url,
    };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(url);
        notify("Link copied to clipboard");
      }
    } catch {
      /* User cancelled the share sheet. */
    }
  }

  async function logout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }

  async function publish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: site }),
      });
      if (!response.ok) throw new Error("Publish failed");
      const data = (await response.json()) as { url: string };
      setPublishedUrl(data.url);
      try {
        await navigator.clipboard.writeText(data.url);
        notify(`Published — link copied: ${data.url}`);
      } catch {
        notify(`Published: ${data.url}`);
      }
    } catch {
      notify("Publishing failed. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  function openPreview() {
    // Opened as its own blob: document, not an iframe srcDoc — must render
    // without the "about:srcdoc" base override, or in-page links break here
    // the same way they used to inside the iframe.
    const blob = new Blob([renderSite(site)], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function toggleTheme() {
    void runBuild(site.theme.background === "#151a17" ? "Make it light" : "Make it dark");
  }

  return (
    <main className="studio-shell">
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <header className="topbar">
        <a className="brand" href="#" aria-label="Canvas home">
          <span className="brand-mark">C</span>
          <span>Canvas</span>
          <span className="beta">DEMO</span>
        </a>
        <div className="project-name">
          <span className="live-dot" /> {site.meta.name}
        </div>
        <div className="top-actions">
          <span className="saved">Version {versionIndex + 1} saved</span>
          <button className="logout-button" onClick={() => void logout()}>
            Log out
          </button>
          <button className="share-button" onClick={share}>
            Share
          </button>
          <button className="publish-button" onClick={() => void publish()} disabled={publishing}>
            {publishing ? "Publishing…" : "Publish demo"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="conversation-panel">
          <div className="call-card">
            <div className={`orb ${building || listening ? "speaking" : ""}`} aria-hidden="true">
              <span className="orb-core" />
              <span className="orb-ring ring-one" />
              <span className="orb-ring ring-two" />
            </div>
            <div>
              <p className="eyebrow">LIVE BUILD SESSION</p>
              <h1>Nova</h1>
              <p className="call-status">
                {listening ? "Listening to you…" : building ? "Building now" : "Ready"}
              </p>
            </div>
            <div className="call-controls">
              <button
                className={listening ? "control active" : "control"}
                onClick={toggleMic}
                aria-label={listening ? "Stop listening" : "Start voice input"}
              >
                {listening ? "●" : "Mic"}
              </button>
              <button
                className={camera ? "control active" : "control"}
                onClick={() => {
                  setCamera((value) => !value);
                  notify(camera ? "Camera preview off" : "Camera preview on");
                }}
                aria-label="Toggle camera"
              >
                Cam
              </button>
              <button className="interrupt" onClick={() => stopBuild()} disabled={!building}>
                <span>■</span> Interrupt build
              </button>
            </div>
          </div>

          <div className="build-status" aria-live="polite">
            <span className={building ? "spinner" : "pause-icon"} />
            <div>
              <strong>{status}</strong>
              <p>
                {building
                  ? `${progress}% complete · editing preview`
                  : `${site.sections.length} sections · try a prompt below`}
              </p>
            </div>
            {building && (
              <span className="progress-bar">
                <i style={{ width: `${progress}%` }} />
              </span>
            )}
          </div>

          <div className="suggestions">
            {suggestions.map((suggestion) => (
              <button key={suggestion} disabled={building} onClick={() => setPrompt(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>

          <div className="messages">
            <div className="timeline-label">
              <span aria-hidden="true" /> CONVERSATION <span aria-hidden="true" />
            </div>
            {messages.map((message, index) => (
              <div className={`message ${message.from}`} key={`${message.text}-${index}`}>
                <span className="sender">{message.from === "ai" ? "NOVA" : "YOU"}</span>
                <p>{message.text}</p>
              </div>
            ))}
          </div>

          <form className="composer" onSubmit={submitPrompt}>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitPrompt();
                }
              }}
              placeholder="Try: Add a gallery and make it dark…"
              aria-label="Message Nova"
              disabled={building}
            />
            <div className="composer-actions">
              <button
                type="button"
                className="attach"
                onClick={() => notify("File references are coming in the connected AI phase.")}
                aria-label="Attach a file"
              >
                ＋
              </button>
              <span>
                {listening
                  ? "Listening…"
                  : building
                    ? "Interrupt to give a new direction"
                    : "Enter to send"}
              </span>
              <button
                type="submit"
                className="send"
                disabled={!prompt.trim() || building}
                aria-label="Send prompt"
              >
                ↑
              </button>
            </div>
          </form>
        </aside>

        <section className="preview-area">
          <div className="preview-toolbar">
            <div className="device-switcher" aria-label="Preview size">
              {(["desktop", "tablet", "mobile"] as Device[]).map((item) => (
                <button
                  key={item}
                  className={device === item ? "selected" : ""}
                  aria-pressed={device === item}
                  onClick={() => setDevice(item)}
                >
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
            <div className="preview-meta">
              <span>{building ? "Updating live" : "Live preview"}</span>
              <button onClick={toggleTheme} disabled={building}>
                ◐ Theme
              </button>
              <button onClick={openPreview}>↗ Open</button>
            </div>
          </div>

          <div className={`browser-frame device-${device}`}>
            <div className="browser-bar">
              <div className="traffic" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div className="address" aria-hidden="true">
                <span>●</span> live-preview.canvas
              </div>
              <span className="refresh" aria-hidden="true">↻</span>
            </div>
            <iframe
              ref={iframe}
              title="Live website preview"
              srcDoc={srcDoc}
              sandbox="allow-forms allow-scripts"
            />
            {building && (
              <div className="build-overlay">
                <span className="spinner" />
                <strong>{status}</strong>
                <small>The page will update when this step is ready</small>
              </div>
            )}
          </div>

          <div className="version-dock">
            <div>
              <span className="version-icon">↺</span>
              <p>
                <strong>Version {versionIndex + 1}</strong>
                <small>
                  {versionIndex === versions.length - 1 ? "Current" : "Restored"} · saved locally
                </small>
              </p>
            </div>
            <div className="version-actions">
              <button onClick={() => restore(versionIndex - 1)} disabled={versionIndex === 0}>
                ←
              </button>
              <span>
                {versionIndex + 1} / {versions.length}
              </span>
              <button
                onClick={() => restore(versionIndex + 1)}
                disabled={versionIndex === versions.length - 1}
              >
                →
              </button>
              <button className="history" onClick={() => setHistoryOpen((value) => !value)}>
                Version history
              </button>
            </div>
          </div>

          {historyOpen && (
            <div className="history-panel">
              <div>
                <strong>Version history</strong>
                <button aria-label="Close version history" onClick={() => setHistoryOpen(false)}>
                  ×
                </button>
              </div>
              {versions.map((item, index) => (
                <button
                  key={index}
                  className={index === versionIndex ? "current" : ""}
                  aria-current={index === versionIndex ? "true" : undefined}
                  onClick={() => restore(index)}
                >
                  <span>Version {index + 1}</span>
                  <small>
                    {item.sections.length} sections · {item.meta.name}
                  </small>
                </button>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
