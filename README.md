# Aside — a multimodal AI assistant

A chat app powered entirely by the OpenAI API: talk to it by text or voice,
translate speech or text between languages, hand it a PDF/DOCX to summarize
and question, or drop in a photo for a caption and follow-up questions.

This is a rebuild of the original voice-assistant starter project — the UI
is redesigned, IBM Watson's STT/TTS endpoints have been replaced with
OpenAI's own (Whisper + TTS), and document analysis, image analysis/
captioning, and a translator are new.

## Features

- **Chat** — text or voice conversation with short-term memory of the thread.
- **Translate** — type, paste, or speak text; get a translation with audio
  playback and automatic source-language detection.
- **Documents** — drop in a PDF, DOCX, TXT, MD, or CSV file, get an instant
  summary, then ask follow-up questions about its contents.
- **Image** — upload a photo (PNG/JPEG/WEBP/GIF) for an automatic caption
  and description, then ask questions about what's in it.
- Light/dark mode, drag-and-drop uploads, and a responsive layout that
  collapses to a bottom tab bar on mobile.

## Setup

1. **Install dependencies**

   ```bash
   python -m venv .venv
   source .venv/bin/activate        # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Add your OpenAI API key**

   ```bash
   cp .env.example .env
   ```

   Then open `.env` and paste in your key from
   <https://platform.openai.com/api-keys>. The other variables in
   `.env.example` are optional — the defaults already work.

3. **Run it**

   ```bash
   python server.py
   ```

   Visit <http://localhost:8000>.

## Running with Docker

```bash
docker build -t aside .
docker run -p 8000:8000 --env-file .env aside
```

## How it's put together

```
server.py          Flask routes — request/response handling only
worker.py           All OpenAI calls: chat, Whisper (STT), TTS, translation,
                    document analysis, image analysis
utils/extract.py    Pulls plain text out of uploaded PDF/DOCX/text files
templates/index.html   Single-page shell — one panel per mode
static/style.css    Design system (CSS custom properties, dark mode)
static/app.js        All client-side behavior, no build step required
```

### API endpoints

| Route                     | Method | Purpose                                   |
| -------------------------- | ------ | ------------------------------------------ |
| `/api/chat`                | POST   | Send a message, get a reply + spoken audio |
| `/api/speech-to-text`      | POST   | Transcribe recorded audio (raw body)       |
| `/api/translate`           | POST   | Translate text, with detected source lang  |
| `/api/analyze-document`    | POST   | Summarize/answer questions about a file    |
| `/api/analyze-image`       | POST   | Caption/answer questions about an image    |

### Notes

- Uploads are capped at 15 MB (`server.py: MAX_CONTENT_LENGTH`).
- Document text is capped at 20,000 characters per request
  (`utils/extract.py: MAX_CHARS`) to keep responses fast and affordable —
  the UI tells you if a document was truncated.
- Nothing is persisted server-side: conversation history, translated text,
  and uploaded documents/images live in the browser tab only and reset on
  reload.
- Model names (`gpt-4o-mini`, `whisper-1`, `tts-1`) are set via environment
  variables in `worker.py` — swap them for whichever current OpenAI models
  you prefer to use.
