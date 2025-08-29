# Journaling AI App ✍️🤖

A minimal, Apple Notes–style journaling app with AI reflections. Users can write notes and send them to an AI to get insights in three modes (Socratic, Structured, Weekly). The UI supports **live streaming** (SSE) so reflections appear in real time.

## Tech Stack
- **Frontend:** Vite + React + TailwindCSS  
- **Backend:** FastAPI (Python) + SQLAlchemy + SQLite  
- **AI:** OpenAI API with **SSE** streaming endpoint

## Features
- Create, edit, delete notes
- AI reflections with three modes:
  - **Socratic:** questions + next action
  - **Structured:** why-it-matters, assumptions, risks, first step, success metric
  - **Weekly:** themes, belief to challenge, micro-experiment
- Live streaming (text appears progressively)
- Create sub-notes from reflections

## Monorepo Layout
├─ Backend/ # FastAPI app

│ ├─ main.py
│ ├─ ... (routers/services)
│ └─ requirements.txt # Python deps for Backend
├─ frontend/ # Vite + React + Tailwind
│ ├─ package.json
│ └─ src/...
└─ README.md # This file


## Prerequisites
- **Python 3.10+**
- **Node 18+** (or newer)
- An **OpenAI API key**

## Setup

### Backend
```bash
cd Backend
python -m venv venv
# macOS/Linux:
source venv/bin/activate
# Windows (PowerShell):
# .\venv\Scripts\Activate.ps1

pip install -r requirements.txt

# run the API
uvicorn Backend.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
# point the frontend to the backend (default shown)
VITE_API_BASE=http://127.0.0.1:8000 npm run dev
```
Open the app at http://localhost:5173

### Environment Variables (Backend)

Create a file named .env inside the Backend/ folder. At minimum:

#### OpenAI
```OPENAI_API_KEY=sk-xxxx...```

#### Database (pick ONE of the two lines below)
For SQLite local (default):
```DATABASE_URL=sqlite:///./app.db```
Or for a file in absolute path (Windows example):
```DATABASE_URL=sqlite:///C:/path/to/app.db```

## How Streaming Works (quick)
- Backend exposes /ai/reflect/stream (SSE).
- Frontend uses streamReflect() and renders a formatted preview while chunks arrive.
- When the model finishes, the final structured result is shown (no raw JSON on screen).

## Common Comands

### Backend
From the root:
```uvicorn Backendmain:app --reload --port 8000```

### Frontend
From frontend/
```npm run dev```


## Troubleshooting
- **No live output?** Verify the streaming URL is set via VITE_API_BASE and the backend is running on :8000.
- **OpenAI errors?** Make sure OPENAI_API_KEY is set in Backend/.env and your key has access to the model you use.
- **DB issues?** Confirm DATABASE_URL points to a writable SQLite file (or your chosen DB).

## License
This project is licensed under the MIT License.  
See the [LICENSE](./LICENSE) file for details.

