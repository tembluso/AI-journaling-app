import { useMemo, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

function firstLine(text = "") { const line = (text || "").split(/\r?\n/)[0] || ""; return line.trim() || "(Sin título)"; }
function snippet(text = "") { const lines = (text || "").split(/\r?\n/); const raw = (lines[1] || lines[0] || "").trim(); return raw.length > 80 ? raw.slice(0,80)+"…" : raw; }

export default function SidebarTree({
  notes, folders, selectedNoteId, selectedFolderId,
  onSelectNote, onSelectFolder, onCreateFolder,
  onMoveNote, onDeleteNote, onError,
}) {
  const [q, setQ] = useState("");
  const [localQ, setLocalQ] = useState("");
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [newFolderName, setNewFolderName] = useState("");

  // Debounce buscador
  useEffect(() => { const t=setTimeout(()=>setQ(localQ.trim().toLowerCase()),150); return ()=>clearTimeout(t); }, [localQ]);

  // Cerrar menú “⋯” al clicar fuera o presionar ESC
  useEffect(() => {
    function onDocClick() { setMenuOpenFor(null); }
    function onEsc(e){ if(e.key==='Escape') setMenuOpenFor(null); }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onEsc); };
  }, []);

  const countsByFolder = useMemo(() => {
    const map = new Map();
    for (const f of folders) map.set(f.id, 0);
    for (const n of notes) if (n.folder_id != null) map.set(n.folder_id, (map.get(n.folder_id)||0)+1);
    return map;
  }, [folders, notes]);

  const matches = (n) =>
    !q ||
    firstLine(n.title || n.content).toLowerCase().includes(q) ||
    (n.content || "").toLowerCase().includes(q);

  const allNotes = useMemo(() => notes.filter(n => n.folder_id == null && matches(n)), [notes, q]);

  function toggleFolder(id) { const next=new Set(expanded); next.has(id)?next.delete(id):next.add(id); setExpanded(next); }
  function onDragStart(e, noteId){ e.dataTransfer.setData("text/x-note-id", String(noteId)); e.dataTransfer.effectAllowed="move"; }
  function onDropToFolder(e, folderId){ e.preventDefault(); const id=Number(e.dataTransfer.getData("text/x-note-id")); if(id) onMoveNote?.(id, folderId); }

  async function createFolder(){ const name=newFolderName.trim(); if(!name) return; try{ await onCreateFolder?.(name); setNewFolderName(""); }catch(e){ onError?.(e.message); } }
  function moveViaMenu(id, folderId){ onMoveNote?.(id, folderId); setMenuOpenFor(null); }

  return (
    <div className="h-full flex flex-col">
      {/* Barra superior (crear carpeta + buscar) */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={newFolderName}
            onChange={(e)=>setNewFolderName(e.target.value)}
            placeholder="Nueva carpeta"
            className="flex-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 outline-none focus:ring-2 focus:ring-zinc-600 transition-colors duration-200"
            onKeyDown={(e)=> e.key==='Enter' && createFolder()}
          />
          <button
            onClick={createFolder}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors duration-200"
            title="Crear carpeta"
          >+</button>
        </div>
        <input
          value={localQ}
          onChange={(e)=>setLocalQ(e.target.value)}
          placeholder="Buscar (Ctrl/Cmd+K)…"
          className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 outline-none focus:ring-2 focus:ring-zinc-600 transition-colors duration-200"
        />
        <div
          className={`w-full px-3 py-2 rounded cursor-pointer transition-colors duration-150 ${selectedFolderId==null ? "bg-zinc-800" : "hover:bg-zinc-800"}`}
          onClick={()=>onSelectFolder(null)}
          onDragOver={(e)=>e.preventDefault()}
          onDrop={(e)=>onDropToFolder(e, null)}
          title="All Notes"
        >
          All Notes
        </div>
      </div>

      {/* Lista scrollable */}
      <div className="flex-1 min-h-0 overflow-auto space-y-2 pt-2">
        {/* All Notes list */}
        {selectedFolderId == null && (
          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {allNotes.map(n => (
                <motion.div
                  key={n.id}
                  layout initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:0.16}}
                  className={`relative rounded ${selectedNoteId===n.id ? "bg-zinc-800" : ""}`}
                  draggable onDragStart={(e)=>onDragStart(e, n.id)}
                >
                  <button
                    onClick={(e)=>{ e.stopPropagation(); onSelectNote(n.id); }}
                    className="w-full text-left px-3 py-2 rounded hover:bg-zinc-800 transition-colors duration-150 pr-10"
                  >
                    <div className="truncate font-medium">{firstLine(n.title || n.content)}</div>
                    <div className="truncate text-xs opacity-60">{snippet(n.content || "")}</div>
                  </button>
                  <div className="absolute right-2 top-2">
                    <button
                      className="text-xl leading-none opacity-70 hover:opacity-100 transition-opacity duration-150"
                      onClick={(e)=>{ e.stopPropagation(); setMenuOpenFor(menuOpenFor===n.id?null:n.id); }}
                    >⋯</button>
                  </div>
                  {menuOpenFor===n.id && (
                    <div
                      className="absolute right-2 top-8 w-44 bg-zinc-900 border border-zinc-800 rounded shadow-lg z-10"
                      onClick={(e)=>e.stopPropagation()}  // no cerrar al hacer click dentro
                    >
                      <div className="px-3 py-2 text-xs opacity-60">Move to…</div>
                      <button className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors duration-150"
                              onClick={()=>moveViaMenu(n.id, null)}>All Notes</button>
                      <div className="max-h-48 overflow-auto">
                        {folders.map(ff => (
                          <button key={ff.id}
                            className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors duration-150"
                            onClick={()=>moveViaMenu(n.id, ff.id)}>{ff.name}</button>
                        ))}
                      </div>
                      <div className="border-t border-zinc-800" />
                      <button
                        className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-900/20 transition-colors duration-150"
                        onClick={()=>onDeleteNote?.(n.id)}
                      >Delete note</button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Carpetas + notas */}
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {folders.map(f => {
              const isOpen = expanded.has(f.id) || selectedFolderId === f.id;
              const folderNotes = notes.filter(n => n.folder_id === f.id && matches(n));
              const count = (countsByFolder.get(f.id) || 0);
              return (
                <motion.div key={f.id} layout initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:0.16}} className="rounded">
                  <div
                    className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer transition-colors duration-150 ${
                      selectedFolderId===f.id ? "bg-zinc-800" : "hover:bg-zinc-800"
                    }`}
                    onClick={()=>{ toggleFolder(f.id); onSelectFolder(f.id); }}
                    onDragOver={(e)=>e.preventDefault()}
                    onDrop={(e)=>onDropToFolder(e, f.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{isOpen ? "▾" : "▸"}</span>
                      <span>{f.name}</span>
                    </div>
                    <span className="text-xs opacity-60">{count}</span>
                  </div>

                  {isOpen && folderNotes.length > 0 && (
                    <div className="pl-6 space-y-1">
                      {folderNotes.map(n => (
                        <div key={n.id}
                             className={`relative rounded ${selectedNoteId===n.id ? "bg-zinc-800" : ""}`}
                             draggable onDragStart={(e)=>onDragStart(e, n.id)}
                        >
                          <button
                            onClick={(e)=>{ e.stopPropagation(); onSelectNote(n.id); }}
                            className="w-full text-left px-3 py-2 rounded hover:bg-zinc-800 transition-colors duration-150 pr-10"
                          >
                            <div className="truncate font-medium">{firstLine(n.title || n.content)}</div>
                            <div className="truncate text-xs opacity-60">{snippet(n.content || "")}</div>
                          </button>
                          <div className="absolute right-2 top-2">
                            <button
                              className="text-xl leading-none opacity-70 hover:opacity-100 transition-opacity duration-150"
                              onClick={(e)=>{ e.stopPropagation(); setMenuOpenFor(menuOpenFor===n.id?null:n.id); }}
                            >⋯</button>
                          </div>
                          {menuOpenFor===n.id && (
                            <div
                              className="absolute right-2 top-8 w-44 bg-zinc-900 border border-zinc-800 rounded shadow-lg z-10"
                              onClick={(e)=>e.stopPropagation()}
                            >
                              <div className="px-3 py-2 text-xs opacity-60">Move to…</div>
                              <button className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors duration-150"
                                      onClick={()=>moveViaMenu(n.id, null)}>All Notes</button>
                              <div className="max-h-48 overflow-auto">
                                {folders.map(ff => (
                                  <button key={ff.id}
                                    className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors duration-150"
                                    onClick={()=>moveViaMenu(n.id, ff.id)}>{ff.name}</button>
                                ))}
                              </div>
                              <div className="border-t border-zinc-800" />
                              <button
                                className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-900/20 transition-colors duration-150"
                                onClick={()=>onDeleteNote?.(n.id)}
                              >Delete note</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
