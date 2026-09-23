# Journaling AI App ✍️🤖

A minimal, Apple Notes–style journaling app with AI reflections. Write notes on your phone
and get AI insights in three modes (Socratic, Structured/Expand, Weekly), streamed live as
they're generated.

See [`roadmap.md`](./roadmap.md) for the full build plan and current status.

## Tech Stack
- **Mobile app:** Expo (React Native + TypeScript)
- **Backend:** FastAPI (Python) + SQLAlchemy, deployed on Railway
- **Database:** Postgres, hosted on Supabase
- **AI:** OpenAI API, streamed via SSE

## Layout
```
├─ Backend/          # FastAPI app (package name capitalized — referenced as
│                     Backend.main:app by the Procfile; don't rename lightly)
│  ├─ main.py         # routes
│  ├─ models.py       # SQLAlchemy models
│  ├─ schemas.py       # Pydantic schemas
│  ├─ crud.py         # DB access
│  ├─ auth.py         # JWT + password hashing
│  ├─ ai_stream.py     # OpenAI prompts + streaming
│  └─ .env            # local secrets (gitignored) — see .env.example
├─ mobile/           # Expo app — the actual client
├─ requirements.txt  # single source of truth for Python deps (used for both
│                     local dev and Railway's build — keep it at the root)
├─ Procfile          # Railway's start command
└─ roadmap.md
```

## Local development

### Backend
```bash
python -m venv .venv
# Windows:
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
cp Backend/.env.example Backend/.env   # fill in OPENAI_API_KEY, DATABASE_URL, JWT_SECRET_KEY

# run from the repo root (Backend is a package, not a standalone script)
uvicorn Backend.main:app --reload --host 0.0.0.0 --port 8000
```
`--host 0.0.0.0` matters if you want to test against a phone on the same Wi-Fi instead of
the deployed Railway backend — see `mobile/README.md`.

### Mobile app
```bash
cd mobile
npm install
npm start
```
Scan the QR code with Expo Go. By default it talks to the deployed Railway backend; see
`mobile/README.md` to point it at a local backend instead.

## How streaming works (quick)
- Backend exposes `/ai/reflect/stream` (SSE).
- The mobile app parses the SSE frames itself via a `fetch` streaming body reader (not
  `EventSource` — that can't send an Authorization header, which native `fetch` can).
- If the stream stalls or errors before any data arrives (some networks kill long-lived
  connections), it falls back to the non-streaming `/notes/{id}/reflect` endpoint.

## Troubleshooting
- **AI errors?** Make sure `OPENAI_API_KEY` is set and your key has access to the model in
  `OPENAI_MODEL`.
- **DB issues?** Confirm `DATABASE_URL` points at Supabase's *session pooler* host, not
  `db.<ref>.supabase.co` directly — that host is IPv6-only and won't resolve on most networks.

## License
This project is licensed under the MIT License.
See the [LICENSE](./LICENSE) file for details.
