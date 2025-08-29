import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

function deriveTitleFromContent(content) {
  const first = (content || "").split(/\r?\n/)[0] || "";
  return first.trim().slice(0, 120);
}

/**
 * Props:
 * - noteId (number|null)
 * - note (obj|null)
 * - onCreated(note)
 * - onError(msg)
 * - defaultFolderId (number|null)  // carpeta activa para nuevas
 */
export default function NoteEditor({ noteId, note, onCreated, onError, defaultFolderId }) {
  const [content, setContent] = useState("");
  const debounceRef = useRef(null);
  const creatingRef = useRef(false);

  useEffect(() => {
    setContent(note ? (note.content || "") : "");
    creatingRef.current = false;
  }, [noteId, note]);

  useEffect(() => {
    if (content.trim() === "") return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const title = deriveTitleFromContent(content);
      try {
        if (noteId) {
          // ✅ PUT PARCIAL: NO mandamos folder_id (lo mantiene el backend)
          await api(`/notes/${noteId}`, {
            method: "PUT",
            body: JSON.stringify({ title, content }),
          });
        } else if (!creatingRef.current) {
          creatingRef.current = true;
          // ✅ POST: SI llevamos folder_id (crear dentro de la carpeta activa)
          const created = await api("/notes", {
            method: "POST",
            body: JSON.stringify({ title, content, folder_id: defaultFolderId ?? null }),
          });
          onCreated?.(created);
        }
      } catch (e) {
        onError?.(e.message);
      }
    }, 600);
    return () => clearTimeout(debounceRef.current);
  }, [content, noteId, onCreated, onError, defaultFolderId]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-8 py-6">
        <textarea
          className="w-full h-[80vh] md:h-[82vh] bg-transparent outline-none border-none text-[20px] leading-8 placeholder-zinc-500"
          placeholder="Escribe aquí. La primera línea será el título en la lista…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="text-xs opacity-60 mt-2">Guardado automáticamente</div>
      </div>
    </div>
  );
}
