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
export const listFolders = () => request("/folders");
export const createFolder = (name: string) =>
  request("/folders", { method: "POST", body: JSON.stringify({ name }) });
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

// --- Reflect (non-streaming; streaming variant lands in a later pass) ---
export type ReflectMode = "socratico" | "estructurado" | "semanal";
export const reflectNote = (id: number, mode: ReflectMode, promptPayload: Record<string, unknown> = {}) =>
  request(`/notes/${id}/reflect`, {
    method: "POST",
    body: JSON.stringify({ mode, prompt_payload: promptPayload }),
  });
