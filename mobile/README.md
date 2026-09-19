# Journal — mobile app (Expo)

Phase 2 of `../roadmap.md`: a React Native app you run on your phone via Expo Go.

## Run it

1. Start the backend (from `../Backend`, see its `.env.example`):
   ```
   uvicorn Backend.main:app --host 0.0.0.0 --port 8000
   ```
   `--host 0.0.0.0` matters — your phone needs to reach it over the LAN, not just `127.0.0.1`.
   Make sure `ALLOWED_ORIGINS` in the backend's `.env` includes an origin your app will call from
   (for Expo Go dev this is loose CORS across origins; tighten before shipping).

2. From `mobile/`:
   ```
   npm start
   ```
   Scan the QR code with Expo Go (iOS/Android). The app auto-detects your dev machine's LAN IP
   from Expo's dev server and points the API client at `http://<that-ip>:8000`. Both your phone
   and computer need to be on the same Wi-Fi network.

   Override the API base explicitly if needed:
   ```
   EXPO_PUBLIC_API_BASE=http://192.168.1.23:8000 npm start
   ```

## What's here (Phase 2 scope)

- Email/password auth (`src/auth/AuthContext.tsx`), token persisted via `expo-secure-store`.
- Notes list, note editor with autosave, and AI reflection (structured/Socratic/weekly modes)
  using the non-streaming `/notes/{id}/reflect` endpoint.

## Not yet built (later phases)

- Streaming AI responses (currently a blocking spinner while the backend calls OpenAI).
- Highlight-a-passage → ask AI about just that selection.
- In-note mini chat.
- Folders UI (backend supports folders; this app only lists a flat note list for now).
- Offline-first local storage.
