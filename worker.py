"""All calls to the OpenAI API live here, so server.py only has to think
about routing, not prompts or model choice.
"""
import base64
import json
import os

from openai import OpenAI

client = OpenAI()

CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "whisper-1")
TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "tts-1")
DEFAULT_TTS_VOICE = "alloy"

ASSISTANT_SYSTEM_PROMPT = (
    "You are a helpful, personable assistant embedded in a chat app. "
    "You can hold a conversation, answer questions, and help with tasks. "
    "Keep replies concise and conversational — a few sentences unless the "
    "user clearly wants more detail or asks for a list, code, or a longer "
    "explanation."
)

# ---------------------------------------------------------------------------
# Speech
# ---------------------------------------------------------------------------


def speech_to_text(audio_bytes: bytes, filename: str = "recording.webm") -> str:
    """Transcribe recorded audio using Whisper."""
    audio_file = (filename, audio_bytes)
    transcript = client.audio.transcriptions.create(
        model=TRANSCRIBE_MODEL,
        file=audio_file,
    )
    return transcript.text.strip()


def text_to_speech(text: str, voice: str = "") -> bytes:
    """Turn text into spoken audio (MP3 bytes)."""
    if not text:
        return b""

    voice = voice or DEFAULT_TTS_VOICE
    response = client.audio.speech.create(
        model=TTS_MODEL,
        voice=voice,
        input=text,
    )
    return response.read()


def audio_to_base64(audio_bytes: bytes) -> str:
    return base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------


def chat_with_assistant(message: str, history: list | None = None) -> str:
    """Send a message (with recent history for context) and return the reply."""
    messages = [{"role": "system", "content": ASSISTANT_SYSTEM_PROMPT}]

    for turn in (history or [])[-12:]:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": message})

    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=messages,
        max_completion_tokens=800,
    )
    return response.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Translation
# ---------------------------------------------------------------------------


def translate_text(text: str, target_language: str) -> dict:
    """Translate text and report the language it detected the source as."""
    prompt = (
        "Translate the user's text into "
        f"{target_language}. Respond with ONLY a JSON object of the form "
        '{"detected_language": "<name of the source language>", '
        '"translation": "<translated text>"}. '
        "No markdown, no code fences, no extra commentary."
    )

    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": text},
        ],
        max_completion_tokens=1500,
    )

    raw = response.choices[0].message.content.strip()
    raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    try:
        parsed = json.loads(raw)
        return {
            "translation": parsed.get("translation", "").strip(),
            "detected_language": parsed.get("detected_language", "").strip(),
        }
    except (json.JSONDecodeError, AttributeError):
        # Model didn't return clean JSON — fall back to using the raw text
        # as the translation so the user still gets an answer.
        return {"translation": raw, "detected_language": ""}


# ---------------------------------------------------------------------------
# Document analysis
# ---------------------------------------------------------------------------

DOCUMENT_SYSTEM_PROMPT = (
    "You are a careful document analyst. You'll be given the text of an "
    "uploaded document and a question about it. Answer using only "
    "information in the document. If the answer isn't in the document, say "
    "so plainly instead of guessing. Keep answers focused and readable — "
    "use short paragraphs or a bulleted list where that helps."
)

DEFAULT_DOCUMENT_QUESTION = (
    "Give a concise summary of this document: what it's about, its main "
    "points, and anything a reader should notice first."
)


def analyze_document(document_text: str, filename: str, question: str | None) -> str:
    question = (question or "").strip() or DEFAULT_DOCUMENT_QUESTION

    user_content = (
        f"Document filename: {filename}\n\n"
        f"--- DOCUMENT TEXT ---\n{document_text}\n--- END DOCUMENT TEXT ---\n\n"
        f"Question: {question}"
    )

    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": DOCUMENT_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        max_completion_tokens=900,
    )
    return response.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Image analysis / captioning
# ---------------------------------------------------------------------------

IMAGE_SYSTEM_PROMPT = (
    "You are an attentive visual assistant. Describe and answer questions "
    "about images accurately and specifically — name objects, layout, "
    "colors, text you can read, and mood where relevant. If you're unsure "
    "about a detail, say so rather than guessing."
)

DEFAULT_IMAGE_QUESTION = (
    "Caption this image in one short sentence, then give a slightly more "
    "detailed description in 2-3 sentences below it."
)


def analyze_image(image_bytes: bytes, mime_type: str, question: str | None) -> str:
    question = (question or "").strip() or DEFAULT_IMAGE_QUESTION
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{mime_type};base64,{encoded}"

    response = client.chat.completions.create(
        model=VISION_MODEL,
        messages=[
            {"role": "system", "content": IMAGE_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": question},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
        max_completion_tokens=700,
    )
    return response.choices[0].message.content.strip()
