import os
import json

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sse_starlette.sse import EventSourceResponse

from . import database, models, schemas, crud
from .auth import get_current_user, create_access_token, verify_password
from .telemetry import count_event
from .ai_stream import stream_reflection, stream_chat_reply, extract_selection, format_chat_message

models.Base.metadata.create_all(bind=database.engine)

# Mini-migración para bases sqlite locales ya existentes (columnas nuevas si no
# existen). Postgres/Supabase ya tiene el esquema correcto vía migración
# aplicada directamente, y no soporta PRAGMA.
if database.engine.dialect.name == "sqlite":
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

# Keep-alive comment frames on SSE streams. Must stay well under the mobile
# client's STREAM_STALL_MS (12s), or a slow first token looks like a dead
# connection and the app abandons the stream for the non-streaming fallback.
SSE_PING_SECONDS = 5

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
    try:
        return crud.create_folder(db, folder, current_user.id)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A folder with that name already exists")

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
    # Postgres cascades this via the FK, but SQLite doesn't enforce FKs by default
    crud.clear_chat(db, note_id)
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
    selection = _selection_for(note, req.selection_start, req.selection_end)

    result = None
    async for ev in stream_reflection(note.content or "", req.mode, selection):
        if ev["type"] == "done":
            result = ev

    if result is None or result.get("error") or result.get("parsed") is None:
        detail = result.get("error") if result else "no_response"
        raise HTTPException(status_code=502, detail=f"AI reflection failed: {detail}")

    return crud.save_reflection(db, note_id, req.mode, result["parsed"])

@app.get("/metrics", response_model=dict)
def get_metrics(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return crud.get_metrics(db)

def _selection_for(note: models.Note, start: int | None, end: int | None):
    """Resolves optional selection offsets against the note's stored content."""
    if start is None and end is None:
        return None
    if start is None or end is None:
        raise HTTPException(status_code=422, detail="selection_start and selection_end must be sent together")
    selection = extract_selection(note.content or "", start, end)
    if selection is None:
        raise HTTPException(status_code=422, detail="Selection doesn't match the saved note")
    return selection

@app.get("/ai/reflect/stream")
async def reflect_stream(
    note_id: int = Query(..., ge=1),
    mode: str = Query("general"),
    selection_start: int | None = Query(default=None, ge=0),
    selection_end: int | None = Query(default=None, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    note = crud.get_note(db, note_id, current_user.id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    selection = _selection_for(note, selection_start, selection_end)
    if selection is not None:
        count_event(db, "GET_/ai/reflect/stream_selection")

    async def gen():
        async for ev in stream_reflection(note.content or "", mode, selection):
            yield {"event": ev["type"], "data": json.dumps(ev, ensure_ascii=False)}

    return EventSourceResponse(gen(), ping=SSE_PING_SECONDS)

# Note chat. Sending a message and getting the reply are separate calls so the
# reply can be retried through the non-streaming endpoint (when a network kills
# the SSE connection) without re-posting — and duplicating — the user message.
def _chat_history(db: Session, note_id: int):
    return [
        {"role": m.role, "content": format_chat_message(m.content, m.quote)}
        for m in crud.list_chat_messages(db, note_id)
    ]

def _require_pending_reply(history: list[dict]):
    if not history or history[-1]["role"] != "user":
        raise HTTPException(status_code=409, detail="No message waiting for a reply")

@app.get("/notes/{note_id}/chat", response_model=list[schemas.ChatMessageOut])
def list_chat(note_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if not crud.get_note(db, note_id, current_user.id): raise HTTPException(status_code=404, detail="Note not found")
    return crud.list_chat_messages(db, note_id)

@app.post("/notes/{note_id}/chat", response_model=schemas.ChatMessageOut)
def send_chat_message(note_id: int, msg: schemas.ChatMessageCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if not crud.get_note(db, note_id, current_user.id): raise HTTPException(status_code=404, detail="Note not found")
    content = msg.content.strip()
    if not content: raise HTTPException(status_code=422, detail="Message is empty")
    count_event(db, "POST_/notes_id_chat")
    return crud.create_chat_message(db, note_id, "user", content, (msg.quote or "").strip() or None)

@app.delete("/notes/{note_id}/chat", response_model=dict)
def clear_chat(note_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if not crud.get_note(db, note_id, current_user.id): raise HTTPException(status_code=404, detail="Note not found")
    crud.clear_chat(db, note_id)
    return {"ok": True}

@app.get("/notes/{note_id}/chat/reply/stream")
async def chat_reply_stream(note_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    note = crud.get_note(db, note_id, current_user.id)
    if not note: raise HTTPException(status_code=404, detail="Note not found")
    history = _chat_history(db, note_id)
    _require_pending_reply(history)
    title, content = note.title or "", note.content or ""

    async def gen():
        async for ev in stream_chat_reply(title, content, history):
            if ev["type"] == "done":
                message = None
                if not ev["error"] and ev["full_text"]:
                    # The request's `db` session may already be closed once the
                    # response body is streaming, so save through a fresh one.
                    with database.SessionLocal() as save_db:
                        saved = crud.create_chat_message(save_db, note_id, "assistant", ev["full_text"])
                        message = schemas.ChatMessageOut.model_validate(saved).model_dump(mode="json")
                ev = {**ev, "message": message, "error": ev["error"] or (None if message else "empty_reply")}
            yield {"event": ev["type"], "data": json.dumps(ev, ensure_ascii=False)}

    return EventSourceResponse(gen(), ping=SSE_PING_SECONDS)

@app.post("/notes/{note_id}/chat/reply", response_model=schemas.ChatMessageOut)
async def chat_reply(note_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    note = crud.get_note(db, note_id, current_user.id)
    if not note: raise HTTPException(status_code=404, detail="Note not found")
    history = _chat_history(db, note_id)
    _require_pending_reply(history)

    result = None
    async for ev in stream_chat_reply(note.title or "", note.content or "", history):
        if ev["type"] == "done":
            result = ev
    if result is None or result["error"] or not result["full_text"]:
        detail = (result or {}).get("error") or "no_response"
        raise HTTPException(status_code=502, detail=f"AI reply failed: {detail}")
    return crud.create_chat_message(db, note_id, "assistant", result["full_text"])
