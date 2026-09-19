import os
import json

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from sse_starlette.sse import EventSourceResponse

from . import database, models, schemas, crud
from .auth import get_current_user, create_access_token, verify_password
from .telemetry import count_event
from .ai_stream import stream_reflection

models.Base.metadata.create_all(bind=database.engine)

# Mini-migración para bases sqlite ya existentes: columnas nuevas si no existen
with database.engine.begin() as conn:
    note_cols = [row["name"] for row in conn.execute(text("PRAGMA table_info('notes')")).mappings()]
    if "folder_id" not in note_cols:
        conn.execute(text("ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES folders(id)"))
    if "user_id" not in note_cols:
        conn.execute(text("ALTER TABLE notes ADD COLUMN user_id INTEGER REFERENCES users(id)"))

    folder_cols = [row["name"] for row in conn.execute(text("PRAGMA table_info('folders')")).mappings()]
    if "user_id" not in folder_cols:
        conn.execute(text("ALTER TABLE folders ADD COLUMN user_id INTEGER REFERENCES users(id)"))

    user_cols = [row["name"] for row in conn.execute(text("PRAGMA table_info('users')")).mappings()]
    if "hashed_password" not in user_cols:
        conn.execute(text("ALTER TABLE users ADD COLUMN hashed_password VARCHAR"))

app = FastAPI(title="Notes MVP")

# Comma-separated list of allowed origins, e.g. "https://myapp.example.com,exp://192.168.1.5:8081"
_allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
ALLOWED_ORIGINS = [o.strip() for o in _allowed_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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

# Auth
@app.post("/auth/register", response_model=schemas.Token)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    if crud.get_user_by_email(db, user_in.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = crud.create_user(db, user_in)
    count_event(db, "POST_/auth/register")
    return schemas.Token(access_token=create_access_token(user.id))

@app.post("/auth/login", response_model=schemas.Token)
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    user = crud.get_user_by_email(db, credentials.email)
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    count_event(db, "POST_/auth/login")
    return schemas.Token(access_token=create_access_token(user.id))

@app.get("/auth/me", response_model=schemas.UserOut)
def read_me(current_user: models.User = Depends(get_current_user)):
    return current_user

# Folders
@app.get("/folders", response_model=list[schemas.FolderOut])
def list_folders(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, "GET_/folders")
    return crud.list_folders(db, current_user.id)

@app.post("/folders", response_model=schemas.FolderOut)
def create_folder(folder: schemas.FolderCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, "POST_/folders")
    return crud.create_folder(db, folder, current_user.id)

@app.delete("/folders/{folder_id}", response_model=dict)
def delete_folder(folder_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, "DELETE_/folders_id")
    ok = crud.delete_folder(db, folder_id, current_user.id)
    if not ok: raise HTTPException(status_code=404, detail="Folder not found")
    return {"ok": True}

# Notes
@app.get("/notes", response_model=list[schemas.NoteOut])
def list_notes(folder_id: int | None = Query(default=None), db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, "GET_/notes")
    return crud.list_notes(db, current_user.id, folder_id)

@app.get("/notes/{note_id}", response_model=schemas.NoteOut)
def get_note(note_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, "GET_/notes_id")
    note = crud.get_note(db, note_id, current_user.id)
    if not note: raise HTTPException(status_code=404, detail="Note not found")
    return note

@app.post("/notes", response_model=schemas.NoteOut)
def create_note(note: schemas.NoteCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, "POST_/notes")
    return crud.create_note(db, note, current_user.id)

@app.put("/notes/{note_id}", response_model=schemas.NoteOut)
def update_note(note_id: int, note: schemas.NoteUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, "PUT_/notes_id")
    updates = note.model_dump(exclude_unset=True)
    updated = crud.update_note(db, note_id, current_user.id, updates)
    if not updated: raise HTTPException(status_code=404, detail="Note not found")
    return updated

@app.put("/notes/{note_id}/move", response_model=schemas.NoteOut)
def move_note(note_id: int, req: schemas.MoveRequest, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, "PUT_/notes_id_move")
    moved = crud.move_note_to_folder(db, note_id, current_user.id, req.folder_id)
    if not moved: raise HTTPException(status_code=404, detail="Note not found")
    return moved

@app.delete("/notes/{note_id}", response_model=dict)
def delete_note(note_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, "DELETE_/notes_id")
    note = crud.get_note(db, note_id, current_user.id)
    if not note: raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note); db.commit()
    return {"ok": True}

@app.post("/notes/{note_id}/children", response_model=schemas.NoteOut)
def create_child_note(note_id: int, note: schemas.NoteCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    parent = crud.get_note(db, note_id, current_user.id)
    if not parent: raise HTTPException(status_code=404, detail="Parent note not found")
    count_event(db, "POST_/notes_children_conversion")
    return crud.create_note(db, note, current_user.id)

@app.post("/notes/{note_id}/reflect", response_model=schemas.ReflectionOut)
async def reflect_note(note_id: int, req: schemas.ReflectionRequest, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    count_event(db, f"POST_/notes/{note_id}/reflect_{req.mode}")
    note = crud.get_note(db, note_id, current_user.id)
    if not note: raise HTTPException(status_code=404, detail="Note not found")

    result = None
    async for ev in stream_reflection(note.content or "", req.mode):
        if ev["type"] == "done":
            result = ev

    if result is None or result.get("error") or result.get("parsed") is None:
        detail = result.get("error") if result else "no_response"
        raise HTTPException(status_code=502, detail=f"AI reflection failed: {detail}")

    return crud.save_reflection(db, note_id, req.mode, result["parsed"])

@app.get("/metrics", response_model=dict)
def get_metrics(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return crud.get_metrics(db)

@app.get("/ai/reflect/stream")
async def reflect_stream(
    note_id: int = Query(..., ge=1),
    mode: str = Query("general"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    note = crud.get_note(db, note_id, current_user.id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    async def gen():
        async for ev in stream_reflection(note.content or "", mode):
            yield {"event": ev["type"], "data": json.dumps(ev, ensure_ascii=False)}

    return EventSourceResponse(gen())
