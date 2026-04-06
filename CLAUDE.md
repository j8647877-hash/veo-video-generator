# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Studio — a full-stack web app for AI video, image, script, and voiceover generation using Google Vertex AI (Veo, Imagen, Gemini) and Gemini TTS. Deployed on Vercel as static HTML + Node.js serverless functions.

## Development Commands

```bash
# Install dependencies
npm install

# Deploy to Vercel (no local dev server — frontend is static HTML)
vercel deploy

# Run a specific API function locally (Vercel CLI)
vercel dev
```

There is no build step. Frontend is plain HTML/CSS/JS files served statically.

## Required Environment Variables

Set these in Vercel project settings or a local `.env` file (gitignored):

```
GOOGLE_CLIENT_ID        # OAuth 2.0 client ID
GOOGLE_CLIENT_SECRET    # OAuth 2.0 client secret
GOOGLE_PROJECT_ID       # Vertex AI GCP project ID
GOOGLE_GCS_BUCKET       # GCS bucket for storing generated assets
GEMINI_API_KEY          # Gemini API key (used by TTS endpoint)
```

## Architecture

### Frontend (root `*.html` files)
Static pages with inline JavaScript — no framework, no bundler:
- `index.html` — Google OAuth login
- `dashboard.html` — navigation hub
- `video.html` — Veo video generation
- `image.html` — Imagen/Gemini image generation
- `tts.html` — Gemini TTS voiceover
- `script.html` — Gemini script writing (streaming SSE)
- `agent.html` — structured production planning (JSON schema output)
- `workflow.html` — end-to-end pipeline (script → scenes → visuals → audio)

### Backend (`api/` — Vercel serverless functions)
Each file in `api/` maps to a route. All functions proxy requests to Google APIs and add CORS headers. Key functions:
- `api/login.js` / `api/callback.js` — Google OAuth 2.0 redirect flow
- `api/generate.js` — Vertex AI Veo video generation
- `api/poll.js` — poll long-running Vertex AI operations
- `api/image.js` — Imagen 3.0 or Gemini Flash image generation (model selected by request)
- `api/script.js` — Gemini 2.5 streaming script generation (SSE)
- `api/agent.js` — Gemini 2.5 Pro structured production plan (JSON schema)
- `api/analyze-script.js` — break a script into scenes with prompts and durations
- `api/tts.js` — Gemini TTS → PCM → WAV wrapping
- `api/config.js` — expose public config (bucket, projectId) to frontend
- `api/setup-cors.js` — configure CORS on the GCS bucket

### Auth Flow
1. Browser hits `/api/login` → redirects to Google OAuth consent
2. Google redirects to `/api/callback` → exchanges code for tokens → redirects to `/dashboard` with tokens in URL fragment
3. Frontend stores tokens in `sessionStorage`; passes access token as `Authorization: Bearer` header on all API calls

### Models in Use
| Feature | Model |
|---------|-------|
| Video | `veo-3.1-lite-generate-001` |
| Images | `imagen-3.0-generate-001` or `gemini-3.1-flash-image-preview` |
| Scripting | `gemini-2.5-flash` / `gemini-2.5-pro` |
| Production planning | `gemini-2.5-pro` |
| TTS | `gemini-2.5-flash-preview-tts` |

### Routing
`vercel.json` rewrites clean paths (`/dashboard`, `/video`, etc.) to the corresponding `.html` files.

### Streaming
`api/script.js` uses Server-Sent Events (SSE) to stream tokens to the browser. The frontend listens with `EventSource`-style `fetch` + `ReadableStream`.
