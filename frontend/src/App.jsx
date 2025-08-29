import { useEffect, useState } from "react";
import SidebarTree from "./components/SidebarTree";
import NoteEditor from "./components/NoteEditor";
import ReflectPanel from "./components/ReflectPanel";
import { api } from "./api/client";

export default function App() {
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showReflect, setShowReflect] = useState(true);
  const [error, setError] = useState("");

  async function refreshFolders() { try { setFolders(await api("/folders")); } catch (e) { setError(e.message); } }
  async function refreshNotes() {
  try {
    // Trae SIEMPRE todas las notas; el filtrado visual lo hace SidebarTree
    const data = await api("/notes");
    setNotes(data);
    // Si la nota seleccionada ya no existe, limpia selección
    if (selectedId && !data.find(n => n.id === selectedId)) {
      setSelectedId(null);
      setSelectedNote(null);
    }
  } catch (e) {
    setError(e.message);
  }
}


  useEffect(() => { refreshFolders(); }, []);
  useEffect(() => { refreshNotes(); }, [selectedFolderId]);

  useEffect(() => {
    if (!selectedId) { setSelectedNote(null); return; }
    api(`/notes/${selectedId}`).then(setSelectedNote).catch(e => setError(e.message));
  }, [selectedId]);

  async function onCreated(note) { await refreshNotes(); setSelectedId(note.id); }

  useEffect(() => { const t = setInterval(refreshNotes, 3000); return () => clearInterval(t); }, [selectedFolderId, selectedId]);

  async function createFolder(name) { await api("/folders", { method:"POST", body: JSON.stringify({ name }) }); await refreshFolders(); }

  async function moveNoteToFolder(noteId, folderId) {
    await api(`/notes/${noteId}/move`, { method:"PUT", body: JSON.stringify({ folder_id: folderId ?? null }) });
    await refreshNotes();
    if (selectedId === noteId) api(`/notes/${noteId}`).then(setSelectedNote).catch(()=>{});
  }

  // ✅ borrar nota (antes no llamábamos al DELETE)
  async function deleteNote(id) {
    try {
      await api(`/notes/${id}`, { method: "DELETE" });
      if (selectedId === id) { setSelectedId(null); setSelectedNote(null); }
      await refreshNotes();
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="h-screen flex text-zinc-100 bg-zinc-950 relative overflow-hidden">
      {/* Flechas laterales */}
      <button
        className="fixed left-0 top-1/2 -translate-y-1/2 z-50 bg-zinc-800 border border-zinc-700 rounded-r px-1.5 py-2 shadow"
        onClick={() => setShowSidebar(s => !s)}
        title={showSidebar ? "Ocultar sidebar" : "Mostrar sidebar"}
      >
        {showSidebar ? "❮" : "❯"}
      </button>
      <button
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-zinc-800 border border-zinc-700 rounded-l px-1.5 py-2 shadow"
        onClick={() => setShowReflect(r => !r)}
        title={showReflect ? "Ocultar panel" : "Mostrar panel"}
      >
        {showReflect ? "❯" : "❮"}
      </button>

      {/* Sidebar */}
      {showSidebar && (
        <aside className="w-80 border-r border-zinc-800 p-3 flex flex-col">
          <div className="text-sm font-semibold mb-2 opacity-70">Your Notes</div>
          <button
            className="mb-3 py-2 px-3 rounded bg-zinc-800 hover:bg-zinc-700 text-left transition-colors duration-200"
            onClick={() => setSelectedId(null)}
          >
            + New Note
          </button>

          {/* 👇 contenedor scrollable del árbol */}
          <div className="flex-1 min-h-0">
            <SidebarTree
              notes={notes}
              folders={folders}
              selectedNoteId={selectedId}
              selectedFolderId={selectedFolderId}
              onSelectNote={setSelectedId}
              onSelectFolder={setSelectedFolderId}
              onCreateFolder={createFolder}
              onMoveNote={moveNoteToFolder}
              onDeleteNote={deleteNote}
              onError={setError}
            />
          </div>
        </aside>
      )}

      {/* Main */}
      <main className={`flex-1 min-h-0 grid ${showReflect ? "grid-cols-2" : "grid-cols-1"}`}>
        <section className="p-0 min-h-0">
          <NoteEditor
            key={selectedId || "new"}
            noteId={selectedId}
            note={selectedNote}
            onCreated={onCreated}
            onError={setError}
            defaultFolderId={selectedFolderId}
          />
        </section>
        {showReflect && (
          <section className="p-4 border-l border-zinc-800 min-h-0">
            <ReflectPanel note={selectedNote} onError={setError} />
          </section>
        )}
      </main>

      {error && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded shadow-lg"
          onClick={() => setError("")}
        >
          {error}
        </div>
      )}
    </div>
  );
}
