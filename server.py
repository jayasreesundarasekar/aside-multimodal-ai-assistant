import base64
import os

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

import worker
from utils.extract import UnsupportedFileError, extract_text

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Keep uploads reasonable — big enough for a real document/photo, small
# enough that one request can't tie up the server for minutes.
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024  # 15 MB

ALLOWED_IMAGE_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/webp": "webp",
    "image/gif": "gif",
}


def error_response(message: str, status: int = 400):
    return jsonify({"error": message}), status


@app.errorhandler(413)
def too_large(_e):
    return error_response("That file is larger than the 15 MB upload limit.", 413)


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Chat (text + voice)
# ---------------------------------------------------------------------------


@app.route("/api/speech-to-text", methods=["POST"])
def speech_to_text_route():
    audio_binary = request.data
    if not audio_binary:
        return error_response("No audio was received.")

    try:
        text = worker.speech_to_text(audio_binary)
    except Exception as exc:  # noqa: BLE001 — surface a clean error to the UI
        return error_response(f"Speech-to-text failed: {exc}", 502)

    return jsonify({"text": text})


@app.route("/api/chat", methods=["POST"])
def chat_route():
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    voice = body.get("voice") or ""
    history = body.get("history") or []
    want_audio = body.get("wantAudio", True)

    if not message:
        return error_response("Message can't be empty.")

    try:
        reply_text = worker.chat_with_assistant(message, history)
    except Exception as exc:  # noqa: BLE001
        return error_response(f"The assistant couldn't respond: {exc}", 502)

    audio_b64 = ""
    if want_audio:
        try:
            audio_b64 = worker.audio_to_base64(worker.text_to_speech(reply_text, voice))
        except Exception as exc:  # noqa: BLE001
            # Text reply still succeeded — don't fail the whole request over audio.
            print("text-to-speech failed:", exc)

    return jsonify({"reply": reply_text, "audio": audio_b64})


# ---------------------------------------------------------------------------
# Translation
# ---------------------------------------------------------------------------


@app.route("/api/translate", methods=["POST"])
def translate_route():
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()
    target_language = (body.get("targetLanguage") or "").strip()
    voice = body.get("voice") or ""
    want_audio = body.get("wantAudio", True)

    if not text:
        return error_response("Nothing to translate.")
    if not target_language:
        return error_response("Choose a target language.")

    try:
        result = worker.translate_text(text, target_language)
    except Exception as exc:  # noqa: BLE001
        return error_response(f"Translation failed: {exc}", 502)

    audio_b64 = ""
    if want_audio and result.get("translation"):
        try:
            audio_b64 = worker.audio_to_base64(
                worker.text_to_speech(result["translation"], voice)
            )
        except Exception as exc:  # noqa: BLE001
            print("text-to-speech failed:", exc)

    return jsonify(
        {
            "translation": result.get("translation", ""),
            "detectedLanguage": result.get("detected_language", ""),
            "audio": audio_b64,
        }
    )


# ---------------------------------------------------------------------------
# Document analysis
# ---------------------------------------------------------------------------


@app.route("/api/analyze-document", methods=["POST"])
def analyze_document_route():
    uploaded = request.files.get("file")
    question = (request.form.get("question") or "").strip()

    if uploaded is None or uploaded.filename == "":
        return error_response("No file was uploaded.")

    file_bytes = uploaded.read()
    if not file_bytes:
        return error_response("The uploaded file is empty.")

    try:
        document_text, truncated = extract_text(uploaded.filename, file_bytes)
    except UnsupportedFileError as exc:
        return error_response(str(exc))
    except ValueError as exc:
        return error_response(str(exc))

    try:
        answer = worker.analyze_document(document_text, uploaded.filename, question)
    except Exception as exc:  # noqa: BLE001
        return error_response(f"Document analysis failed: {exc}", 502)

    return jsonify(
        {
            "answer": answer,
            "characters": len(document_text),
            "truncated": truncated,
        }
    )


# ---------------------------------------------------------------------------
# Image analysis / captioning
# ---------------------------------------------------------------------------


@app.route("/api/analyze-image", methods=["POST"])
def analyze_image_route():
    uploaded = request.files.get("file")
    question = (request.form.get("question") or "").strip()

    if uploaded is None or uploaded.filename == "":
        return error_response("No image was uploaded.")

    mime_type = uploaded.mimetype
    if mime_type not in ALLOWED_IMAGE_TYPES:
        return error_response(
            "Unsupported image type. Use PNG, JPEG, WEBP, or GIF."
        )

    file_bytes = uploaded.read()
    if not file_bytes:
        return error_response("The uploaded image is empty.")

    try:
        answer = worker.analyze_image(file_bytes, mime_type, question)
    except Exception as exc:  # noqa: BLE001
        return error_response(f"Image analysis failed: {exc}", 502)

    return jsonify(
        {
            "answer": answer,
            "preview": f"data:{mime_type};base64,{base64.b64encode(file_bytes).decode('utf-8')}",
        }
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
