const el = (id) => document.getElementById(id);

const statusDot = el("statusDot");
const statusText = el("statusText");
const wsUrlInput = el("wsUrl");
const connectBtn = el("connectBtn");
const popoutBtn = el("popoutBtn");
const meterFill = el("meterFill");
const meterValue = el("meterValue");
const samplingDot = el("samplingDot");
const samplingLabel = el("samplingLabel");
const masterEnabled = el("masterEnabled");
const maxIntensity = el("maxIntensity");
const maxIntensityVal = el("maxIntensityVal");
const sensitivity = el("sensitivity");
const sensitivityVal = el("sensitivityVal");
const smoothing = el("smoothing");
const smoothingVal = el("smoothingVal");
const deviceList = el("deviceList");
const stopBtn = el("stopBtn");
const easeBtn = el("easeBtn");
const targetMinutesInput = el("targetMinutes");
const sessionBtn = el("sessionBtn");
const sessionPhase = el("sessionPhase");
const sessionFill = el("sessionFill");
const sessionTime = el("sessionTime");
const learningStatus = el("learningStatus");

const isPopped = new URLSearchParams(location.search).get("popped") === "1";

let currentStatus = null;
let pollTimer = null;

if (isPopped) {
  popoutBtn.classList.add("hidden");
} else {
  popoutBtn.addEventListener("click", () => {
    chrome.windows.create(
      {
        url: chrome.runtime.getURL("popup.html?popped=1"),
        type: "popup",
        width: 380,
        height: 680,
        focused: true
      },
      () => window.close()
    );
  });
}

function render(status) {
  currentStatus = status;

  statusDot.className = "dot " + (status.wsState === "connected" ? "connected" : status.wsState === "connecting" ? "connecting" : "");
  statusText.textContent =
    status.wsState === "connected" ? "Connected" : status.wsState === "connecting" ? "Connecting…" : "Disconnected";
  connectBtn.textContent = status.wsState === "connected" ? "Disconnect" : "Connect";
  wsUrlInput.value = status.wsUrl;

  const pct = Math.round((status.currentIntensity || 0) * 100);
  meterFill.style.width = pct + "%";
  meterValue.textContent = pct + "%";

  samplingDot.className = "sampling-dot" + (status.samplingSource && status.samplingSource !== "none" ? " active" : "");
  if (status.samplingSource === "video") {
    samplingLabel.textContent = "Video: " + status.samplingLabel;
  } else if (status.samplingSource === "image") {
    samplingLabel.textContent = "Image: " + status.samplingLabel;
  } else {
    samplingLabel.textContent = "Sampling: nothing yet";
  }

  masterEnabled.checked = status.settings.masterEnabled;
  maxIntensity.value = Math.round(status.settings.maxIntensity * 100);
  maxIntensityVal.textContent = maxIntensity.value + "%";
  sensitivity.value = status.settings.sensitivity;
  sensitivityVal.textContent = status.settings.sensitivity + "x";
  smoothing.value = Math.round(status.settings.smoothing * 100);
  smoothingVal.textContent = smoothing.value + "%";

  renderDevices(status);
  renderSession(status);
}

const PHASE_TEXT = {
  idle: "Idle",
  running: "Edging",
  "finishing-ramp": "Finishing…",
  finishing: "Finish it"
};

function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function renderSession(status) {
  const s = status.session;

  sessionPhase.textContent = PHASE_TEXT[s.phase] || "Idle";
  sessionPhase.className = "session-phase" + (s.phase === "running" ? " live" : "");
  if (s.phase === "finishing-ramp" || s.phase === "finishing") sessionPhase.classList.add("finish");

  sessionBtn.textContent = s.active ? "End" : "Start";
  targetMinutesInput.disabled = s.active;

  const pct = Math.round(s.progressRatio * 100);
  sessionFill.style.width = pct + "%";
  sessionTime.textContent = s.active
    ? `${formatTime(s.elapsedSeconds)} / ${formatTime(s.targetSeconds)}`
    : `— / ${targetMinutesInput.value}:00`;

  if (!status.learning) {
    learningStatus.textContent = "No history yet — it'll learn your timing from Ease off presses.";
  } else {
    const l = status.learning;
    learningStatus.textContent =
      `Learned from ${l.count} ease-off${l.count === 1 ? "" : "s"} ` +
      `(usually around ${l.avgProgress}% into a session, ~${l.avgTrigger}% intensity). ` +
      `Auto-easing confidence: ${l.confidence}%.`;
  }

  easeBtn.classList.toggle("active", status.easeOffActive);
}

function renderDevices(status) {
  if (status.devices.length === 0) {
    deviceList.innerHTML = '<div class="empty-state">No devices yet — connect and scan in Intiface Central.</div>';
    return;
  }

  // Avoid rebuilding <select> elements (and losing focus/scroll) on every
  // poll tick if the device set hasn't changed — only patch text/values.
  const existingIndexes = Array.from(deviceList.querySelectorAll(".device-row")).map((r) => r.dataset.index);
  const newIndexes = status.devices.map((d) => String(d.index));
  const needsRebuild = existingIndexes.join(",") !== newIndexes.join(",");

  if (needsRebuild) {
    deviceList.innerHTML = "";
    for (const dev of status.devices) {
      const row = document.createElement("div");
      row.className = "device-row";
      row.dataset.index = dev.index;

      const options = Object.entries(status.patternLabels)
        .map(([value, label]) => `<option value="${value}" ${dev.pattern === value ? "selected" : ""}>${label}</option>`)
        .join("");

      row.innerHTML = `
        <div class="device-top">
          <span class="device-name">${escapeHtml(dev.name)}</span>
          <label class="switch">
            <input type="checkbox" class="device-enable" data-index="${dev.index}" ${dev.enabled ? "checked" : ""} />
            <span class="slider-toggle"></span>
          </label>
        </div>
        <div class="device-bottom">
          <select class="pattern-select" data-index="${dev.index}">${options}</select>
          <span class="device-output" data-index="${dev.index}">${dev.output}%</span>
        </div>`;
      deviceList.appendChild(row);
    }
    deviceList.querySelectorAll(".device-enable").forEach((cb) => cb.addEventListener("change", onDeviceToggle));
    deviceList.querySelectorAll(".pattern-select").forEach((sel) => sel.addEventListener("change", onPatternChange));
  } else {
    for (const dev of status.devices) {
      const outputEl = deviceList.querySelector(`.device-output[data-index="${dev.index}"]`);
      if (outputEl) outputEl.textContent = dev.output + "%";
    }
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: "getStatus" }, (status) => {
    if (status) render(status);
  });
}

function updateSettings(partial) {
  chrome.runtime.sendMessage({ type: "updateSettings", settings: partial }, (status) => {
    if (status) render(status);
  });
}

connectBtn.addEventListener("click", () => {
  if (currentStatus && currentStatus.wsState === "connected") {
    chrome.runtime.sendMessage({ type: "disconnect" }, refreshStatus);
  } else {
    chrome.runtime.sendMessage({ type: "connect", wsUrl: wsUrlInput.value.trim() }, refreshStatus);
  }
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stopAll" }, refreshStatus);
});

masterEnabled.addEventListener("change", () => updateSettings({ masterEnabled: masterEnabled.checked }));
maxIntensity.addEventListener("input", () => {
  maxIntensityVal.textContent = maxIntensity.value + "%";
  updateSettings({ maxIntensity: Number(maxIntensity.value) / 100 });
});
sensitivity.addEventListener("input", () => {
  sensitivityVal.textContent = sensitivity.value + "x";
  updateSettings({ sensitivity: Number(sensitivity.value) });
});
smoothing.addEventListener("input", () => {
  smoothingVal.textContent = smoothing.value + "%";
  updateSettings({ smoothing: Number(smoothing.value) / 100 });
});

easeBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "easeOff" }, refreshStatus);
});

sessionBtn.addEventListener("click", () => {
  if (currentStatus && currentStatus.session.active) {
    chrome.runtime.sendMessage({ type: "endSession" }, refreshStatus);
  } else {
    const minutes = Number(targetMinutesInput.value) || 15;
    chrome.runtime.sendMessage({ type: "startSession", targetMinutes: minutes }, refreshStatus);
  }
});

function onDeviceToggle(e) {
  const index = Number(e.target.dataset.index);
  const disabled = new Set(currentStatus.settings.disabledDeviceIndexes);
  if (e.target.checked) disabled.delete(index);
  else disabled.add(index);
  updateSettings({ disabledDeviceIndexes: Array.from(disabled) });
}

function onPatternChange(e) {
  const index = Number(e.target.dataset.index);
  const devicePatterns = { ...currentStatus.settings.devicePatterns, [index]: e.target.value };
  updateSettings({ devicePatterns });
}

refreshStatus();
pollTimer = setInterval(refreshStatus, 400);
window.addEventListener("unload", () => clearInterval(pollTimer));
