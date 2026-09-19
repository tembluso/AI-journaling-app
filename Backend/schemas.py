from pydantic import BaseModel, EmailStr, Field
from typing import Literal, Optional
from datetime import datetime

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    email: EmailStr
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class FolderCreate(BaseModel):
    name: str

class FolderOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    class Config:
        from_attributes = True

class NoteBase(BaseModel):
    title: str = ""
    content: str
    folder_id: Optional[int] = None

class NoteCreate(NoteBase):
    pass

# ✅ PARCIAL: todos opcionales para updates parciales
class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    folder_id: Optional[int] = None

class NoteOut(NoteBase):
    id: int
    created_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True

class ReflectionRequest(BaseModel):
    mode: Literal["socratico", "estructurado", "semanal"]
    prompt_payload: dict = Field(default_factory=dict)

class ReflectionOut(BaseModel):
    id: int
    note_id: int
    mode: str
    result_json: dict
    created_at: datetime
    class Config:
        from_attributes = True

# Para mover con JSON
class MoveRequest(BaseModel):
    folder_id: Optional[int] = None
