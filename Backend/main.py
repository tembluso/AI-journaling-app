from fastapi import FastAPI, Depends, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from . import database, models, schemas, crud
from .telemetry import count_event
import json
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.orm import Session
from .ai_stream import stream_reflection
from . import crud


models.Base.metadata.create_all(bind=database.engine)

# Mini-migración: folder_id en notes si no existe
with database.engine.begin() as conn:
    cols = [row["name"] for row in conn.execute(text("PRAGMA table_info('notes')")).mappings()]
    if "folder_id" not in cols:
        conn.execute(text("ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES folders(id)"))

app = FastAPI(title="Notes MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Folders
@app.get("/folders", response_model=list[schemas.FolderOut])
def list_folders(db: Session = Depends(get_db)):
    count_event(db, "GET_/folders"); return crud.list_folders(db)

@app.post("/folders", response_model=schemas.FolderOut)
def create_folder(folder: schemas.FolderCreate, db: Session = Depends(get_db)):
    count_event(db, "POST_/folders"); return crud.create_folder(db, folder)

@app.delete("/folders/{folder_id}", response_model=dict)
def delete_folder(folder_id: int, db: Session = Depends(get_db)):
    count_event(db, "DELETE_/folders_id")
    ok = crud.delete_folder(db, folder_id)
    if not ok: raise HTTPException(status_code=404, detail="Folder not found")
    return {"ok": True}

# Notes
@app.get("/notes", response_model=list[schemas.NoteOut])
def list_notes(folder_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    count_event(db, "GET_/notes"); return crud.list_notes(db, folder_id)

@app.get("/notes/{note_id}", response_model=schemas.NoteOut)
def get_note(note_id: int, db: Session = Depends(get_db)):
    count_event(db, "GET_/notes_id")
    note = crud.get_note(db, note_id)
    if not note: raise HTTPException(status_code=404, detail="Note not found")
    return note

@app.post("/notes", response_model=schemas.NoteOut)
def create_note(note: schemas.NoteCreate, db: Session = Depends(get_db)):
    count_event(db, "POST_/notes"); return crud.create_note(db, note)


@app.put("/notes/{note_id}", response_model=schemas.NoteOut)
def update_note(note_id: int, note: schemas.NoteUpdate, db: Session = Depends(get_db)):
    count_event(db, "PUT_/notes_id")
    try:
        # Pydantic v1 vs v2
        updates = note.dict(exclude_unset=True) if hasattr(note, "dict") else note.model_dump(exclude_unset=True)
    except Exception:
        updates = note.model_dump(exclude_unset=True)
    updated = crud.update_note(db, note_id, updates)
    if not updated: raise HTTPException(status_code=404, detail="Note not found")
    return updated

@app.put("/notes/{note_id}/move", response_model=schemas.NoteOut)
def move_note(note_id: int, req: schemas.MoveRequest, db: Session = Depends(get_db)):
    count_event(db, "PUT_/notes_id_move")
    moved = crud.move_note_to_folder(db, note_id, req.folder_id)
    if not moved: raise HTTPException(status_code=404, detail="Note not found")
    return moved

@app.delete("/notes/{note_id}", response_model=dict)
def delete_note(note_id: int, db: Session = Depends(get_db)):
    count_event(db, "DELETE_/notes_id")
    note = crud.get_note(db, note_id)
    if not note: raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note); db.commit()
    return {"ok": True}

@app.post("/notes/{note_id}/children", response_model=schemas.NoteOut)
def create_child_note(note_id: int, note: schemas.NoteCreate, db: Session = Depends(get_db)):
    parent = crud.get_note(db, note_id)
    if not parent: raise HTTPException(status_code=404, detail="Parent note not found")
    count_event(db, "POST_/notes_children_conversion")
    return crud.create_note(db, note)

@app.post("/notes/{note_id}/reflect", response_model=schemas.ReflectionOut)
def reflect_note(note_id: int, req: schemas.ReflectionRequest, db: Session = Depends(get_db)):
    count_event(db, f"POST_/notes/{note_id}/reflect_{req.mode}")
    note = crud.get_note(db, note_id)
    if not note: raise HTTPException(status_code=404, detail="Note not found")
    reflection = crud.create_reflection_for_note(db, note_id, req.mode, req.prompt_payload)
    return reflection

@app.get("/metrics", response_model=dict)
def get_metrics(db: Session = Depends(get_db)):
    return crud.get_metrics(db)

@app.get("/ai/reflect/stream")
async def reflect_stream(
    note_id: int = Query(..., ge=1),
    mode: str = Query("general"),
    db: Session = Depends(get_db),
):
    note = crud.get_note(db, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    async def gen():
        async for ev in stream_reflection(note.content or "", mode):
            yield {"event": ev["type"], "data": json.dumps(ev, ensure_ascii=False)}

    return EventSourceResponse(gen())
