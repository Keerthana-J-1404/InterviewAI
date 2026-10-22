# InterviewAI

An AI-powered mock interview platform for students and job seekers. Upload your resume, answer questions generated from your own experience, then practise in a live camera-and-microphone interview. The goal is feedback you can act on: what you did well, what to fix, and whether you are actually ready for the role.

> **Status:** early-stage prototype. Sign-in, resume analysis and the text interview work. The live interview is implemented but not yet reliable (see [Live interview status](#live-interview-status)). Final analysis and readiness scoring are planned (see [Roadmap](#roadmap)).

**Project status:** Early-stage prototype. Live deployment and screenshots will be added as the project develops.
---

## How it works

1. **Sign in** with Google (Firebase Authentication).
2. **Upload your resume** (PDF). The backend extracts the text and Gemini analyses it.
3. **Optionally** tell the app the role, company, and paste a job description. Every one of these is skippable so nobody is blocked from practising.
4. **Text interview:** Gemini generates questions from your resume (and the role context if you gave it). You answer them in the browser.
5. **Live interview:** a camera and microphone session with speech recognition.
6. **Analysis and feedback** (in progress): strengths, weaknesses, concepts to revise, and, from your second interview onward, a comparison against your previous attempt.

## Features

| Feature | Status |
| --- | --- |
| Google sign-in, verified server-side with Firebase Admin | Done |
| User sync from Firebase to Postgres | Done |
| Resume upload and PDF text extraction (PyMuPDF) | Done |
| Gemini resume analysis and question generation | Done |
| Text interview flow | Done |
| Live interview: camera and microphone access | Done |
| Live interview: `/start`, `/respond`, `/finalize` workflow | Implemented, reliability issues |
| Live interview: speech recognition and transcript capture | Unstable |
| Full interview analysis (pros/cons, confidence, body language, concepts to focus on) | Planned |
| Comparison with your previous interview | Planned |
| Job-readiness score (percentage and scale) | Planned |
| Interview history API (backend retrieval) | Done |
| Interview history page (frontend) | Planned |
| Dashboard | Planned |

### Live interview status

**Implemented:**

- Camera and microphone access in the browser
- Speech recognition during the interview
- The `/start`, `/respond`, `/finalize` workflow on the backend

**Known issues** (why this is not marked done):

- **Speech recognition reliability:** recognition quality and continuity are inconsistent.
- **Transcript capture:** the transcript is not yet captured dependably, which the final analysis depends on.
- **Backend AI availability:** AI-generated responses depend on the AI service being reachable, and this has been inconsistent.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Vite |
| Auth | Firebase Authentication (Google Sign-In), Firebase Admin SDK on the backend |
| Backend | FastAPI (Python) |
| Database | PostgreSQL on Neon, via SQLAlchemy and psycopg |
| AI | Google Gemini API |
| Resume parsing | PyMuPDF |
| Hosting | Render (backend), Vercel (frontend) |

## Architecture

```mermaid
flowchart LR
    B[React + Vite<br/>browser] -->|Google Sign-In| F[Firebase Auth]
    B -->|REST + Firebase ID token| A[FastAPI backend]
    A -->|verify token| F
    A -->|SQLAlchemy| D[(Neon PostgreSQL)]
    A -->|prompts| G[Gemini API]
    A -->|parse PDF| P[PyMuPDF]
```

The browser never talks to the database or to Gemini directly. Every protected request carries a Firebase ID token, the backend verifies it, and the verified Firebase UID decides whose data is read or written. The Gemini API key stays on the server.

## Getting started

### Prerequisites

- Python 3.12 (the tested version; Python 3.14 caused dependency compatibility issues)
- Node.js, current LTS
- A Firebase project with the Google sign-in provider enabled
- A Neon PostgreSQL database
- A Gemini API key

### 1. Backend

From the repository root (Windows PowerShell shown):

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create `backend/.env`:

```env
DATABASE_URL=postgresql+psycopg://<user>:<password>@<host>/<db>?sslmode=require
GEMINI_API_KEY=<your-gemini-key>

# Firebase Admin: use ONE of the two options below (see "Backend authentication")
GOOGLE_APPLICATION_CREDENTIALS=<path-to-service-account.json>
# FIREBASE_PROJECT_ID=...
# FIREBASE_CLIENT_EMAIL=...
# FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Run it:

```powershell
.\venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

The API runs at `http://127.0.0.1:8000`. Interactive API docs are at `http://127.0.0.1:8000/docs`.

### 2. Frontend

```powershell
cd frontend
npm install
```


Create `frontend/.env` with your Firebase web app config:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

```powershell
npm run dev
```

The app runs at `http://localhost:5173`. Camera and microphone access only work on `localhost` or over HTTPS.

## Backend authentication

Protected API requests must include a Firebase ID token in the header:

```text
Authorization: Bearer <firebase-id-token>
```

For local development, configure Firebase Admin credentials in `backend/.env` using either:

- `GOOGLE_APPLICATION_CREDENTIALS` pointing to a local service-account JSON file, or
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`.

When using `FIREBASE_PRIVATE_KEY`, store the newlines as the two characters `\n` inside a quoted value. Never commit the service-account file or `.env`.

For Render, set the same variables in the service environment. Prefer the individual variables when file-based secrets are not available. The Firebase project ID must match the project used by the frontend Firebase configuration.

`GET /` remains a public health check. User, resume, question, live interview, finalization, and history endpoints require a valid Firebase ID token.

## Deployment

- **Backend:** Render. Set every variable from `backend/.env` in the service environment.
- **Frontend:** Vercel. Set the `VITE_FIREBASE_*` variables and point the app at the deployed backend URL.
- Add the deployed frontend domain to Firebase **Authentication → Settings → Authorized domains**, or Google sign-in will fail in production.

## Roadmap

- [x] Authentication and user sync
- [x] Resume upload, parsing, and analysis
- [x] Gemini-generated text interview
- [x] Live interview workflow (`/start`, `/respond`, `/finalize`) and interview history API
- [ ] Live interview reliability: speech recognition, transcript capture, backend AI availability
- [ ] Final analysis combining resume, text answers, live transcript, and optional role/company/job description
- [ ] Comparison with the previous interview and improvement tracking
- [ ] Job-readiness score
- [ ] Interview history page and dashboard (frontend)
- [ ] UI design pass

## Security notes

- `.env` files and service-account JSON files are git-ignored. Rotate any key that has ever been committed.
- Resumes and interview answers are personal data. Treat database and API access accordingly.
