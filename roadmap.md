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
- [ ] Swap SQLite → Postgres (Supabase/Railway/Neon) so a phone can hit it.
- [ ] Deploy FastAPI somewhere reachable (Railway/Render/Fly.io) with secrets
      as real env vars, not a `.env` sitting next to code.
- [ ] Add real auth. `User` model exists but is unused — every note is global.
      Add token-based auth and scope notes/folders/reflections to `user_id`.
- [ ] Lock CORS down to the deployed app's real origin(s).
- [ ] Repo hygiene: fix the stray/misspelled `requirements.txt`, ensure
      `.venv`/`.env` are gitignored and untracked.

## Phase 2 — Mobile app shell (Expo / React Native)
- [ ] New Expo (React Native) project — replaces `frontend/`, not a port of
      it: Tailwind/DOM CSS and `EventSource` don't exist in RN.
- [ ] Re-implement note list/folders, note editor, and reflect panel as
      native screens with React Navigation.
- [ ] Replace SSE with a RN-compatible streaming approach (chunked fetch
      streaming instead of `EventSource`).
- [ ] Get it running in Expo Go on a real phone — first "it works on my
      phone" milestone.

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
- **Current phase:** Phase 1 (backend)
