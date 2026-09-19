from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime
from . import models, schemas
from .auth import hash_password

# Users
def get_user_by_email(db: Session, email: str):
    return db.execute(select(models.User).where(models.User.email == email)).scalar_one_or_none()

def create_user(db: Session, user_in: schemas.UserCreate):
    user = models.User(email=user_in.email, hashed_password=hash_password(user_in.password))
    db.add(user); db.commit(); db.refresh(user)
    return user

# Folders
def list_folders(db: Session, user_id: int):
    stmt = select(models.Folder).where(models.Folder.user_id == user_id).order_by(models.Folder.name.asc())
    return db.execute(stmt).scalars().all()

def create_folder(db: Session, folder_in: schemas.FolderCreate, user_id: int):
    f = models.Folder(name=folder_in.name, user_id=user_id)
    db.add(f); db.commit(); db.refresh(f)
    return f

def delete_folder(db: Session, folder_id: int, user_id: int) -> bool:
    f = db.get(models.Folder, folder_id)
    if not f or f.user_id != user_id: return False
    db.delete(f); db.commit()
    return True

# Notes
def list_notes(db: Session, user_id: int, folder_id: int | None = None):
    stmt = select(models.Note).where(models.Note.user_id == user_id).order_by(models.Note.updated_at.desc())
    if folder_id is not None:
        stmt = stmt.where(models.Note.folder_id == folder_id)
    return db.execute(stmt).scalars().all()

def create_note(db: Session, note_in: schemas.NoteCreate, user_id: int):
    note = models.Note(
        title=note_in.title or "",
        content=note_in.content,
        folder_id=note_in.folder_id,
        user_id=user_id,
    )
    db.add(note); db.commit(); db.refresh(note)
    return note


def update_note(db: Session, note_id: int, user_id: int, updates: dict):
    note = db.get(models.Note, note_id)
    if not note or note.user_id != user_id: return None
    if "title" in updates and updates["title"] is not None:
        note.title = updates["title"]
    if "content" in updates and updates["content"] is not None:
        note.content = updates["content"]
    if "folder_id" in updates:
        note.folder_id = updates["folder_id"]
    note.updated_at = datetime.utcnow()
    db.commit(); db.refresh(note)
    return note

def move_note_to_folder(db: Session, note_id: int, user_id: int, folder_id: int | None):
    note = db.get(models.Note, note_id)
    if not note or note.user_id != user_id: return None
    note.folder_id = folder_id
    note.updated_at = datetime.utcnow()
    db.commit(); db.refresh(note)
    return note

def get_note(db: Session, note_id: int, user_id: int):
    note = db.get(models.Note, note_id)
    if not note or note.user_id != user_id: return None
    return note


# Reflections
def save_reflection(db: Session, note_id: int, mode: str, result_json: dict):
    reflection = models.Reflection(note_id=note_id, mode=mode, result_json=result_json)
    db.add(reflection); db.commit(); db.refresh(reflection)
    return reflection


def get_metrics(db: Session):
    rows = db.query(models.Metric).all()
    return {r.event: r.count for r in rows}
