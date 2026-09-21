# AI Journaling App — Roadmap

Goal: a mobile app (iOS/Android via React Native/Expo) where people write notes,
highlight portions of them, and get AI reflections/insights — including a
scoped mini-chat inside a note — with a clean, Apple-Notes-like feel.

## Phase 0 — Salvage (done as analysis)
Keep the FastAPI note/folder CRUD logic and the `ai_stream.py` prompt design
(Socratic / structured / weekly reflection modes with JSON-schema output).
These are backend logic and carry forward unchanged in spirit; only the
transport (SSE) and storage layer change in later phases.

## Phase 1 — Backend: make it reachable and safe
- [x] Swap SQLite → Postgres. Using Supabase project "Journaling App"
      (`eqmgfasourirfmaurrlb`), schema applied via migration. Connect
      through the session pooler host, not `db.<ref>.supabase.co` directly —
      that host is IPv6-only and won't resolve on most networks.
- [ ] Deploy FastAPI somewhere reachable (Railway/Render/Fly.io) with secrets
      as real env vars, not a `.env` sitting next to code.
- [ ] Add real auth. `User` model exists but is unused — every note is global.
      Add token-based auth and scope notes/folders/reflections to `user_id`.
- [ ] Lock CORS down to the deployed app's real origin(s).
- [ ] Repo hygiene: fix the stray/misspelled `requirements.txt`, ensure
      `.venv`/`.env` are gitignored and untracked.

## Phase 2 — Mobile app shell (Expo / React Native)
- [x] New Expo (React Native + TypeScript) project in `mobile/` — replaces
      `frontend/`, not a port of it: Tailwind/DOM CSS and `EventSource`
      don't exist in RN.
- [x] Auth screens wired to the Phase 1 backend, token in `expo-secure-store`.
- [x] Note list + note editor (autosave) + reflect panel as native screens
      with React Navigation.
- [ ] Folders UI (backend supports it; app currently shows a flat list).
- [ ] Replace the current blocking non-streaming reflect call with a RN-
      compatible streaming approach (chunked fetch instead of `EventSource`,
      which doesn't exist in RN).
- [ ] Verify on a real phone via Expo Go (bundles cleanly on web/Metro as
      of this pass; physical-device check still pending).

## Phase 3 — Differentiating features
- [ ] Text selection → "ask AI about this part": track selection range in
      the editor, send just that substring + surrounding context to a
      reflect call.
- [ ] Mini chat scoped to a note: new `chat_messages` table (note_id, role,
      content, created_at) + endpoint; small threaded chat view inside the
      note screen.
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
- **Current phase:** Phase 2 (mobile shell) — core screens built, needs a
  real-device check via Expo Go and folders UI.
