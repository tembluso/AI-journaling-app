// frontend/src/api/client.js
const BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

async function handle(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// --- núcleo genérico ---
export async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return handle(res);
}

// --- Folders ---
export const listFolders = () => api(`/folders`);
export const createFolder = (name) =>
  api(`/folders`, { method: "POST", body: JSON.stringify({ name }) });
export const deleteFolder = (id) =>
  api(`/folders/${id}`, { method: "DELETE" });

// --- Notes ---
export const listNotes = (folderId = null) => {
  const q = folderId ? `?folder_id=${folderId}` : "";
  return api(`/notes${q}`);
};
export const getNote = (id) => api(`/notes/${id}`);
export const createNote = ({ title = "", content = "", folder_id = null } = {}) =>
  api(`/notes`, { method: "POST", body: JSON.stringify({ title, content, folder_id }) });

export const updateNote = (id, { title, content, folder_id } = {}) =>
  api(`/notes/${id}`, { method: "PUT", body: JSON.stringify({ title, content, folder_id }) });

export const deleteNote = (id) =>
  api(`/notes/${id}`, { method: "DELETE" });

export const moveNote = (noteId, folder_id) =>
  api(`/notes/${noteId}/move`, { method: "PUT", body: JSON.stringify({ folder_id }) });

export const createChildNote = (parentId, { title, content, folder_id = null } = {}) =>
  api(`/notes/${parentId}/children`, {
    method: "POST",
    body: JSON.stringify({ title, content, folder_id }),
  });

// --- IA no-stream (fallback) ---
export const reflectNote = (noteId, payload) =>
  api(`/notes/${noteId}/reflect`, { method: "POST", body: JSON.stringify(payload) });

// --- IA Streaming SSE ---
export function streamReflect({ noteId, mode = "general", signal, handlers }) {
  const url = new URL(`${BASE}/ai/reflect/stream`);
  url.searchParams.set("note_id", String(noteId));
  url.searchParams.set("mode", mode);

  const es = new EventSource(url.toString(), { withCredentials: false });

  es.addEventListener("chunk", (e) => {
    try {
      const { delta } = JSON.parse(e.data);
      handlers?.onChunk?.(delta || "");
    } catch {}
  });

  es.addEventListener("done", (e) => {
    try {
      const { full_text, parsed, error } = JSON.parse(e.data);
      handlers?.onDone?.({ fullText: full_text, parsed, error });
    } finally {
      es.close();
    }
  });

  es.onerror = () => {
    try { es.close(); } catch {}
    handlers?.onError?.(new Error("SSE error"));
  };

  if (signal) {
    signal.addEventListener("abort", () => {
      try { es.close(); } catch {}
    });
  }

  return () => {
    try { es.close(); } catch {}
  };
}
