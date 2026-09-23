# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An AI journaling app: an Expo (React Native) mobile client talking to a FastAPI backend.
Users write notes, optionally organize them into folders, and ask an LLM to reflect on a
note in one of three modes (streamed live). See `roadmap.md` for the full phased build plan
and what's done vs. not yet built — check it before starting new feature work so you don't
duplicate or contradict planned direction.

## Repo layout

- `Backend/` — FastAPI app. Deployed to Railway.
- `mobile/` — Expo (React Native + TypeScript) client. The only client; there is no web
  frontend (an earlier Vite/React one was deleted as dead code).
- `requirements.txt`, `Procfile` (repo root) — used by both local dev and Railway's build.
  Keep `requirements.txt` at the root, not inside `Backend/` — see the Railway section below.

## Commands

### Backend
```bash
python -m venv .venv
.venv\Scripts\Activate.ps1      # Windows; `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp Backend/.env.example Backend/.env   # fill in OPENAI_API_KEY, DATABASE_URL, JWT_SECRET_KEY

# Run from the repo root, not from inside Backend/ — it's a package (Backend.main:app),
# and its modules use relative imports (`from . import database`), so it must be invoked
# with the repo root as the working directory / on the import path.
uvicorn Backend.main:app --reload --host 0.0.0.0 --port 8000
```
There is no test suite or linter configured for the backend yet.

### Mobile
```bash
cd mobile
npm install
npm start          # scan the QR with Expo Go
npx tsc --noEmit   # typecheck — there is no separate lint/test command configured
```
By default the app talks to the deployed Railway backend. To point it at a local backend
instead: `EXPO_PUBLIC_API_BASE=http://<your-lan-ip>:8000 npm start` (and run the backend
with `--host 0.0.0.0` so a phone on the same Wi-Fi can reach it).

## Architecture notes

**Env var loading order matters.** `Backend/database.py` calls `load_dotenv()` at import
time and must be the first backend module imported (it is, via `main.py`'s import order),
because other modules (`auth.py`, `ai_stream.py`) read `os.getenv(...)` at their own import
time. If a new module needs an env var at import time, don't assume `.env` is already
loaded — either import `database` first or call `load_dotenv(find_dotenv())` yourself.

**Auth model.** JWT (`pyjwt`) + `bcrypt` (not `passlib` — it's incompatible with modern
`bcrypt` releases, hence the direct dependency). Every `Folder`/`Note`/`Reflection` row is
scoped to a `user_id`; `crud.py` functions take `user_id` and filter by it — there is no
unscoped "admin" access path. `get_current_user` in `auth.py` is the dependency every
authenticated route uses.

**Database.** Postgres hosted on Supabase, connected via SQLAlchemy through the *session
pooler* host (`aws-0-<region>.pooler.supabase.com`), not `db.<ref>.supabase.co` directly —
that direct host is IPv6-only and won't resolve on most networks/machines. `DATABASE_URL`
in `.env` controls this; local dev can also just use `sqlite:///./notes.db` (the default
if `DATABASE_URL` is unset). `main.py` has a SQLite-only `PRAGMA`-based mini-migration path
(`database.engine.dialect.name == "sqlite"` guard) that Postgres doesn't need since its
schema was created directly via a migration.

**AI reflection streaming.** `Backend/ai_stream.py` builds an English prompt per mode
(`estructurado` = "Expand" — connect the note to other ideas/perspectives, not a rigid
risk-analysis checklist; `socratico` = probing questions; `semanal` = weekly review) and
streams from OpenAI's Responses API, falling back to `chat.completions` if that fails.
`/ai/reflect/stream` (SSE) is the primary path; `/notes/{id}/reflect` is a non-streaming
fallback with the same prompts. The mobile client (`mobile/src/api/client.ts`) does *not*
use `EventSource` for the SSE endpoint — browser `EventSource` can't send an `Authorization`
header, so it hand-parses SSE frames from a `fetch` streaming body reader instead
(`expo/fetch`, frame splitting in `takeSSEFrames` — sse-starlette ends lines with CRLF, so
never split on a bare `"\n\n"`), with a stall-timeout that falls back to the non-streaming endpoint if a
network kills the long-lived connection before any data arrives.
Keep the OpenAI client async (`AsyncOpenAI`): the server is one uvicorn process, and a sync
client blocks its event loop during every model call, stalling all other requests until the
app's 12s stall timer fires. Don't pass `temperature` to the Responses API — `gpt-5.6-luna`
rejects it with a 400, which silently routes every call to the fallback model. SSE routes
send a keep-alive ping every `SSE_PING_SECONDS` (5s), which must stay under that 12s timer.

**Selection-scoped reflections and note chat.** Reflect calls take optional
`selection_start`/`selection_end` offsets, which are Unicode *code points* into the note's
*saved* content (Python indexing) — the client converts from UTF-16 TextInput offsets with
`toCodePointRange` and calls `flushSave()` first so the server's copy matches the screen.
Note chat (`chat_messages`, scoped to a user through its note) splits "post message" from
"generate reply" (`/notes/{id}/chat/reply[/stream]`, 409 if nothing is waiting) so the
non-streaming fallback never duplicates a user message. The stream saves the reply through
a fresh `SessionLocal()` because the request's `get_db` session may be closed by the time
the SSE body runs. Schema changes to Postgres go through a Supabase migration (not
`create_all`), with RLS enabled and no policies like the other tables — only the backend
touches the DB.

**Railway deploy quirk.** Railway's Railpack builder copies `requirements.txt` into the
build context *before* the rest of the repo (for layer caching), so a root `requirements.txt`
containing `-r Backend/requirements.txt` fails (`Backend/` doesn't exist yet at that step).
This is why there's a single `requirements.txt` at the repo root instead — don't reintroduce
a separate one inside `Backend/`.

**Mobile screen structure.** Three screens (`AuthScreen`, `NotesListScreen`,
`NoteEditorScreen`) under `mobile/src/screens/`, wired via `RootNavigator.tsx` which
switches between the auth stack and the main stack based on `AuthContext`'s `user` state.
Shared visual tokens (colors/spacing/radii) live in `mobile/src/theme.ts` — use them rather
than hardcoding hex values or magic numbers. Safe-area insets are handled with
`useSafeAreaInsets()` per-screen (not a global header component), since hardcoded
`paddingTop` values don't adapt across devices.

**Note-creation race handling.** `NoteEditorScreen`'s autosave debounces at 800ms; because
network latency can exceed that, concurrent debounced saves are guarded by a
`creatingNote` ref so a slow in-flight `createNote` call is reused instead of firing a
duplicate create. Similarly, folder creation in `NotesListScreen` guards against a
double-submit race (`onSubmitEditing` + `onBlur` both firing) with a `submittingFolder` ref.
