# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Studio — a full-stack web app for AI video, image, script, and voiceover generation using Google Vertex AI (Veo, Imagen, Gemini) and Gemini TTS. Deployed on Vercel as static HTML + Node.js serverless functions.

## Development Commands

```bash
# Install dependencies (Node.js >= 18 required)
npm install

# Deploy to Vercel (no local dev server — frontend is static HTML)
vercel deploy

# Run a specific API function locally (Vercel CLI)
vercel dev
```

There is no build step. Frontend is plain HTML/CSS/JS files served statically. The only npm dependency is `@google/genai`; all other libraries (ffmpeg.wasm, Remotion) are loaded via CDN ESM imports in the HTML files.

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
- `workflow.html` — end-to-end pipeline (optional style → script → scenes → visuals → audio)
- `style-cloner.html` — clone a video's visual style (YouTube URL or file upload → Gemini analysis → style template kit)
- `assets.html` — style library: browse, select, and delete saved visual style templates

### Backend (`api/` — Vercel serverless functions)
Each file in `api/` maps to a route. All functions proxy requests to Google APIs and add CORS headers. Key functions:
- `api/login.js` / `api/callback.js` — Google OAuth 2.0 redirect flow
- `api/generate.js` — Vertex AI Veo video generation
- `api/poll.js` — poll long-running Vertex AI operations
- `api/image.js` — Imagen 3.0 or Gemini Flash image generation (model selected by request)
- `api/script.js` — Gemini 2.5 streaming script generation (SSE)
- `api/agent.js` — Gemini 2.5 Pro structured production plan (JSON schema)
- `api/analyze-script.js` — break a script into scenes with prompts and durations
- `api/analyze-style.js` — Gemini video understanding to extract visual style as a template kit; accepts YouTube URL (via `fileData.fileUri`) or base64 frames array
- `api/styles.js` — CRUD for visual style templates stored in GCS under `styles/` prefix (GET=list, POST=save, DELETE=delete)
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
| Style analysis | `gemini-2.0-flash-001` (video understanding; YouTube URLs and image frames) |

### Routing
`vercel.json` rewrites clean paths (`/dashboard`, `/video`, etc.) to the corresponding `.html` files.

### Workflow Pipeline (`workflow.html`)
The workflow page is a 5-phase sequential pipeline. Phase 0 is optional:
0. **Style (optional)** — select a saved visual style template from GCS (`api/styles.js`); stored in `wfSelectedStyle`; can be skipped
1. **Script** — generates narration via `api/script.js` (SSE stream)
2. **Scenes** — calls `api/analyze-script.js` to split script into a structured JSON array of scenes (`sceneNumber`, `sceneTitle`, `voiceoverText`, `imagePrompt`, `videoPrompt`, `duration`)
3. **Assets** — generates voiceover (TTS), images, or video per scene; results stored in `studioAssets[sceneIndex].{vo, img, vid}`; when `wfSelectedStyle` is set, `buildStyledPrompt()` wraps each image prompt with the style's `masterTemplate`
4. **Render** — in-browser video assembly using `@ffmpeg/ffmpeg` (ESM CDN import, single-threaded core, no COOP/COEP headers required); alternatively downloads a Remotion project ZIP

Asset mode (images / video / both) is selectable and controls which prompts `api/analyze-script.js` is instructed to emphasize.

### Visual Style Cloner (`style-cloner.html`)
- **YouTube URL mode**: passes URL directly to Vertex AI Gemini via `fileData.fileUri` — no download needed
- **Upload mode**: extracts 14 evenly-spaced JPEG frames client-side using HTML5 Canvas; sends as `inlineData` parts
- Analysis returned as a JSON style kit: `styleName`, `colorPalette`, `signatureElements`, `masterTemplate`, `sceneTemplates` (portrait/group/environment/action/object/titleCard)
- Saved styles stored in GCS at `styles/{id}.json`; thumbnail is the first extracted frame (base64)
- After saving, stores style ID in `sessionStorage.workflow_style_id` so Workflow auto-selects it

### Streaming
`api/script.js` uses Server-Sent Events (SSE) to stream tokens to the browser. The frontend listens with `EventSource`-style `fetch` + `ReadableStream`.
