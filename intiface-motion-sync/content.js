// content.js
// Runs on every page. Watches <video> elements for on-screen motion and
// <img> elements for visual "panels" (manga/doujin pages, imageboard posts,
// etc.), and reports a single 0..1 activity number (plus a human-readable
// label of whatever is currently driving that number) to the background
// worker roughly 8x/second.
//
// IMPORTANT — what the image analysis does and doesn't do:
// It does NOT try to identify what's depicted (characters, acts, content
// category, apparent age, anything semantic). That's not something this
// extension attempts, on purpose. What it DOES do is objective, contentless
// pixel statistics — contrast, edge density (how much fine line-art/detail
// is packed into the frame), and color saturation — computed the exact same
// way no matter what the image actually shows. A busy, high-contrast panel
// scores higher than a plain establishing shot; that's the whole signal.
// Page-turn pacing (how quickly you're moving from image to image) shapes
// how long each pulse sustains before decaying, so quick flipping reads as
// short pulses and lingering on a page reads as a sustained level.
//
// Note on cross-origin images/video: drawing a cross-origin <video> or <img>
// onto a canvas without CORS headers "taints" the canvas, and reading pixel
// data throws a SecurityError. This is a standard browser privacy
// protection and can't be bypassed from an extension content script — a lot
// of manga/doujin CDNs don't send CORS headers, so this will fall back to a
// size-based estimate (see fallbackImageScore) fairly often rather than real
// pixel analysis. Still functional, just less finely graded.

const SAMPLE_INTERVAL_MS = 130;
const VIDEO_SAMPLE_SIZE = 48; // bigger canvas = finer-grained pixel diffs, more variation in the motion score
const IMAGE_SAMPLE_SIZE = 40; // resolution used for the per-image pixel-statistics pass

const trackedVideos = new Map(); // video element -> { canvas, ctx, lastFrame, taint }

let imagePulse = 0; // 0..1, decays each tick at a pace-aware rate
let imagePulseLabel = "";
let imageDecayPerTick = 0.85; // recomputed from recent panel-turn pacing

const trackedImages = new Map(); // img element -> { lastSrc, lastAnalyzedAt }
const panelTurnTimestamps = []; // recent full-panel turn times, for pacing
const MIN_PANEL_DIMENSION = 150; // ignore icons/avatars entirely
const FULL_PANEL_DIMENSION = 300; // "counts toward reading pace" threshold (manga page / full post, not a thumbnail)

let sharedImageCanvas = null;
let sharedImageCtx = null;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// ---------- Video motion (unchanged approach) ----------

function setupVideo(video) {
  if (trackedVideos.has(video)) return;
  const canvas = document.createElement("canvas");
  canvas.width = VIDEO_SAMPLE_SIZE;
  canvas.height = VIDEO_SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  trackedVideos.set(video, { canvas, ctx, lastFrame: null, taint: false });
}

function scanForVideos() {
  document.querySelectorAll("video").forEach(setupVideo);
}

function isElementVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
}

function shortenUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, location.href);
    if (url.protocol === "blob:") return document.title || url.hostname || location.hostname;
    const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    return filename ? filename : url.hostname;
  } catch {
    return document.title || location.hostname;
  }
}

function labelForVideo(video) {
  const src = video.currentSrc || video.src;
  if (src) return shortenUrl(src);
  return document.title || location.hostname;
}

function labelForImage(img) {
  if (img.alt && img.alt.trim()) return img.alt.trim().slice(0, 60);
  const src = img.currentSrc || img.src;
  if (src) return shortenUrl(src);
  return document.title || location.hostname;
}

function sampleVideoMotion(video, state) {
  if (video.paused || video.ended || video.readyState < 2) return 0;
  if (document.hidden) return 0;
  if (!isElementVisible(video)) return 0;

  if (state.taint) {
    return 0.35;
  }

  try {
    state.ctx.drawImage(video, 0, 0, VIDEO_SAMPLE_SIZE, VIDEO_SAMPLE_SIZE);
    const frame = state.ctx.getImageData(0, 0, VIDEO_SAMPLE_SIZE, VIDEO_SAMPLE_SIZE).data;

    if (!state.lastFrame) {
      state.lastFrame = frame;
      return 0;
    }

    let diff = 0;
    for (let i = 0; i < frame.length; i += 4) {
      diff += Math.abs(frame[i] - state.lastFrame[i]);
    }
    const avgDiff = diff / (frame.length / 4) / 255;
    state.lastFrame = frame;

    return clamp01(avgDiff * 6);
  } catch (e) {
    state.taint = true;
    return 0.35;
  }
}

// ---------- Image pixel-statistics analysis ----------

function getSharedImageCanvas() {
  if (!sharedImageCanvas) {
    sharedImageCanvas = document.createElement("canvas");
    sharedImageCanvas.width = IMAGE_SAMPLE_SIZE;
    sharedImageCanvas.height = IMAGE_SAMPLE_SIZE;
    sharedImageCtx = sharedImageCanvas.getContext("2d", { willReadFrequently: true });
  }
  return sharedImageCtx;
}

// Size-based fallback for when we can't read pixels (cross-origin, no CORS).
// We can only see how much of the viewport the image occupies, not what's
// in it, so this stays in a deliberately narrow, moderate band.
function fallbackImageScore(img) {
  const area = img.naturalWidth * img.naturalHeight;
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const ratio = Math.min(1, area / (viewportArea * 1.5));
  return 0.35 + ratio * 0.3; // 0.35..0.65
}

// Contentless pixel statistics: contrast (luma std-dev), edge density
// (average luma gradient between neighboring sampled pixels), and average
// color saturation. None of this looks at *what* is in the image.
function analyzeImage(img) {
  const ctx = getSharedImageCanvas();
  const n = IMAGE_SAMPLE_SIZE * IMAGE_SAMPLE_SIZE;

  try {
    ctx.clearRect(0, 0, IMAGE_SAMPLE_SIZE, IMAGE_SAMPLE_SIZE);
    ctx.drawImage(img, 0, 0, IMAGE_SAMPLE_SIZE, IMAGE_SAMPLE_SIZE);
    const data = ctx.getImageData(0, 0, IMAGE_SAMPLE_SIZE, IMAGE_SAMPLE_SIZE).data;

    const lumas = new Float32Array(n);
    let sumLuma = 0;
    let sumSat = 0;

    for (let p = 0; p < n; p++) {
      const i = p * 4;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      lumas[p] = luma;
      sumLuma += luma;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      sumSat += max === 0 ? 0 : (max - min) / max;
    }

    const avgLuma = sumLuma / n;
    const avgSat = sumSat / n;

    let varSum = 0;
    for (let p = 0; p < n; p++) {
      const d = lumas[p] - avgLuma;
      varSum += d * d;
    }
    const contrast = clamp01(Math.sqrt(varSum / n) / 90);

    let edgeSum = 0;
    let edgeCount = 0;
    for (let y = 0; y < IMAGE_SAMPLE_SIZE; y++) {
      for (let x = 0; x < IMAGE_SAMPLE_SIZE - 1; x++) {
        const a = lumas[y * IMAGE_SAMPLE_SIZE + x];
        const b = lumas[y * IMAGE_SAMPLE_SIZE + x + 1];
        edgeSum += Math.abs(a - b);
        edgeCount++;
      }
    }
    const edgeDensity = clamp01(edgeSum / edgeCount / 60);

    const score = clamp01(contrast * 0.4 + edgeDensity * 0.4 + avgSat * 0.2);
    return { score, taint: false };
  } catch (e) {
    return { score: fallbackImageScore(img), taint: true };
  }
}

// ---------- Reading-pace-aware pulse decay ----------

function recordPanelTurn(now) {
  panelTurnTimestamps.push(now);
  if (panelTurnTimestamps.length > 6) panelTurnTimestamps.shift();

  if (panelTurnTimestamps.length < 2) return;
  let totalGap = 0;
  for (let i = 1; i < panelTurnTimestamps.length; i++) {
    totalGap += panelTurnTimestamps[i] - panelTurnTimestamps[i - 1];
  }
  const avgGapMs = totalGap / (panelTurnTimestamps.length - 1);
  const clampedGap = Math.max(700, Math.min(6000, avgGapMs));

  // Solve per-tick decay so the pulse falls to ~15% of its peak over
  // roughly one average panel-turn interval.
  imageDecayPerTick = Math.pow(0.15, SAMPLE_INTERVAL_MS / clampedGap);
}

function maybeTriggerPanel(img) {
  if (img.naturalWidth < MIN_PANEL_DIMENSION || img.naturalHeight < MIN_PANEL_DIMENSION) return;
  if (!isElementVisible(img)) return;

  const src = img.currentSrc || img.src;
  const rec = trackedImages.get(img) || { lastSrc: null, lastAnalyzedAt: 0 };
  if (rec.lastSrc === src) return; // already handled this exact image
  const now = Date.now();
  if (now - rec.lastAnalyzedAt < 120) return; // debounce rapid duplicate events

  const { score } = analyzeImage(img);
  const boosted = clamp01(score * 1.15); // raw statistics skew low for busy line-art; nudge up

  if (boosted >= imagePulse) {
    imagePulse = boosted;
    imagePulseLabel = labelForImage(img);
  }

  const isFullPanel = img.naturalWidth >= FULL_PANEL_DIMENSION && img.naturalHeight >= FULL_PANEL_DIMENSION;
  if (isFullPanel) recordPanelTurn(now);

  rec.lastSrc = src;
  rec.lastAnalyzedAt = now;
  trackedImages.set(img, rec);
}

const imageObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
      maybeTriggerPanel(entry.target);
    }
  },
  { threshold: [0.6] }
);

function setupImage(img) {
  if (img.dataset.__esTracked) return;
  img.dataset.__esTracked = "1";
  // Catches manga/doujin readers that swap a single <img>'s src on "next
  // page" instead of inserting a new element.
  img.addEventListener("load", () => maybeTriggerPanel(img), { passive: true });
  imageObserver.observe(img);
}

function scanForImages() {
  document.querySelectorAll("img").forEach(setupImage);
}

// ---------- Combine video + image into one activity value ----------

function combinedActivity() {
  let bestMotion = 0;
  let bestLabel = "";

  for (const [video, state] of trackedVideos.entries()) {
    if (!document.contains(video)) {
      trackedVideos.delete(video);
      continue;
    }
    const m = sampleVideoMotion(video, state);
    if (m > bestMotion) {
      bestMotion = m;
      bestLabel = labelForVideo(video);
    }
  }

  imagePulse *= imageDecayPerTick;
  if (imagePulse < 0.01) imagePulse = 0;

  let value, label, source;
  if (imagePulse > bestMotion) {
    value = imagePulse;
    label = imagePulseLabel;
    source = "image";
  } else if (bestMotion > 0) {
    value = bestMotion;
    label = bestLabel;
    source = "video";
  } else {
    value = 0;
    label = "";
    source = "none";
  }

  return { value: clamp01(value), label, source };
}

// ---------- Wiring ----------

const mutationObserver = new MutationObserver(() => {
  scanForVideos();
  scanForImages();
});
mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

scanForVideos();
scanForImages();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    chrome.runtime.sendMessage({ type: "activity", value: 0, label: "", source: "none" }).catch(() => {});
  }
});

setInterval(() => {
  if (trackedVideos.size === 0 && imagePulse === 0) return;
  const { value, label, source } = combinedActivity();
  chrome.runtime.sendMessage({ type: "activity", value, label, source }).catch(() => {});
}, SAMPLE_INTERVAL_MS);
