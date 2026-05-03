/* Emotional Space AI — Tablet browser client */

const videoEl = document.getElementById("cam");
const overlayEl = document.getElementById("overlay");
const startScreen = document.getElementById("start-screen");
const uiPanel = document.getElementById("ui-panel");

const peopleCountEl = document.getElementById("people-count");
const noiseLevelEl = document.getElementById("noise-level");
const occupancyTimeEl = document.getElementById("occupancy-time");
const systemModeEl = document.getElementById("system-mode");
const lightInfoEl = document.getElementById("light-info");
const aiGoalEl = document.getElementById("ai-goal");

const startBtn = document.getElementById("startBtn");
const faceHintEl = document.getElementById("face-hint");

const EMOTION_ORDER = ["Joy", "Sorrow", "Anger", "Surprise", "Neutral"];

function showError(msg) {
  let el = document.getElementById("error-msg");
  if (!el) {
    el = document.createElement("div");
    el.id = "error-msg";
    el.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(200,50,50,0.95);color:#fff;padding:20px 30px;border-radius:8px;z-index:9999;max-width:90%;font-size:14px;text-align:center;";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
}

function hideError() {
  const el = document.getElementById("error-msg");
  if (el) el.style.display = "none";
}
const ANALYZE_INTERVAL_MS = 1000;
const IMG_WIDTH = 640;
const IMG_HEIGHT = 480;

let stream = null;
let audioContext = null;
let analyser = null;
let isRunning = false;
let analyzeTimer = null;
let isProcessing = false;

function getServerUrl() {
  return window.location.origin;
}

async function initAudio(stream) {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
  } catch (e) {
    console.warn("Audio init failed:", e);
  }
}

function getNoiseLevel() {
  if (!analyser) return 0;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const n = (data[i] - 128) / 128;
    sum += n * n;
  }
  const rms = Math.sqrt(sum / data.length);
  return Math.min(rms * 3, 1.0);
}

function captureFrame() {
  if (!videoEl.videoWidth || videoEl.readyState < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = IMG_WIDTH;
  canvas.height = IMG_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  const aspect = vw / vh;
  let sw, sh, sx, sy;

  if (aspect > IMG_WIDTH / IMG_HEIGHT) {
    sw = vh * (IMG_WIDTH / IMG_HEIGHT);
    sh = vh;
    sx = (vw - sw) / 2;
    sy = 0;
  } else {
    sw = vw;
    sh = vw * (IMG_HEIGHT / IMG_WIDTH);
    sx = 0;
    sy = (vh - sh) / 2;
  }

  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, IMG_WIDTH, IMG_HEIGHT);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
  });
}

async function sendAnalyze() {
  if (isProcessing || !stream) return;
  isProcessing = true;

  const blob = await captureFrame();
  if (!blob) {
    isProcessing = false;
    return;
  }

  const form = new FormData();
  form.append("frame", blob, "frame.jpg");
  form.append("noise_level", String(getNoiseLevel()));

  try {
    const res = await fetch(`${getServerUrl()}/analyze`, {
      method: "POST",
      body: form,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showError(data.error || res.statusText);
      return;
    }

    if (data.status === "ok") {
      hideError();
      updateUI(data);
      drawOverlay(data);
    } else {
      showError(data.error || "Unknown error");
    }
  } catch (e) {
    showError(e.message || "Network error");
    console.warn("Analyze error:", e);
  } finally {
    isProcessing = false;
  }
}

function updateUI(data) {
  peopleCountEl.textContent = data.people_count ?? 0;
  noiseLevelEl.textContent = (data.noise_level || "—").toUpperCase();
  occupancyTimeEl.textContent = `${data.occupancy_time ?? 0}s`;
  systemModeEl.textContent = (data.state || "idle").toUpperCase().replace(/_/g, " ");
  if (aiGoalEl) aiGoalEl.textContent = data.goal || "—";

  if (data.light) {
    lightInfoEl.textContent = `${data.light.color_temp}K / ${data.light.brightness}%`;
  } else {
    lightInfoEl.textContent = "—";
  }

  if (faceHintEl) {
    if ((data.people_count ?? 0) > 0) {
      faceHintEl.textContent = "FACE DETECTED";
      faceHintEl.classList.add("detected");
    } else {
      faceHintEl.textContent = "AWAITING FACE — Face the camera directly, ensure good lighting";
      faceHintEl.classList.remove("detected");
    }
  }
}

function drawOverlay(data) {
  const ctx = overlayEl.getContext("2d");
  if (!ctx || !videoEl.videoWidth) return;

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  overlayEl.width = vw;
  overlayEl.height = vh;
  ctx.clearRect(0, 0, vw, vh);

  const aspect = vw / vh;
  let sw, sh, sx, sy;
  if (aspect > IMG_WIDTH / IMG_HEIGHT) {
    sw = vh * (IMG_WIDTH / IMG_HEIGHT);
    sh = vh;
    sx = (vw - sw) / 2;
    sy = 0;
  } else {
    sw = vw;
    sh = vw * (IMG_HEIGHT / IMG_WIDTH);
    sx = 0;
    sy = (vh - sh) / 2;
  }
  const scaleX = sw / IMG_WIDTH;
  const scaleY = sh / IMG_HEIGHT;

  const faces = data.faces || [];
  for (const face of faces) {
    const [x1, y1, x2, y2] = face.box || [0, 0, 0, 0];
    const sx1 = sx + x1 * scaleX;
    const sy1 = sy + y1 * scaleY;
    const sx2 = sx + x2 * scaleX;
    const sy2 = sy + y2 * scaleY;

    ctx.strokeStyle = "rgba(100, 255, 150, 0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);

    const percentages = face.percentages || {};
    const lines = EMOTION_ORDER.map((name) => `${name}: ${percentages[name] ?? 0}%`);

    const lineH = 11;
    const panelW = 95;
    const panelH = lines.length * lineH + 6;
    const pad = 12;

    let tx = sx2 + pad;
    let ty = sy1;

    if (tx + panelW > vw - 10) {
      tx = sx1 - panelW - pad;
    }
    if (tx < 10) tx = 10;
    if (ty < 10) ty = 10;
    if (ty + panelH > vh - 10) ty = vh - panelH - 10;

    ctx.fillStyle = "rgba(10, 10, 10, 0.85)";
    ctx.fillRect(tx - 2, ty - 8, panelW, panelH);
    ctx.strokeStyle = "rgba(100, 255, 150, 0.6)";
    ctx.strokeRect(tx - 2, ty - 8, panelW, panelH);

    ctx.fillStyle = "#fff";
    ctx.font = "9px monospace";
    lines.forEach((line, i) => {
      const ly = ty + 6 + i * lineH;
      const cx = tx + panelW / 2;
      ctx.save();
      ctx.translate(cx, ly);
      ctx.scale(-1, 1);
      ctx.translate(-cx, -ly);
      ctx.fillText(line, tx, ly);
      ctx.restore();
    });
  }
}

function startSession() {
  if (isRunning) return;
  isRunning = true;

  startScreen.classList.add("hidden");
  uiPanel.classList.add("visible");

  analyzeTimer = setInterval(() => sendAnalyze(), ANALYZE_INTERVAL_MS);
  sendAnalyze();
}

startBtn.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true,
    });

    videoEl.srcObject = stream;
    await videoEl.play();

    await initAudio(stream);

    startSession();
  } catch (e) {
    alert("Camera and microphone access are required.");
    console.error(e);
  }
});
