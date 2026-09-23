# AI Journaling App — Roadmap

Goal: a mobile app (iOS/Android via React Native/Expo) where people write notes,
highlight portions of them, and get AI reflections/insights — including a
scoped mini-chat inside a note — with a clean, Apple-Notes-like feel.

## Phase 0 — Salvage (done as analysis)
Keep the FastAPI note/folder CRUD logic and the `ai_stream.py` prompt design
(Socratic / structured / weekly reflection modes with JSON-schema output).
These are backend logic and carry forward unchanged in spirit; only the
transport (SSE) and storage layer change in later phases.

Since then: prompts rewritten in English, and the "structured" mode reframed
from a rigid business-analysis checklist to an actual expansion of the
user's own reflection — connected ideas, alternative perspectives, one
thread worth exploring next. Model bumped to `gpt-5.6-luna`.

## Phase 1 — Backend: make it reachable and safe
- [x] Swap SQLite → Postgres. Using Supabase project "Journaling App"
      (`eqmgfasourirfmaurrlb`), schema applied via migration. Connect
      through the session pooler host, not `db.<ref>.supabase.co` directly —
      that host is IPv6-only and won't resolve on most networks.
- [x] Deploy FastAPI to Railway: https://journaling-app-backend-production.up.railway.app
      (project `journaling-app-backend`), secrets as Railway env vars.
      Single root-level `requirements.txt`/`.venv`/`Procfile` — matches
      what Railway's build already needed, so there's no more duplicate
      dependency list to keep in sync.
- [x] Add real auth (JWT + bcrypt), notes/folders/reflections scoped to
      `user_id`.
- [x] Lock CORS down via `ALLOWED_ORIGINS` env var.
- [x] Repo hygiene: `requirements.txt` fixed, `.venv`/`.env` gitignored.

## Phase 2 — Mobile app shell (Expo / React Native)
- [x] New Expo (React Native + TypeScript) project in `mobile/` — replaces
      `frontend/`, not a port of it: Tailwind/DOM CSS and `EventSource`
      don't exist in RN.
- [x] Auth screens wired to the Phase 1 backend, token in `expo-secure-store`.
- [x] Note list + note editor (autosave) + reflect panel as native screens
      with React Navigation.
- [x] Folders UI: filter bar + create/delete on the notes list, move-to-
      folder picker in the note editor.
- [x] Streaming reflection via `expo/fetch`'s ReadableStream body reader,
      parsing the backend's SSE frames by hand (also fixes an auth gap:
      browser `EventSource` can't send an Authorization header, but this
      fetch-based reader can).
- [x] Verified on a real phone via Expo Go. Found and fixed along the way:
      a folder-creation double-submit race (409 on duplicate names now
      instead of an unhandled 500), a note-creation race that could create
      the same note multiple times under slow network conditions, and made
      the streaming reflect call resilient (stall timeout + automatic
      fallback to the non-streaming endpoint) after some networks turned
      out to silently kill long-lived connections.
- [x] UI pass: `@expo/vector-icons`, a shared `src/theme.ts`, and proper
      `useSafeAreaInsets()` everywhere (previously hardcoded `paddingTop`
      values that don't adapt to different notches/status bars).

## Phase 3 — Differentiating features
- [x] Text selection → "ask AI about this part": the editor tracks the
      body's selection; the reflect modes then focus on just that passage
      (sent as code-point offsets, sliced server-side from the saved note
      with ~600 chars of context either side), and "Ask AI" quotes it into
      the note chat. Pending autosaves are flushed first so offsets match.
- [x] Mini chat scoped to a note: `chat_messages` table (note_id, role,
      content, quote, created_at; migration `add_chat_messages`) +
      `/notes/{id}/chat` endpoints; threaded chat panel in the note screen.
      Posting a message and generating the reply are separate calls so a
      reply killed mid-network can be retried non-streaming without
      duplicating the user's message.
- [ ] Apple-Notes-like editor (e.g. `@10play/tentap-editor`) instead of a
      bare `TextInput`, for selection toolbars and smooth scrolling.

## Phase 4 — Shippability
- [ ] Offline-first local storage (`expo-sqlite` or WatermelonDB) syncing to
      backend.
- [ ] Error/loading states, onboarding, app icon/splash.
- [ ] EAS Build for TestFlight / Play internal testing.
- [ ] Basic tests around the reflect/streaming path (flakiest part).

---

## Status
- **Phases 1 and 2 are complete.** Backend is live on Railway, Postgres on
  Supabase, mobile app tested on a real phone via Expo Go.
- **Phase 3:** highlight-to-AI and note chat are built, deployed, and
  working on a phone. Getting there fixed three streaming bugs that had been
  hidden behind the non-streaming fallback since Phase 2: `temperature` was
  rejected by the model (every call silently used the fallback model), the
  sync OpenAI client blocked the server's event loop, and the app's SSE
  parser split on `\n\n` while the server sends CRLF (it never saw a single
  frame). Reflections now also render formatted while streaming (partial
  JSON parsing) instead of as raw JSON. The rich-text editor is still
  open — it means storing HTML instead of plain text, so it needs a
  decision on content format first.
