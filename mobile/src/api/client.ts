import { fetch as expoFetch } from "expo/fetch";
import { API_BASE } from "./config";

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
    throw new ApiError(typeof msg === "string" ? msg : JSON.stringify(msg), res.status);
  }
  return data;
}

// --- Auth ---
export const register = (email: string, password: string) =>
  request("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });

export const login = (email: string, password: string) =>
  request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

export const me = () => request("/auth/me");

// --- Folders ---
export type Folder = { id: number; name: string; created_at: string };
export const listFolders = () => request("/folders") as Promise<Folder[]>;
export const createFolder = (name: string) =>
  request("/folders", { method: "POST", body: JSON.stringify({ name }) }) as Promise<Folder>;
export const deleteFolder = (id: number) => request(`/folders/${id}`, { method: "DELETE" });

// --- Notes ---
export type Note = {
  id: number;
  title: string;
  content: string;
  folder_id: number | null;
  created_at: string;
  updated_at: string;
};

export const listNotes = (folderId?: number | null) => {
  const q = folderId != null ? `?folder_id=${folderId}` : "";
  return request(`/notes${q}`) as Promise<Note[]>;
};
export const getNote = (id: number) => request(`/notes/${id}`) as Promise<Note>;
export const createNote = (input: { title?: string; content: string; folder_id?: number | null }) =>
  request("/notes", { method: "POST", body: JSON.stringify(input) }) as Promise<Note>;
export const updateNote = (
  id: number,
  input: Partial<{ title: string; content: string; folder_id: number | null }>
) => request(`/notes/${id}`, { method: "PUT", body: JSON.stringify(input) }) as Promise<Note>;
export const deleteNote = (id: number) => request(`/notes/${id}`, { method: "DELETE" });
export const moveNote = (id: number, folder_id: number | null) =>
  request(`/notes/${id}/move`, { method: "PUT", body: JSON.stringify({ folder_id }) });

// --- Reflect (non-streaming fallback) ---
export type ReflectMode = "socratico" | "estructurado" | "semanal";

// A highlighted passage, as offsets into the note's *saved* content. Offsets
// are Unicode code points (what the Python backend indexes by), not the
// UTF-16 units JS strings and TextInput selections use — see toCodePointRange.
export type SelectionRange = { start: number; end: number };

export function toCodePointRange(text: string, start: number, end: number): SelectionRange {
  const cpStart = Array.from(text.slice(0, start)).length;
  return { start: cpStart, end: cpStart + Array.from(text.slice(start, end)).length };
}

export const reflectNote = (
  id: number,
  mode: ReflectMode,
  selection?: SelectionRange | null,
  promptPayload: Record<string, unknown> = {}
) =>
  request(`/notes/${id}/reflect`, {
    method: "POST",
    body: JSON.stringify({
      mode,
      prompt_payload: promptPayload,
      ...(selection ? { selection_start: selection.start, selection_end: selection.end } : {}),
    }),
  });

// --- Streaming (SSE) ---
// The backend serves SSE (`text/event-stream`). Browser EventSource can't
// send an Authorization header, but the plain fetch streaming body reader
// (via expo/fetch, which supports ReadableStream on native) can — so we
// parse the SSE framing ourselves instead of using EventSource.

// Some networks (proxies, campus/corporate wifi, content filtering) buffer or
// silently drop long-lived chunked connections without ever erroring the
// fetch promise. If we go this long without receiving any bytes at all, or
// this long between chunks once started, give up so the caller can fall
// back to the non-streaming endpoint instead of hanging forever.
const STREAM_STALL_MS = 12000;

async function streamSSE(
  path: string,
  onEvent: (eventType: string, data: any) => void,
  onError: ((err: Error) => void) | undefined,
  signal?: AbortSignal
) {
  const internalController = new AbortController();
  signal?.addEventListener("abort", () => internalController.abort());

  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let stalled = false;
  function resetStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      internalController.abort();
    }, STREAM_STALL_MS);
  }

  try {
    resetStallTimer();
    const res = await expoFetch(`${API_BASE}${path}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      signal: internalController.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetStallTimer();
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; each frame has "event: x"
      // and "data: {...}" lines.
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        let eventType = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue; // ignore malformed frame
        }
        onEvent(eventType, parsed);
      }
    }
  } catch (e: any) {
    if (e?.name === "AbortError") {
      if (stalled) onError?.(new Error("Timed out waiting for a response"));
      return;
    }
    onError?.(e instanceof Error ? e : new Error(String(e)));
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}

type StreamHandlers<Done> = {
  onChunk?: (delta: string) => void;
  onDone?: (result: Done) => void;
  onError?: (err: Error) => void;
};

type ReflectDone = { fullText: string; parsed: Record<string, unknown> | null; error: string | null };

export function streamReflect(
  noteId: number,
  mode: ReflectMode,
  handlers: StreamHandlers<ReflectDone>,
  opts: { signal?: AbortSignal; selection?: SelectionRange | null } = {}
) {
  const sel = opts.selection ? `&selection_start=${opts.selection.start}&selection_end=${opts.selection.end}` : "";
  return streamSSE(
    `/ai/reflect/stream?note_id=${noteId}&mode=${mode}${sel}`,
    (eventType, data) => {
      if (eventType === "chunk") {
        handlers.onChunk?.(data.delta || "");
      } else if (eventType === "done") {
        handlers.onDone?.({
          fullText: data.full_text || "",
          parsed: data.parsed ?? null,
          error: data.error ?? null,
        });
      }
    },
    handlers.onError,
    opts.signal
  );
}

// --- Note chat ---
// Posting a message and getting the AI's reply are separate calls, so a reply
// that fails to stream can be retried via chatReply without re-posting (and
// duplicating) the user's message.
export type ChatMessage = {
  id: number;
  note_id: number;
  role: "user" | "assistant";
  content: string;
  quote: string | null;
  created_at: string;
};

export const listChat = (noteId: number) => request(`/notes/${noteId}/chat`) as Promise<ChatMessage[]>;
export const sendChatMessage = (noteId: number, content: string, quote?: string | null) =>
  request(`/notes/${noteId}/chat`, {
    method: "POST",
    body: JSON.stringify({ content, quote: quote || null }),
  }) as Promise<ChatMessage>;
export const clearChat = (noteId: number) => request(`/notes/${noteId}/chat`, { method: "DELETE" });
// Non-streaming fallback for the reply. 409 means there's nothing waiting for
// a reply (e.g. the streamed reply was actually saved before the connection died).
export const chatReply = (noteId: number) =>
  request(`/notes/${noteId}/chat/reply`, { method: "POST" }) as Promise<ChatMessage>;

type ChatReplyDone = { message: ChatMessage | null; error: string | null };

export function streamChatReply(noteId: number, handlers: StreamHandlers<ChatReplyDone>, signal?: AbortSignal) {
  return streamSSE(
    `/notes/${noteId}/chat/reply/stream`,
    (eventType, data) => {
      if (eventType === "chunk") handlers.onChunk?.(data.delta || "");
      else if (eventType === "done") handlers.onDone?.({ message: data.message ?? null, error: data.error ?? null });
    },
    handlers.onError,
    signal
  );
}
