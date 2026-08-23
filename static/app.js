(() => {
  "use strict";

  const baseUrl = window.location.origin;

  // ---------------------------------------------------------------------
  // Small shared helpers
  // ---------------------------------------------------------------------

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  const toastEl = $("#toast");
  let toastTimer = null;
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 4200);
  }

  async function postJSON(path, body) {
    const response = await fetch(baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  async function postForm(path, formData) {
    const response = await fetch(baseUrl + path, { method: "POST", body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  function playBase64Audio(base64) {
    if (!base64) return;
    const audio = new Audio("data:audio/mp3;base64," + base64);
    audio.play().catch(() => {
      /* Autoplay can be blocked — the replay button still lets them play it. */
    });
    return audio;
  }

  function formatTime() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ---------------------------------------------------------------------
  // Message thread rendering (shared by chat / document / image panels)
  // ---------------------------------------------------------------------

  function addMessage(threadEl, { role, text, audioBase64 }) {
    const row = document.createElement("div");
    row.className = "msg-row" + (role === "user" ? " from-user" : "");

    const bubbleWrap = document.createElement("div");

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.textContent = text;
    bubbleWrap.appendChild(bubble);

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = formatTime();
    bubbleWrap.appendChild(meta);

    row.appendChild(bubbleWrap);

    if (audioBase64) {
      const audioBtn = document.createElement("button");
      audioBtn.type = "button";
      audioBtn.className = "msg-audio";
      audioBtn.setAttribute("aria-label", "Play audio");
      audioBtn.innerHTML =
        '<svg viewBox="0 0 24 24" class="icon"><path d="M4 9.5v5h3.7L13 19V5L7.7 9.5H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.3 7a7 7 0 0 1 0 10"/></svg>';
      audioBtn.addEventListener("click", () => playBase64Audio(audioBase64));
      row.appendChild(audioBtn);
    }

    threadEl.appendChild(row);
    threadEl.scrollTop = threadEl.scrollHeight;
    return row;
  }

  function setTyping(el, isTyping) {
    el.hidden = !isTyping;
  }

  // ---------------------------------------------------------------------
  // Recording (shared by chat mic + translate mic)
  // ---------------------------------------------------------------------

  function createRecorder() {
    let mediaRecorder = null;
    let chunks = [];
    let stream = null;

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.addEventListener("dataavailable", (e) => chunks.push(e.data));
      mediaRecorder.start();
    }

    function stop() {
      return new Promise((resolve) => {
        mediaRecorder.addEventListener("stop", () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          stream.getTracks().forEach((track) => track.stop());
          resolve(blob);
        });
        mediaRecorder.stop();
      });
    }

    return { start, stop };
  }

  function wireMicButton(button, { onTranscript, onError }) {
    let recorder = null;
    let recording = false;

    button.addEventListener("click", async () => {
      if (!recording) {
        try {
          recorder = createRecorder();
          await recorder.start();
          recording = true;
          button.classList.add("is-recording");
          button.title = "Recording — click to stop";
        } catch (err) {
          onError("Couldn't access the microphone. Check your browser's permission settings.");
        }
        return;
      }

      recording = false;
      button.classList.remove("is-recording");
      button.title = "Click to talk";
      button.disabled = true;

      try {
        const blob = await recorder.stop();
        const response = await fetch(baseUrl + "/api/speech-to-text", {
          method: "POST",
          body: blob,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Transcription failed.");
        if (data.text) {
          onTranscript(data.text);
        } else {
          onError("Didn't catch that — try recording again.");
        }
      } catch (err) {
        onError(err.message || "Speech-to-text failed.");
      } finally {
        button.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------
  // Rail: tab switching + theme
  // ---------------------------------------------------------------------

  function initRail() {
    const tabs = $$(".rail-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => {
          t.classList.toggle("is-active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        $$(".panel").forEach((panel) => panel.classList.remove("is-active"));
        $(`#panel-${tab.dataset.mode}`).classList.add("is-active");
      });
    });

    const themeToggle = $("#theme-toggle");
    const stored = localStorage.getItem("aside-theme");
    if (stored === "dark") document.body.classList.add("dark-mode");

    themeToggle.addEventListener("click", () => {
      document.body.classList.toggle("dark-mode");
      localStorage.setItem(
        "aside-theme",
        document.body.classList.contains("dark-mode") ? "dark" : "light"
      );
    });
  }

  // ---------------------------------------------------------------------
  // Chat mode
  // ---------------------------------------------------------------------

  function initChat() {
    const thread = $("#chat-thread");
    const empty = $("#chat-empty");
    const typing = $("#chat-typing");
    const form = $("#chat-composer");
    const input = $("#message-input");
    const micButton = $("#mic-button");
    const voiceSelect = $("#voice-options");

    const history = [];

    async function sendMessage(text) {
      text = text.trim();
      if (!text) return;

      empty.remove();
      addMessage(thread, { role: "user", text });
      history.push({ role: "user", content: text });
      input.value = "";
      setTyping(typing, true);

      try {
        const data = await postJSON("/api/chat", {
          message: text,
          voice: voiceSelect.value,
          history,
          wantAudio: true,
        });
        setTyping(typing, false);
        addMessage(thread, { role: "assistant", text: data.reply, audioBase64: data.audio });
        history.push({ role: "assistant", content: data.reply });
        playBase64Audio(data.audio);
      } catch (err) {
        setTyping(typing, false);
        showToast(err.message || "The assistant is unavailable right now.");
      }
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      sendMessage(input.value);
    });

    $$(".suggestion-chip").forEach((chip) => {
      chip.addEventListener("click", () => sendMessage(chip.dataset.fill));
    });

    wireMicButton(micButton, {
      onTranscript: (text) => sendMessage(text),
      onError: showToast,
    });
  }

  // ---------------------------------------------------------------------
  // Translate mode
  // ---------------------------------------------------------------------

  function initTranslate() {
    const source = $("#translate-source");
    const target = $("#translate-target");
    const button = $("#translate-button");
    const result = $("#translate-result");
    const detectedTag = $("#detected-language-tag");
    const speakBtn = $("#translate-speak");
    const swapBtn = $("#translate-swap");
    const micBtn = $("#translate-mic");

    let lastAudio = "";
    let lastDetected = "";

    async function runTranslate() {
      const text = source.value.trim();
      if (!text) {
        showToast("Type or record something to translate first.");
        return;
      }

      button.disabled = true;
      result.innerHTML = '<span class="translate-placeholder">Translating…</span>';
      speakBtn.disabled = true;

      try {
        const data = await postJSON("/api/translate", {
          text,
          targetLanguage: target.value,
          voice: "alloy",
          wantAudio: true,
        });
        result.textContent = data.translation || "(no translation returned)";
        lastAudio = data.audio;
        lastDetected = data.detectedLanguage || "";

        if (lastDetected) {
          detectedTag.hidden = false;
          detectedTag.textContent = lastDetected;
        } else {
          detectedTag.hidden = true;
        }

        speakBtn.disabled = !lastAudio;
      } catch (err) {
        result.innerHTML = `<span class="translate-placeholder">${err.message || "Translation failed."}</span>`;
        showToast(err.message || "Translation failed.");
      } finally {
        button.disabled = false;
      }
    }

    button.addEventListener("click", runTranslate);

    speakBtn.addEventListener("click", () => playBase64Audio(lastAudio));

    swapBtn.addEventListener("click", () => {
      const translatedText = result.textContent.trim();
      const hasResult = translatedText && !$(".translate-placeholder", result);
      if (hasResult) {
        source.value = translatedText;
      }
      // Rotate the target list forward so swapping feels purposeful even
      // without a perfect language match for the detected source.
      const options = Array.from(target.options).map((o) => o.value);
      const currentIndex = options.indexOf(target.value);
      target.value = options[(currentIndex + 1) % options.length];

      result.innerHTML = '<span class="translate-placeholder">Your translation will appear here.</span>';
      detectedTag.hidden = true;
      speakBtn.disabled = true;
      lastAudio = "";
    });

    wireMicButton(micBtn, {
      onTranscript: (text) => {
        source.value = source.value ? `${source.value} ${text}` : text;
      },
      onError: showToast,
    });
  }

  // ---------------------------------------------------------------------
  // Document mode
  // ---------------------------------------------------------------------

  function initDocument() {
    const dropzone = $("#document-dropzone");
    const fileInput = $("#document-input");
    const workspace = $("#document-workspace");
    const fileNameEl = $("#doc-file-name");
    const clearBtn = $("#doc-file-clear");
    const thread = $("#document-thread");
    const typing = $("#document-typing");
    const form = $("#document-composer");
    const questionInput = $("#document-question-input");

    let currentFile = null;

    function reset() {
      currentFile = null;
      fileInput.value = "";
      workspace.hidden = true;
      dropzone.hidden = false;
      thread.innerHTML = "";
    }

    async function handleFile(file) {
      currentFile = file;
      fileNameEl.textContent = file.name;
      dropzone.hidden = true;
      workspace.hidden = false;
      thread.innerHTML = "";
      await askAboutDocument("");
    }

    async function askAboutDocument(question) {
      if (question) addMessage(thread, { role: "user", text: question });
      setTyping(typing, true);

      const formData = new FormData();
      formData.append("file", currentFile);
      formData.append("question", question);

      try {
        const data = await postForm("/api/analyze-document", formData);
        setTyping(typing, false);
        let text = data.answer;
        if (data.truncated) {
          text += "\n\n(This document was long, so I read the first portion of it.)";
        }
        addMessage(thread, { role: "assistant", text });
      } catch (err) {
        setTyping(typing, false);
        showToast(err.message || "Couldn't analyze that document.");
      }
    }

    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") fileInput.click();
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    ["dragenter", "dragover"].forEach((evt) =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
      })
    );
    ["dragleave", "drop"].forEach((evt) =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
      })
    );
    dropzone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    clearBtn.addEventListener("click", reset);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const question = questionInput.value.trim();
      if (!question) return;
      questionInput.value = "";
      askAboutDocument(question);
    });
  }

  // ---------------------------------------------------------------------
  // Image mode
  // ---------------------------------------------------------------------

  function initImage() {
    const dropzone = $("#image-dropzone");
    const fileInput = $("#image-input");
    const workspace = $("#image-workspace");
    const previewImg = $("#image-preview");
    const clearBtn = $("#image-file-clear");
    const thread = $("#image-thread");
    const typing = $("#image-typing");
    const form = $("#image-composer");
    const questionInput = $("#image-question-input");

    let currentFile = null;

    function reset() {
      currentFile = null;
      fileInput.value = "";
      workspace.hidden = true;
      dropzone.hidden = false;
      thread.innerHTML = "";
      previewImg.src = "";
    }

    async function handleFile(file) {
      if (!file.type.startsWith("image/")) {
        showToast("That doesn't look like an image file.");
        return;
      }
      currentFile = file;
      previewImg.src = URL.createObjectURL(file);
      dropzone.hidden = true;
      workspace.hidden = false;
      thread.innerHTML = "";
      await askAboutImage("");
    }

    async function askAboutImage(question) {
      if (question) addMessage(thread, { role: "user", text: question });
      setTyping(typing, true);

      const formData = new FormData();
      formData.append("file", currentFile);
      formData.append("question", question);

      try {
        const data = await postForm("/api/analyze-image", formData);
        setTyping(typing, false);
        addMessage(thread, { role: "assistant", text: data.answer });
      } catch (err) {
        setTyping(typing, false);
        showToast(err.message || "Couldn't analyze that image.");
      }
    }

    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") fileInput.click();
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    ["dragenter", "dragover"].forEach((evt) =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
      })
    );
    ["dragleave", "drop"].forEach((evt) =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
      })
    );
    dropzone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    clearBtn.addEventListener("click", reset);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const question = questionInput.value.trim();
      if (!question) return;
      questionInput.value = "";
      askAboutImage(question);
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    initRail();
    initChat();
    initTranslate();
    initDocument();
    initImage();
  });
})();
