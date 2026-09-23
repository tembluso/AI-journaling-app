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
export const reflectNote = (id: number, mode: ReflectMode, promptPayload: Record<string, unknown> = {}) =>
  request(`/notes/${id}/reflect`, {
    method: "POST",
    body: JSON.stringify({ mode, prompt_payload: promptPayload }),
  });

// --- Reflect (streaming) ---
// The backend serves SSE (`text/event-stream`). Browser EventSource can't
// send an Authorization header, but the plain fetch streaming body reader
// (via expo/fetch, which supports ReadableStream on native) can — so we
// parse the SSE framing ourselves instead of using EventSource.
type StreamHandlers = {
  onChunk?: (delta: string) => void;
  onDone?: (result: { fullText: string; parsed: Record<string, unknown> | null; error: string | null }) => void;
  onError?: (err: Error) => void;
};

// Some networks (proxies, campus/corporate wifi, content filtering) buffer or
// silently drop long-lived chunked connections without ever erroring the
// fetch promise. If we go this long without receiving any bytes at all, or
// this long between chunks once started, give up so the caller can fall
// back to the non-streaming endpoint instead of hanging forever.
const STREAM_STALL_MS = 12000;

export async function streamReflect(noteId: number, mode: ReflectMode, handlers: StreamHandlers, signal?: AbortSignal) {
  const url = `${API_BASE}/ai/reflect/stream?note_id=${noteId}&mode=${mode}`;
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
    const res = await expoFetch(url, {
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

        try {
          const parsed = JSON.parse(data);
          if (eventType === "chunk") {
            handlers.onChunk?.(parsed.delta || "");
          } else if (eventType === "done") {
            handlers.onDone?.({
              fullText: parsed.full_text || "",
              parsed: parsed.parsed ?? null,
              error: parsed.error ?? null,
            });
          }
        } catch {
          // ignore malformed frame
        }
      }
    }
  } catch (e: any) {
    if (e?.name === "AbortError") {
      if (stalled) handlers.onError?.(new Error("Timed out waiting for a response"));
      return;
    }
    handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}
