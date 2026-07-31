// background.js
// Talks to Intiface Central (Buttplug protocol v3) over WebSocket, and turns
// "activity" reports from content.js into per-device ScalarCmd vibration
// commands. Timing/sampling of the page lives in content.js on purpose —
// MV3 service workers can be suspended, so this file stays reactive (it
// wakes on incoming messages) rather than relying on its own timers.
//
// On top of the base motion sync, this file also runs a session/pacing
// layer: a target edging duration that ramps intensity up at the end
// instead of holding back, a manual "Ease off" button that temporarily
// cuts intensity and logs *when* it was pressed, and a small learned model
// that uses that history to start easing off proactively over time.

const DEFAULT_SETTINGS = {
  wsUrl: "ws://127.0.0.1:12345",
  autoReconnect: false, // becomes true once the user hits Connect
  masterEnabled: true,
  maxIntensity: 0.8, // safety ceiling, 0..1
  sensitivity: 1.5, // multiplier applied to raw activity
  smoothing: 0.35, // 0 = no smoothing, closer to 1 = slower/smoother
  disabledDeviceIndexes: [],
  devicePatterns: {} // { [deviceIndex]: patternName }
};

const DEFAULT_SESSION = {
  active: false,
  startTs: 0,
  targetSeconds: 15 * 60
};

const FINISH_WINDOW_RATIO = 0.85; // last 15% of the session ramps toward full
const EASE_OFF_FLOOR = 0.32; // how far a manual Ease off cuts intensity, immediately
const EASE_OFF_RECOVER_MS = 25000; // how long it takes to ramp back to normal after
const AUTO_BACKOFF_FLOOR = 0.45; // learned backoff never fully stops output on its own
const RECENT_WINDOW_MS = 25000; // window used to compute "recent average intensity"
const MAX_HISTORY = 50;

const PATTERN_CYCLE = ["pulse", "wave", "stagger", "random", "direct"];
const PATTERN_LABELS = {
  direct: "Direct sync",
  pulse: "Pulse",
  wave: "Wave",
  stagger: "Alternating",
  random: "Random jitter"
};

let settings = { ...DEFAULT_SETTINGS };
let session = { ...DEFAULT_SESSION };
let edgeHistory = []; // [{ progressRatio, triggerIntensity, ts }]

let ws = null;
let wsState = "disconnected"; // disconnected | connecting | connected
let msgId = 1;
let devices = new Map(); // index -> { name, actuators: [{index, actuatorType}] }
let deviceState = new Map(); // index -> { phase, randomCurrent, randomBucket, lastSendTime, lastOutput }

let smoothedActivity = 0; // 0..1, post-sensitivity, pre-cap
let tabActivity = new Map(); // tabId -> { value, label, source, ts }
let currentLabel = "";
let currentSource = "none";

let recentIntensityBuffer = []; // [{ ts, value }] — pre-session-multiplier level, for learning
let easeOff = { active: false, pressTs: 0 };

init();

async function init() {
  const stored = await chrome.storage.local.get(["settings", "session", "edgeHistory"]);
  if (stored.settings) settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  if (stored.session) session = { ...DEFAULT_SESSION, ...stored.session };
  if (Array.isArray(stored.edgeHistory)) edgeHistory = stored.edgeHistory;
  if (settings.autoReconnect) connectWebSocket();
}

function saveSettings() {
  chrome.storage.local.set({ settings });
}
function saveSession() {
  chrome.storage.local.set({ session });
}
function saveEdgeHistory() {
  chrome.storage.local.set({ edgeHistory });
}

function nextId() {
  return msgId++;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(x, edge0, edge1) {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function defaultPatternFor(index) {
  return PATTERN_CYCLE[index % PATTERN_CYCLE.length];
}
function patternFor(index) {
  return settings.devicePatterns[index] || defaultPatternFor(index);
}

function getDeviceState(index) {
  if (!deviceState.has(index)) {
    deviceState.set(index, {
      phase: (index * 2.399963) % (Math.PI * 2), // golden-angle spacing so devices desync
      randomCurrent: Math.random(),
      randomTarget: Math.random(),
      randomBucket: -1,
      lastSendTime: 0,
      lastOutput: -1
    });
  }
  return deviceState.get(index);
}

// ---------- Session / pacing / learning ----------

function sessionElapsedSeconds(now) {
  if (!session.active) return 0;
  return Math.max(0, (now - session.startTs) / 1000);
}
function sessionProgressRatio(now) {
  if (!session.active || session.targetSeconds <= 0) return 0;
  return clamp01(sessionElapsedSeconds(now) / session.targetSeconds);
}
function sessionPhase(now) {
  if (!session.active) return "idle";
  const p = sessionProgressRatio(now);
  if (p >= 1) return "finishing";
  if (p >= FINISH_WINDOW_RATIO) return "finishing-ramp";
  return "running";
}

function pruneRecentIntensity(now) {
  while (recentIntensityBuffer.length && now - recentIntensityBuffer[0].ts > RECENT_WINDOW_MS) {
    recentIntensityBuffer.shift();
  }
}
function recentAvgIntensity(now) {
  pruneRecentIntensity(now);
  if (recentIntensityBuffer.length === 0) return 0;
  const sum = recentIntensityBuffer.reduce((a, e) => a + e.value, 0);
  return sum / recentIntensityBuffer.length;
}

function learningStats() {
  if (edgeHistory.length === 0) return null;
  const n = edgeHistory.length;
  const avgProgress = edgeHistory.reduce((a, e) => a + e.progressRatio, 0) / n;
  const avgTrigger = edgeHistory.reduce((a, e) => a + e.triggerIntensity, 0) / n;
  const confidence = clamp01(n / 8); // treat ~8 data points as "fully learned"
  return { count: n, avgProgress, avgTrigger, confidence };
}

// Learned proactive backoff: 0 = no intervention, 1 = full learned backoff.
// Blends "we're approaching the time you usually ease off at" with
// "the intensity is approaching the level you usually ease off at", and
// only kicks in gradually as more history accumulates.
function autoBackoffAmount(now) {
  const stats = learningStats();
  if (!stats) return 0;

  const progress = sessionProgressRatio(now);
  const margin = 0.15 * (1 - stats.confidence) + 0.05; // shrinks with confidence, never hits 0
  const progressStart = Math.max(0, stats.avgProgress - margin);
  const progressBackoff = smoothstep(progress, progressStart, Math.min(1, stats.avgProgress + 0.05));

  const recent = recentAvgIntensity(now);
  const intensityBackoff = smoothstep(recent, stats.avgTrigger * 0.85, stats.avgTrigger * 1.05);

  return Math.max(progressBackoff, intensityBackoff) * stats.confidence;
}

function easeOffMultiplier(now) {
  if (!easeOff.active) return 1;
  const elapsed = now - easeOff.pressTs;
  if (elapsed >= EASE_OFF_RECOVER_MS) {
    easeOff.active = false;
    return 1;
  }
  const t = clamp01(elapsed / EASE_OFF_RECOVER_MS);
  return lerp(EASE_OFF_FLOOR, 1, t);
}

// Combines session phase + learned backoff + manual ease-off into one
// multiplier applied on top of the raw motion-driven level.
function sessionMultiplier(now) {
  const easeMul = easeOffMultiplier(now); // always respected, even mid-finish

  if (!session.active) return easeMul;

  const phase = sessionPhase(now);

  if (phase === "running") {
    const backoff = autoBackoffAmount(now);
    return lerp(1, AUTO_BACKOFF_FLOOR, backoff) * easeMul;
  }

  if (phase === "finishing-ramp") {
    const p = sessionProgressRatio(now);
    const rampT = clamp01((p - FINISH_WINDOW_RATIO) / (1 - FINISH_WINDOW_RATIO));
    return lerp(0.55, 1, rampT) * easeMul;
  }

  // phase === "finishing": push toward full — this is the "finish it off" stretch
  return 1 * easeMul;
}

function doEaseOff() {
  const now = Date.now();
  easeOff.active = true;
  easeOff.pressTs = now;

  if (session.active) {
    const progressRatio = sessionProgressRatio(now);
    const triggerIntensity = recentAvgIntensity(now);
    edgeHistory.push({ progressRatio, triggerIntensity, ts: now });
    if (edgeHistory.length > MAX_HISTORY) edgeHistory.shift();
    saveEdgeHistory();
  }
}

function startSession(targetMinutes) {
  const minutes = Math.max(1, Math.min(180, Number(targetMinutes) || 15));
  session = { active: true, startTs: Date.now(), targetSeconds: minutes * 60 };
  saveSession();
}
function endSession() {
  session.active = false;
  saveSession();
}

// ---------- Status ----------

function broadcastStatus() {
  chrome.runtime.sendMessage({ type: "status", status: getStatus() }).catch(() => {});
}

function getStatus() {
  const now = Date.now();
  const stats = learningStats();
  return {
    wsState,
    wsUrl: settings.wsUrl,
    devices: Array.from(devices.entries()).map(([index, d]) => ({
      index,
      name: d.name,
      enabled: !settings.disabledDeviceIndexes.includes(index),
      pattern: patternFor(index),
      output: Math.round((getDeviceState(index).lastOutput < 0 ? 0 : getDeviceState(index).lastOutput) * 100)
    })),
    settings,
    currentIntensity: effectiveIntensity(now),
    samplingLabel: currentLabel,
    samplingSource: currentSource,
    patternLabels: PATTERN_LABELS,
    session: {
      active: session.active,
      phase: sessionPhase(now),
      elapsedSeconds: sessionElapsedSeconds(now),
      targetSeconds: session.targetSeconds,
      progressRatio: sessionProgressRatio(now)
    },
    easeOffActive: easeOff.active,
    learning: stats
      ? {
          count: stats.count,
          confidence: Math.round(stats.confidence * 100),
          avgProgress: Math.round(stats.avgProgress * 100),
          avgTrigger: Math.round(stats.avgTrigger * 100)
        }
      : null
  };
}

function cappedActivity() {
  return clamp01(smoothedActivity * settings.maxIntensity);
}

// The level actually sent toward devices, after session pacing and any
// manual ease-off — this is what the popup's live meter should show, so
// pressing Ease off (or entering the finish stretch) is visibly reflected
// even before the next activity tick arrives from content.js.
function effectiveIntensity(now = Date.now()) {
  if (!settings.masterEnabled) return 0;
  return clamp01(cappedActivity() * sessionMultiplier(now));
}

// ---------- WebSocket / Buttplug protocol ----------

function connectWebSocket() {
  if (ws && (wsState === "connected" || wsState === "connecting")) return;
  wsState = "connecting";
  broadcastStatus();
  try {
    ws = new WebSocket(settings.wsUrl);
  } catch (e) {
    wsState = "disconnected";
    broadcastStatus();
    return;
  }

  ws.onopen = () => {
    send({
      RequestServerInfo: { Id: nextId(), ClientName: "EdgeStation", MessageVersion: 3 }
    });
  };

  ws.onmessage = (evt) => {
    let parsed;
    try {
      parsed = JSON.parse(evt.data);
    } catch {
      return;
    }
    for (const msg of parsed) handleServerMessage(msg);
  };

  ws.onerror = () => {};

  ws.onclose = () => {
    wsState = "disconnected";
    devices.clear();
    deviceState.clear();
    broadcastStatus();
  };
}

function disconnectWebSocket() {
  settings.autoReconnect = false;
  saveSettings();
  if (ws) {
    try {
      ws.close();
    } catch {}
  }
  ws = null;
  wsState = "disconnected";
  devices.clear();
  deviceState.clear();
  broadcastStatus();
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify([obj]));
}

function handleServerMessage(msg) {
  const type = Object.keys(msg)[0];
  const body = msg[type];

  switch (type) {
    case "ServerInfo":
      wsState = "connected";
      settings.autoReconnect = true;
      saveSettings();
      send({ RequestDeviceList: { Id: nextId() } });
      send({ StartScanning: { Id: nextId() } });
      broadcastStatus();
      break;

    case "DeviceList":
      devices.clear();
      for (const dev of body.Devices || []) registerDevice(dev);
      broadcastStatus();
      break;

    case "DeviceAdded":
      registerDevice(body);
      broadcastStatus();
      break;

    case "DeviceRemoved":
      devices.delete(body.DeviceIndex);
      deviceState.delete(body.DeviceIndex);
      broadcastStatus();
      break;

    case "Error":
      console.warn("Intiface error:", body.ErrorMessage);
      break;

    default:
      break; // Ok, ScanningFinished, etc. — nothing to do
  }
}

function registerDevice(dev) {
  const actuators = [];
  const msgs = dev.DeviceMessages || {};
  const scalarCmds = msgs.ScalarCmd || [];
  scalarCmds.forEach((a, i) => {
    if ((a.ActuatorType || "").toLowerCase() === "vibrate" || !a.ActuatorType) {
      actuators.push({ index: a.Index ?? i, actuatorType: a.ActuatorType || "Vibrate" });
    }
  });
  if (actuators.length === 0 && msgs.VibrateCmd) {
    const count = msgs.VibrateCmd.FeatureCount || 1;
    for (let i = 0; i < count; i++) actuators.push({ index: i, actuatorType: "Vibrate" });
  }
  devices.set(dev.DeviceIndex, { name: dev.DeviceName, actuators });
}

function vibrateDevice(deviceIndex, scalar) {
  const dev = devices.get(deviceIndex);
  if (!dev || dev.actuators.length === 0) return;
  send({
    ScalarCmd: {
      Id: nextId(),
      DeviceIndex: deviceIndex,
      Scalars: dev.actuators.map((a) => ({ Index: a.index, Scalar: scalar, ActuatorType: a.actuatorType }))
    }
  });
}

function stopAll() {
  for (const index of devices.keys()) {
    send({ StopDeviceCmd: { Id: nextId(), DeviceIndex: index } });
    const st = getDeviceState(index);
    st.lastOutput = 0;
  }
  smoothedActivity = 0;
  broadcastStatus();
}

// ---------- Pattern engine ----------
// Each pattern turns the shared "activityLevel" (0..1, already sensitivity-,
// cap-, and session/ease-off-adjusted) into a per-device output, using time
// + a per-device phase offset so multiple toys don't all move identically.

function computeDeviceOutput(index, activityLevel, now) {
  const st = getDeviceState(index);
  const pattern = patternFor(index);
  const t = now / 1000;

  if (activityLevel <= 0.001) {
    st.lastOutput = 0;
    return 0;
  }

  let out;
  switch (pattern) {
    case "pulse": {
      const freq = 0.5 + activityLevel * 2.2;
      const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * freq * t + st.phase);
      out = activityLevel * (0.3 + 0.7 * wave);
      break;
    }
    case "wave": {
      const freq = 0.35;
      const phase01 = ((t * freq + st.phase / (2 * Math.PI)) % 1 + 1) % 1;
      const triangle = 1 - Math.abs(phase01 * 2 - 1);
      out = activityLevel * (0.25 + 0.75 * triangle);
      break;
    }
    case "stagger": {
      const freq = 1.0; // shared fixed tempo so devices visibly take turns
      const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * freq * t + st.phase);
      out = activityLevel * (0.3 + 0.7 * wave);
      break;
    }
    case "random": {
      const bucket = Math.floor(now / 300);
      if (bucket !== st.randomBucket) {
        st.randomBucket = bucket;
        st.randomTarget = pseudoRandom(index * 1000 + bucket);
      }
      st.randomCurrent += (st.randomTarget - st.randomCurrent) * 0.2;
      out = activityLevel * (0.3 + 0.7 * st.randomCurrent);
      break;
    }
    case "direct":
    default:
      out = activityLevel;
      break;
  }

  out = clamp01(out);
  st.lastOutput = out;
  return out;
}

// ---------- Activity -> device outputs ----------

function pruneStaleTabs(now) {
  for (const [tabId, entry] of tabActivity.entries()) {
    if (now - entry.ts > 1200) tabActivity.delete(tabId);
  }
}
function pickDominantTab() {
  let best = null;
  for (const entry of tabActivity.values()) {
    if (!best || entry.value > best.value) best = entry;
  }
  return best;
}

function applyActivity() {
  const now = Date.now();
  pruneStaleTabs(now);
  const dominant = pickDominantTab();

  const rawValue = dominant ? dominant.value : 0;
  currentLabel = dominant ? dominant.label : "";
  currentSource = dominant ? dominant.source : "none";

  const target = clamp01(rawValue * settings.sensitivity);
  const alpha = 1 - settings.smoothing;
  smoothedActivity = smoothedActivity + (target - smoothedActivity) * alpha;

  const baseLevel = settings.masterEnabled ? cappedActivity() : 0;

  recentIntensityBuffer.push({ ts: now, value: baseLevel });
  pruneRecentIntensity(now);

  const activityLevel = effectiveIntensity(now);

  if (wsState !== "connected") {
    broadcastStatus();
    return;
  }

  for (const index of devices.keys()) {
    const st = getDeviceState(index);
    if (settings.disabledDeviceIndexes.includes(index)) {
      if (st.lastOutput !== 0) {
        vibrateDevice(index, 0);
        st.lastOutput = 0;
      }
      continue;
    }
    const output = computeDeviceOutput(index, activityLevel, now);
    if (now - st.lastSendTime < 70) continue; // rate cap per device
    st.lastSendTime = now;
    vibrateDevice(index, output);
  }

  broadcastStatus();
}

// ---------- Message router ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "activity": {
      const tabId = sender.tab && sender.tab.id;
      if (tabId !== undefined && tabId !== null) {
        tabActivity.set(tabId, {
          value: message.value || 0,
          label: message.label || "",
          source: message.source || "none",
          ts: Date.now()
        });
      }
      if (wsState !== "connected" && settings.autoReconnect) connectWebSocket();
      applyActivity();
      break;
    }

    case "connect":
      settings.wsUrl = message.wsUrl || settings.wsUrl;
      settings.autoReconnect = true;
      saveSettings();
      connectWebSocket();
      break;

    case "disconnect":
      disconnectWebSocket();
      break;

    case "stopAll":
      stopAll();
      break;

    case "easeOff":
      doEaseOff();
      broadcastStatus();
      break;

    case "startSession":
      startSession(message.targetMinutes);
      broadcastStatus();
      break;

    case "endSession":
      endSession();
      broadcastStatus();
      break;

    case "updateSettings":
      settings = { ...settings, ...message.settings };
      saveSettings();
      broadcastStatus();
      break;

    case "getStatus":
      sendResponse(getStatus());
      return true;

    default:
      break;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabActivity.delete(tabId);
});
