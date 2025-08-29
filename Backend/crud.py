from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime
from . import models, schemas

# Folders
def list_folders(db: Session):
    return db.execute(select(models.Folder).order_by(models.Folder.name.asc())).scalars().all()

def create_folder(db: Session, folder_in: schemas.FolderCreate):
    f = models.Folder(name=folder_in.name)
    db.add(f); db.commit(); db.refresh(f)
    return f

def delete_folder(db: Session, folder_id: int) -> bool:
    f = db.get(models.Folder, folder_id)
    if not f: return False
    db.delete(f); db.commit()
    return True

# Notes
def list_notes(db: Session, folder_id: int | None = None):
    stmt = select(models.Note).order_by(models.Note.updated_at.desc())
    if folder_id is not None:
        stmt = stmt.where(models.Note.folder_id == folder_id)
    return db.execute(stmt).scalars().all()

def create_note(db: Session, note_in: schemas.NoteCreate):
    note = models.Note(
        title=note_in.title or "",
        content=note_in.content,
        folder_id=note_in.folder_id,
    )
    db.add(note); db.commit(); db.refresh(note)
    return note


def update_note(db: Session, note_id: int, updates: dict):
    note = db.get(models.Note, note_id)
    if not note: return None
    if "title" in updates and updates["title"] is not None:
        note.title = updates["title"]
    if "content" in updates and updates["content"] is not None:
        note.content = updates["content"]
    if "folder_id" in updates:
        note.folder_id = updates["folder_id"]
    note.updated_at = datetime.utcnow()
    db.commit(); db.refresh(note)
    return note

def move_note_to_folder(db: Session, note_id: int, folder_id: int | None):
    note = db.get(models.Note, note_id)
    if not note: return None
    note.folder_id = folder_id
    note.updated_at = datetime.utcnow()
    db.commit(); db.refresh(note)
    return note

def get_note(db: Session, note_id: int):
    return db.get(models.Note, note_id)


def get_metrics(db: Session):
    rows = db.query(models.Metric).all()
    return {r.event: r.count for r in rows}
