# Journal — mobile app (Expo)

Phase 2 of `../roadmap.md`: a React Native app you run on your phone via Expo Go.

## Run it

```
npm start
```

Scan the QR code with Expo Go (iOS/Android). The app talks to the backend deployed on
Railway (`https://journaling-app-backend-production.up.railway.app`) by default — no need
to be on the same Wi-Fi as any particular machine.

To point at a local backend instead (while developing the backend itself), run:
```
EXPO_PUBLIC_API_BASE=http://<your-lan-ip>:8000 npm start
```
and start the backend with `uvicorn Backend.main:app --host 0.0.0.0 --port 8000` so it's
reachable over the LAN, not just `127.0.0.1`.

## What's here

- Email/password auth (`src/auth/AuthContext.tsx`), token persisted via `expo-secure-store`.
- Notes list with folders (filter bar, create/delete, move notes between folders).
- Note editor with autosave and AI reflection (Structured/Socratic/Weekly modes), streamed
  live via `src/api/client.ts`'s `streamReflect` (falls back to the non-streaming endpoint
  if the connection stalls or errors before any data arrives).

## Not yet built (Phase 3+)

- Highlight-a-passage → ask AI about just that selection.
- In-note mini chat.
- Offline-first local storage.
