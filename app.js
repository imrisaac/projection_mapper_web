const STORAGE_KEY = "projection-mapper-presets-v1";
const API_STATE_ENDPOINT = "/api/state";
const API_UPLOAD_ENDPOINT = "/api/upload";
const SYNC_PUSH_DEBOUNCE_MS = 80;
const OUTPUT_POLL_MS = 120;
const CORNER_NAMES = ["Top Left", "Top Right", "Bottom Right", "Bottom Left"];

const stage = document.getElementById("stage");
const quad = document.getElementById("quad");
const multiQuads = document.getElementById("multi-quads");
const guides = document.getElementById("guides");
const handlesWrap = document.getElementById("handles");
const canvas = document.getElementById("source-canvas");
const sourceVideo = document.getElementById("source-video");
const ctx = canvas.getContext("2d");

const patternType = document.getElementById("pattern-type");
const bgColor = document.getElementById("bg-color");
const fgColor = document.getElementById("fg-color");
const solidColor = document.getElementById("solid-color");

const displayModeSelect = document.getElementById("display-mode");
const videoFileInput = document.getElementById("video-file");
const videoAssetList = document.getElementById("video-asset-list");
const videoOpacityInput = document.getElementById("video-opacity");
const videoOpacityValue = document.getElementById("video-opacity-value");
const assignVideoCurrentBtn = document.getElementById("assign-video-current");
const assignVideoPresetBtn = document.getElementById("assign-video-preset");
const playVideosBtn = document.getElementById("play-videos");
const pauseVideosBtn = document.getElementById("pause-videos");

const outWidth = document.getElementById("out-width");
const outHeight = document.getElementById("out-height");
const applyResolutionBtn = document.getElementById("apply-resolution");

const cornerGrid = document.getElementById("corner-grid");
const resetCornersBtn = document.getElementById("reset-corners");
const fitToStageBtn = document.getElementById("fit-to-stage");

const objectList = document.getElementById("object-list");
const addObjectBtn = document.getElementById("add-object");
const duplicateObjectBtn = document.getElementById("duplicate-object");
const deleteObjectBtn = document.getElementById("delete-object");
const objectShapeSelect = document.getElementById("object-shape");

const toggleGuidesBtn = document.getElementById("toggle-guides");
const fullscreenBtn = document.getElementById("fullscreen");

const presetName = document.getElementById("preset-name");
const presetList = document.getElementById("preset-list");
const savePresetBtn = document.getElementById("save-preset");
const loadPresetBtn = document.getElementById("load-preset");
const deletePresetBtn = document.getElementById("delete-preset");
const selectAllMultiBtn = document.getElementById("select-all-multi");
const clearMultiBtn = document.getElementById("clear-multi");
const multiPresetList = document.getElementById("multi-preset-list");

const state = {
  width: Number(outWidth.value),
  height: Number(outHeight.value),
  guidesVisible: true,
  activeHandle: -1,
  presets: {},
  activeMultiPresets: [],
  currentPresetName: "",
  objects: [],
  activeObjectId: "",
  objectCounter: 0,
  selectedVideoAssetId: "",
  videoAssets: {},
  videoCounter: 0,
};

const urlParams = new URLSearchParams(window.location.search);
const IS_OUTPUT_MODE = urlParams.get("mode") === "output";

const syncRuntime = {
  suppressPush: false,
  pushTimer: null,
  pushInFlight: false,
  pushPending: false,
  lastServerVersion: 0,
  pollTimer: null,
};

const cornerInputs = [];
const handles = [];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeDisplayMode(value) {
  if (value === "video") {
    return "video";
  }
  if (value === "solid") {
    return "solid";
  }
  return "pattern";
}

function normalizeShape(value) {
  return value === "circle" ? "circle" : "quad";
}

function normalizeVideoOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }

  if (numeric > 1) {
    return clamp(numeric / 100, 0, 1);
  }

  return clamp(numeric, 0, 1);
}

function deepClone(data) {
  return JSON.parse(JSON.stringify(data));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nextObjectId() {
  state.objectCounter += 1;
  return `obj-${Date.now()}-${state.objectCounter}`;
}

function getPresetNames() {
  return Object.keys(state.presets).sort((a, b) => a.localeCompare(b));
}

function getSelectedPresetName() {
  return presetList.value || presetName.value.trim();
}

function createDefaultCorners(width, height, inset = 0) {
  const pad = clamp(inset, 0, Math.floor(Math.min(width, height) / 2 - 1));
  return [
    { x: pad, y: pad },
    { x: width - pad, y: pad },
    { x: width - pad, y: height - pad },
    { x: pad, y: height - pad },
  ];
}

function normalizeCorners(corners, fallbackWidth, fallbackHeight) {
  if (!Array.isArray(corners) || corners.length !== 4) {
    return createDefaultCorners(fallbackWidth, fallbackHeight, 0);
  }

  return corners.map((point) => ({
    x: Number(point.x) || 0,
    y: Number(point.y) || 0,
  }));
}

function cloneCorners(corners) {
  return corners.map((corner) => ({ x: corner.x, y: corner.y }));
}

function serializeObject(object) {
  return {
    id: object.id,
    name: object.name,
    shape: object.shape,
    corners: cloneCorners(object.corners),
    pattern: object.pattern,
    bg: object.bg,
    fg: object.fg,
    displayMode: object.displayMode,
    solidColor: object.solidColor,
    videoOpacity: object.videoOpacity,
    videoAssetId: object.videoAssetId,
  };
}

function createObject(overrides = {}) {
  const objectIndex = state.objects.length;
  const minDimension = Math.min(state.width, state.height);
  const inset =
    objectIndex === 0
      ? 0
      : Math.min(
          Math.round(minDimension * 0.35),
          Math.max(40, Math.round(minDimension * 0.08) + (objectIndex - 1) * 20)
        );

  return {
    id: typeof overrides.id === "string" && overrides.id ? overrides.id : nextObjectId(),
    name: typeof overrides.name === "string" && overrides.name ? overrides.name : `Object ${objectIndex + 1}`,
    shape: normalizeShape(overrides.shape),
    corners: overrides.corners
      ? normalizeCorners(overrides.corners, state.width, state.height)
      : createDefaultCorners(state.width, state.height, inset),
    pattern: typeof overrides.pattern === "string" ? overrides.pattern : patternType.value,
    bg: typeof overrides.bg === "string" ? overrides.bg : bgColor.value,
    fg: typeof overrides.fg === "string" ? overrides.fg : fgColor.value,
    displayMode: normalizeDisplayMode(overrides.displayMode ?? overrides.sourceType),
    solidColor: typeof overrides.solidColor === "string" ? overrides.solidColor : solidColor.value,
    videoOpacity: normalizeVideoOpacity(overrides.videoOpacity),
    videoAssetId: typeof overrides.videoAssetId === "string" ? overrides.videoAssetId : "",
  };
}

function normalizeObject(raw, presetWidth, presetHeight, index) {
  const minDimension = Math.min(presetWidth, presetHeight);
  const fallbackInset =
    index === 0
      ? 0
      : Math.min(
          Math.round(minDimension * 0.35),
          Math.max(30, Math.round(minDimension * 0.08) + (index - 1) * 16)
        );

  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : nextObjectId(),
    name: typeof raw?.name === "string" && raw.name ? raw.name : `Object ${index + 1}`,
    shape: normalizeShape(raw?.shape),
    corners: raw?.corners
      ? normalizeCorners(raw.corners, presetWidth, presetHeight)
      : createDefaultCorners(presetWidth, presetHeight, fallbackInset),
    pattern: typeof raw?.pattern === "string" ? raw.pattern : "grid",
    bg: typeof raw?.bg === "string" ? raw.bg : "#111111",
    fg: typeof raw?.fg === "string" ? raw.fg : "#f5f5f5",
    displayMode: normalizeDisplayMode(raw?.displayMode ?? raw?.sourceType),
    solidColor: typeof raw?.solidColor === "string" ? raw.solidColor : "#ffffff",
    videoOpacity: normalizeVideoOpacity(raw?.videoOpacity),
    videoAssetId: typeof raw?.videoAssetId === "string" ? raw.videoAssetId : "",
  };
}

function normalizePresetRecord(raw) {
  const presetWidth = Math.max(320, Math.floor(Number(raw?.width) || state.width));
  const presetHeight = Math.max(240, Math.floor(Number(raw?.height) || state.height));

  let objects = [];
  if (Array.isArray(raw?.objects) && raw.objects.length > 0) {
    objects = raw.objects.map((object, index) => normalizeObject(object, presetWidth, presetHeight, index));
  } else {
    objects = [normalizeObject(raw || {}, presetWidth, presetHeight, 0)];
  }

  return {
    width: presetWidth,
    height: presetHeight,
    objects,
  };
}

function normalizeVideoAssets(rawAssets) {
  const normalized = {};
  if (!isObject(rawAssets)) {
    return normalized;
  }

  Object.entries(rawAssets).forEach(([id, asset]) => {
    if (!id || !isObject(asset)) {
      return;
    }

    if (typeof asset.url !== "string" || !asset.url) {
      return;
    }

    normalized[id] = {
      name: typeof asset.name === "string" && asset.name ? asset.name : id,
      url: asset.url,
    };
  });

  return normalized;
}

function buildSharedStatePayload() {
  return deepClone({
    width: state.width,
    height: state.height,
    presets: state.presets,
    activeMultiPresets: state.activeMultiPresets,
    currentPresetName: state.currentPresetName,
    objects: state.objects.map((object) => serializeObject(object)),
    activeObjectId: state.activeObjectId,
    selectedVideoAssetId: state.selectedVideoAssetId,
    videoAssets: state.videoAssets,
  });
}

function applySharedStatePayload(payload) {
  if (!isObject(payload)) {
    return false;
  }

  const nextWidth = Math.max(320, Math.floor(Number(payload.width) || state.width));
  const nextHeight = Math.max(240, Math.floor(Number(payload.height) || state.height));
  setResolution(nextWidth, nextHeight);

  const nextVideoAssets = normalizeVideoAssets(payload.videoAssets);
  const nextPresets = {};
  if (isObject(payload.presets)) {
    Object.entries(payload.presets).forEach(([name, preset]) => {
      if (!name || !isObject(preset)) {
        return;
      }
      nextPresets[name] = normalizePresetRecord(preset);
    });
  }

  state.videoAssets = nextVideoAssets;
  state.presets = nextPresets;

  if (Array.isArray(payload.objects) && payload.objects.length > 0) {
    state.objects = payload.objects.map((object, index) => normalizeObject(object, state.width, state.height, index));
  } else {
    state.objects = [];
  }
  ensureAtLeastOneObject();

  const requestedActiveObjectId = typeof payload.activeObjectId === "string" ? payload.activeObjectId : "";
  if (state.objects.some((object) => object.id === requestedActiveObjectId)) {
    state.activeObjectId = requestedActiveObjectId;
  } else {
    state.activeObjectId = state.objects[0].id;
  }

  const requestedPresetName = typeof payload.currentPresetName === "string" ? payload.currentPresetName : "";
  state.currentPresetName = state.presets[requestedPresetName] ? requestedPresetName : "";

  const requestedSelectedVideo = typeof payload.selectedVideoAssetId === "string" ? payload.selectedVideoAssetId : "";
  if (state.videoAssets[requestedSelectedVideo]) {
    state.selectedVideoAssetId = requestedSelectedVideo;
  } else {
    state.selectedVideoAssetId = Object.keys(state.videoAssets)[0] || "";
  }

  const presetNames = new Set(getPresetNames());
  const requestedMulti = Array.isArray(payload.activeMultiPresets) ? payload.activeMultiPresets : [];
  state.activeMultiPresets = requestedMulti.filter((name, index) => typeof name === "string" && presetNames.has(name) && requestedMulti.indexOf(name) === index);

  if (presetName) {
    presetName.value = state.currentPresetName;
  }

  renderPresetListOnly();
  renderMultiPresetControls();
  renderObjectList();
  syncEditorFieldsFromActiveObject();
  redraw(true);

  return true;
}

async function fetchServerState() {
  try {
    const response = await fetch(API_STATE_ENDPOINT, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    if (!isObject(payload)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

async function pullSharedStateFromServer(force = false) {
  const serverPayload = await fetchServerState();
  if (!serverPayload || !isObject(serverPayload)) {
    return false;
  }

  const version = Number(serverPayload.version) || 0;
  const remoteState = isObject(serverPayload.state) ? serverPayload.state : null;
  if (!remoteState) {
    return false;
  }

  if (!force && version > 0 && version === syncRuntime.lastServerVersion) {
    return false;
  }

  syncRuntime.suppressPush = true;
  try {
    const applied = applySharedStatePayload(remoteState);
    if (applied) {
      syncRuntime.lastServerVersion = version;
    }
    return applied;
  } finally {
    syncRuntime.suppressPush = false;
  }
}

async function pushSharedStateToServer() {
  if (IS_OUTPUT_MODE || syncRuntime.suppressPush) {
    return;
  }

  if (syncRuntime.pushInFlight) {
    syncRuntime.pushPending = true;
    return;
  }

  syncRuntime.pushInFlight = true;
  try {
    const response = await fetch(API_STATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: buildSharedStatePayload() }),
    });

    if (response.ok) {
      const data = await response.json().catch(() => null);
      if (isObject(data) && Number.isFinite(Number(data.version))) {
        syncRuntime.lastServerVersion = Number(data.version);
      }
    }
  } catch {
    // Keep local operation even if sync API is unavailable.
  } finally {
    syncRuntime.pushInFlight = false;
    if (syncRuntime.pushPending) {
      syncRuntime.pushPending = false;
      queueSharedStatePush();
    }
  }
}

function queueSharedStatePush() {
  if (IS_OUTPUT_MODE || syncRuntime.suppressPush) {
    return;
  }

  if (syncRuntime.pushTimer) {
    return;
  }

  syncRuntime.pushTimer = setTimeout(() => {
    syncRuntime.pushTimer = null;
    void pushSharedStateToServer();
  }, SYNC_PUSH_DEBOUNCE_MS);
}

function startOutputModePolling() {
  if (!IS_OUTPUT_MODE || syncRuntime.pollTimer) {
    return;
  }

  syncRuntime.pollTimer = setInterval(() => {
    void pullSharedStateFromServer();
  }, OUTPUT_POLL_MS);
}

async function uploadVideoFileToServer(file) {
  const nameParam = encodeURIComponent(file.name || `video-${Date.now()}`);
  const response = await fetch(`${API_UPLOAD_ENDPOINT}?name=${nameParam}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });

  if (!response.ok) {
    throw new Error("upload_failed");
  }

  const payload = await response.json();
  if (!isObject(payload) || typeof payload.id !== "string" || typeof payload.url !== "string") {
    throw new Error("invalid_upload_payload");
  }

  return {
    id: payload.id,
    name: typeof payload.name === "string" && payload.name ? payload.name : file.name,
    url: payload.url,
  };
}

function ensureAtLeastOneObject() {
  if (state.objects.length > 0) {
    return;
  }

  const object = createObject({
    corners: createDefaultCorners(state.width, state.height, 0),
    shape: "quad",
    displayMode: "pattern",
  });

  state.objects = [object];
  state.activeObjectId = object.id;
}

function getActiveObject() {
  ensureAtLeastOneObject();

  let active = state.objects.find((object) => object.id === state.activeObjectId);
  if (active) {
    return active;
  }

  active = state.objects[0] || null;
  state.activeObjectId = active ? active.id : "";
  return active;
}

function setResolution(width, height) {
  state.width = Math.max(320, Math.floor(width));
  state.height = Math.max(240, Math.floor(height));

  outWidth.value = String(state.width);
  outHeight.value = String(state.height);

  stage.style.width = `${state.width}px`;
  stage.style.height = `${state.height}px`;

  canvas.width = state.width;
  canvas.height = state.height;
}

function drawPattern(targetCtx, width, height, options) {
  const bg = options.bg;
  const fg = options.fg;
  const type = options.type;

  targetCtx.fillStyle = bg;
  targetCtx.fillRect(0, 0, width, height);

  targetCtx.strokeStyle = fg;
  targetCtx.fillStyle = fg;
  targetCtx.lineWidth = Math.max(1, Math.round(Math.min(width, height) * 0.0025));

  if (type === "grid") {
    const step = Math.max(20, Math.round(Math.min(width, height) / 20));
    targetCtx.beginPath();
    for (let x = 0; x <= width; x += step) {
      targetCtx.moveTo(x, 0);
      targetCtx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += step) {
      targetCtx.moveTo(0, y);
      targetCtx.lineTo(width, y);
    }
    targetCtx.stroke();
  }

  if (type === "checker") {
    const size = Math.max(24, Math.round(Math.min(width, height) / 12));
    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        if (((x / size + y / size) | 0) % 2 === 0) {
          targetCtx.fillRect(x, y, size, size);
        }
      }
    }
  }

  if (type === "crosshair") {
    const cx = width / 2;
    const cy = height / 2;
    const pad = Math.min(width, height) * 0.1;

    targetCtx.beginPath();
    targetCtx.moveTo(pad, cy);
    targetCtx.lineTo(width - pad, cy);
    targetCtx.moveTo(cx, pad);
    targetCtx.lineTo(cx, height - pad);
    targetCtx.stroke();

    targetCtx.beginPath();
    targetCtx.arc(cx, cy, Math.min(width, height) * 0.12, 0, Math.PI * 2);
    targetCtx.stroke();

    targetCtx.font = `${Math.max(14, Math.round(Math.min(width, height) * 0.03))}px monospace`;
    targetCtx.fillText(`${width} x ${height}`, 16, height - 18);
  }

  if (type === "bars") {
    const colors = ["#ffffff", "#f4ea2a", "#13e6e6", "#30d030", "#d32bd3", "#e32626", "#1550dd", "#0a0a0a"];
    const barWidth = width / colors.length;

    colors.forEach((color, index) => {
      targetCtx.fillStyle = color;
      targetCtx.fillRect(index * barWidth, 0, barWidth + 1, height * 0.72);
    });

    const lower = ["#1b1b1b", "#ffffff", "#262626", "#ffffff", "#3c3c3c", "#ffffff", "#111111", "#ffffff"];
    const lowHeight = height * 0.28;

    lower.forEach((color, index) => {
      targetCtx.fillStyle = color;
      targetCtx.fillRect(index * barWidth, height - lowHeight, barWidth + 1, lowHeight);
    });
  }
}

function drawSolid(targetCtx, width, height, color) {
  targetCtx.fillStyle = color;
  targetCtx.fillRect(0, 0, width, height);
}

function renderActiveObjectCanvas(object) {
  if (object.displayMode === "solid") {
    drawSolid(ctx, state.width, state.height, object.solidColor);
    return;
  }

  drawPattern(ctx, state.width, state.height, {
    type: object.pattern,
    bg: object.bg,
    fg: object.fg,
  });
}

function attemptVideoPlay(videoElement) {
  const playPromise = videoElement.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      // Ignore autoplay errors triggered by browser policies.
    });
  }
}

function updateMainSourceMedia(object) {
  const videoAsset = state.videoAssets[object.videoAssetId];
  const useVideo = object.displayMode === "video" && Boolean(videoAsset);

  if (useVideo) {
    if (sourceVideo.dataset.assetId !== object.videoAssetId) {
      sourceVideo.src = videoAsset.url;
      sourceVideo.dataset.assetId = object.videoAssetId;
    }

    sourceVideo.style.display = "block";
    sourceVideo.style.opacity = String(object.videoOpacity);
    canvas.style.display = "none";
    attemptVideoPlay(sourceVideo);
    return;
  }

  if (sourceVideo.dataset.assetId) {
    sourceVideo.pause();
    sourceVideo.removeAttribute("src");
    sourceVideo.load();
    sourceVideo.dataset.assetId = "";
  }

  sourceVideo.style.display = "none";
  sourceVideo.style.opacity = "1";
  canvas.style.display = "block";
}

function renderCornerInputs() {
  cornerGrid.innerHTML = "";
  cornerInputs.length = 0;

  for (let i = 0; i < 4; i += 1) {
    const item = document.createElement("div");
    item.className = "corner-item";

    const title = document.createElement("strong");
    title.textContent = CORNER_NAMES[i];

    const wrap = document.createElement("div");
    wrap.className = "xy";

    const x = document.createElement("input");
    x.type = "number";
    x.step = "1";
    x.addEventListener("input", () => {
      const active = getActiveObject();
      if (!active) {
        return;
      }

      active.corners[i].x = Number(x.value);
      redraw();
    });

    const y = document.createElement("input");
    y.type = "number";
    y.step = "1";
    y.addEventListener("input", () => {
      const active = getActiveObject();
      if (!active) {
        return;
      }

      active.corners[i].y = Number(y.value);
      redraw();
    });

    wrap.append(x, y);
    item.append(title, wrap);
    cornerGrid.append(item);

    cornerInputs.push({ x, y });
  }
}

function renderHandles() {
  handlesWrap.innerHTML = "";
  handles.length = 0;

  for (let i = 0; i < 4; i += 1) {
    const handle = document.createElement("div");
    handle.className = "handle";
    handle.dataset.index = String(i);

    handle.addEventListener("pointerdown", (event) => {
      state.activeHandle = i;
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener("pointerup", () => {
      state.activeHandle = -1;
    });

    handle.addEventListener("pointercancel", () => {
      state.activeHandle = -1;
    });

    handlesWrap.append(handle);
    handles.push(handle);
  }
}

function updateCornerInputs(object) {
  cornerInputs.forEach((pair, index) => {
    if (!object) {
      pair.x.value = "";
      pair.y.value = "";
      pair.x.disabled = true;
      pair.y.disabled = true;
      return;
    }

    pair.x.disabled = false;
    pair.y.disabled = false;
    pair.x.value = String(Math.round(object.corners[index].x));
    pair.y.value = String(Math.round(object.corners[index].y));
  });
}

function drawGuides(object) {
  if (!object) {
    guides.innerHTML = "";
    return;
  }

  const points = object.corners;
  guides.innerHTML = `
    <polygon points="${points.map((corner) => `${(corner.x / state.width) * 100},${(corner.y / state.height) * 100}`).join(" ")}" fill="none" stroke="#7dd3fc" stroke-width="0.4" />
    <line x1="${(points[0].x / state.width) * 100}" y1="${(points[0].y / state.height) * 100}" x2="${(points[2].x / state.width) * 100}" y2="${(points[2].y / state.height) * 100}" stroke="#59f7a6" stroke-width="0.3" />
    <line x1="${(points[1].x / state.width) * 100}" y1="${(points[1].y / state.height) * 100}" x2="${(points[3].x / state.width) * 100}" y2="${(points[3].y / state.height) * 100}" stroke="#59f7a6" stroke-width="0.3" />
  `;
}

function updateHandlePositions(object) {
  handles.forEach((handle, index) => {
    if (!object) {
      handle.style.display = "none";
      return;
    }

    handle.style.display = "block";
    handle.style.left = `${(object.corners[index].x / state.width) * 100}%`;
    handle.style.top = `${(object.corners[index].y / state.height) * 100}%`;
  });
}

function gaussianElimination(a, b) {
  const n = a.length;
  const m = a[0].length;

  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let r = i + 1; r < n; r += 1) {
      if (Math.abs(a[r][i]) > Math.abs(a[maxRow][i])) {
        maxRow = r;
      }
    }

    [a[i], a[maxRow]] = [a[maxRow], a[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];

    const pivot = a[i][i] || 1e-12;
    for (let c = i; c < m; c += 1) {
      a[i][c] /= pivot;
    }
    b[i] /= pivot;

    for (let r = 0; r < n; r += 1) {
      if (r === i) {
        continue;
      }

      const factor = a[r][i];
      for (let c = i; c < m; c += 1) {
        a[r][c] -= factor * a[i][c];
      }
      b[r] -= factor * b[i];
    }
  }

  return b;
}

function computeHomography(src, dst) {
  const a = [];
  const b = [];

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];

    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);

    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = gaussianElimination(
    a.map((row) => row.slice()),
    b.slice()
  );

  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function buildWarpMatrix(sourceWidth, sourceHeight, destinationCorners) {
  const src = [
    { x: 0, y: 0 },
    { x: sourceWidth, y: 0 },
    { x: sourceWidth, y: sourceHeight },
    { x: 0, y: sourceHeight },
  ];

  const h = computeHomography(src, destinationCorners);

  const m11 = h[0];
  const m12 = h[1];
  const m14 = h[2];
  const m21 = h[3];
  const m22 = h[4];
  const m24 = h[5];
  const m41 = h[6];
  const m42 = h[7];
  const m44 = h[8];

  return [
    m11, m21, 0, m41,
    m12, m22, 0, m42,
    0, 0, 1, 0,
    m14, m24, 0, m44,
  ];
}

function applyWarpToElement(element, sourceWidth, sourceHeight, destinationCorners) {
  const matrix = buildWarpMatrix(sourceWidth, sourceHeight, destinationCorners);
  element.style.transform = `matrix3d(${matrix.join(",")})`;
}

function buildCanvasLayer(width, height, object) {
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = width;
  layerCanvas.height = height;

  const layerCtx = layerCanvas.getContext("2d");
  if (layerCtx) {
    if (object.displayMode === "solid") {
      drawSolid(layerCtx, width, height, object.solidColor);
    } else {
      drawPattern(layerCtx, width, height, {
        type: object.pattern,
        bg: object.bg,
        fg: object.fg,
      });
    }
  }

  return layerCanvas;
}

function buildVideoLayer(videoAssetId, videoOpacity) {
  const asset = state.videoAssets[videoAssetId];
  if (!asset) {
    return null;
  }

  const video = document.createElement("video");
  video.src = asset.url;
  video.style.opacity = String(videoOpacity);
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = "auto";
  attemptVideoPlay(video);
  return video;
}

function buildMappedLayerFromObject(object, sourceWidth, sourceHeight) {
  const layer = document.createElement("div");
  layer.className = "multi-layer";
  if (object.shape === "circle") {
    layer.classList.add("is-circle");
  }

  layer.style.width = `${sourceWidth}px`;
  layer.style.height = `${sourceHeight}px`;

  const scaledCorners = object.corners.map((corner) => ({
    x: (corner.x / sourceWidth) * state.width,
    y: (corner.y / sourceHeight) * state.height,
  }));

  const videoLayer = object.displayMode === "video" ? buildVideoLayer(object.videoAssetId, object.videoOpacity) : null;
  if (videoLayer) {
    layer.append(videoLayer);
  } else {
    layer.append(buildCanvasLayer(sourceWidth, sourceHeight, object));
  }

  applyWarpToElement(layer, sourceWidth, sourceHeight, scaledCorners);
  return layer;
}

function renderSceneLayers() {
  multiQuads.innerHTML = "";
  let renderedLayers = 0;

  state.objects.forEach((object) => {
    if (object.id === state.activeObjectId) {
      return;
    }

    const layer = buildMappedLayerFromObject(object, state.width, state.height);
    multiQuads.append(layer);
    renderedLayers += 1;
  });

  state.activeMultiPresets.forEach((name) => {
    if (name === state.currentPresetName) {
      return;
    }

    const preset = state.presets[name];
    if (!preset) {
      return;
    }

    preset.objects.forEach((object) => {
      const layer = buildMappedLayerFromObject(object, preset.width, preset.height);
      multiQuads.append(layer);
      renderedLayers += 1;
    });
  });

  stage.classList.toggle("is-composite", renderedLayers > 0);
}

function renderObjectList() {
  objectList.innerHTML = "";

  state.objects.forEach((object, index) => {
    const option = document.createElement("option");
    option.value = object.id;
    option.textContent = `${index + 1}. ${object.name}${object.shape === "circle" ? " (Circle)" : ""}`;
    objectList.append(option);
  });

  if (state.objects.some((object) => object.id === state.activeObjectId)) {
    objectList.value = state.activeObjectId;
  }
}

function renderVideoAssetList() {
  const entries = Object.entries(state.videoAssets).sort((a, b) => a[1].name.localeCompare(b[1].name));
  videoAssetList.innerHTML = "";

  if (entries.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No videos loaded";
    option.selected = true;
    option.disabled = true;
    videoAssetList.append(option);
    state.selectedVideoAssetId = "";
    return;
  }

  entries.forEach(([id, asset]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = asset.name;
    videoAssetList.append(option);
  });

  if (!state.videoAssets[state.selectedVideoAssetId]) {
    state.selectedVideoAssetId = entries[0][0];
  }

  videoAssetList.value = state.selectedVideoAssetId;
}

function setVideoOpacityInput(opacity) {
  const percent = Math.round(clamp(opacity * 100, 0, 100));
  videoOpacityInput.value = String(percent);
  videoOpacityValue.textContent = `${percent}%`;
}

function updateDisplayModeControlState(mode) {
  const isPattern = mode === "pattern";
  const isSolid = mode === "solid";
  const isVideo = mode === "video";

  patternType.disabled = !isPattern;
  bgColor.disabled = !isPattern;
  fgColor.disabled = !isPattern;
  solidColor.disabled = !isSolid;
  videoAssetList.disabled = !isVideo;
  videoOpacityInput.disabled = !isVideo;
}

function syncEditorFieldsFromActiveObject() {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  patternType.value = active.pattern;
  bgColor.value = active.bg;
  fgColor.value = active.fg;
  solidColor.value = active.solidColor;
  displayModeSelect.value = active.displayMode;
  setVideoOpacityInput(active.videoOpacity);
  objectShapeSelect.value = active.shape;

  if (active.videoAssetId && state.videoAssets[active.videoAssetId]) {
    state.selectedVideoAssetId = active.videoAssetId;
  }

  renderVideoAssetList();
  updateDisplayModeControlState(active.displayMode);
}

function setActiveObject(id) {
  if (!state.objects.some((object) => object.id === id)) {
    return;
  }

  state.activeObjectId = id;
  renderObjectList();
  syncEditorFieldsFromActiveObject();
  redraw(true);
}

async function addVideoAsset(file) {
  if (!file.type || !file.type.startsWith("video/")) {
    return;
  }

  let assetId = "";
  let assetName = file.name;
  let assetUrl = "";

  try {
    const uploaded = await uploadVideoFileToServer(file);
    assetId = uploaded.id;
    assetName = uploaded.name;
    assetUrl = uploaded.url;
  } catch {
    state.videoCounter += 1;
    assetId = `video-${Date.now()}-${state.videoCounter}`;
    assetUrl = URL.createObjectURL(file);
  }

  state.videoAssets[assetId] = {
    name: assetName,
    url: assetUrl,
  };

  state.selectedVideoAssetId = assetId;

  const active = getActiveObject();
  if (active && active.displayMode === "video" && !active.videoAssetId) {
    active.videoAssetId = assetId;
  }

  renderVideoAssetList();
  redraw(true);
}

function assignSelectedVideoToCurrent() {
  const active = getActiveObject();
  const videoId = state.selectedVideoAssetId;
  if (!active || !videoId || !state.videoAssets[videoId]) {
    return;
  }

  active.displayMode = "video";
  active.videoAssetId = videoId;
  displayModeSelect.value = "video";
  updateDisplayModeControlState("video");
  redraw(true);
}

function assignSelectedVideoToPreset(name) {
  const videoId = state.selectedVideoAssetId;
  if (!videoId || !state.videoAssets[videoId]) {
    return;
  }

  const preset = state.presets[name];
  if (!preset) {
    return;
  }

  const preferredId = name === state.currentPresetName ? state.activeObjectId : "";
  const targetObject = preset.objects.find((object) => object.id === preferredId) || preset.objects[0];
  if (!targetObject) {
    return;
  }

  targetObject.displayMode = "video";
  targetObject.videoAssetId = videoId;

  if (name === state.currentPresetName) {
    const localObject = state.objects.find((object) => object.id === targetObject.id);
    if (localObject) {
      localObject.displayMode = "video";
      localObject.videoAssetId = videoId;
    }
  }

  savePresets();
  refreshPresetList();

  if (name === state.currentPresetName) {
    syncEditorFieldsFromActiveObject();
    redraw(true);
  }
}

function renderMultiPresetControls(names = getPresetNames()) {
  multiPresetList.innerHTML = "";

  if (names.length === 0) {
    const empty = document.createElement("div");
    empty.className = "multi-empty";
    empty.textContent = "Save presets to composite them here.";
    multiPresetList.append(empty);
    return;
  }

  names.forEach((name) => {
    const item = document.createElement("label");
    item.className = "multi-preset-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.activeMultiPresets.includes(name);
    checkbox.addEventListener("change", () => {
      const next = new Set(state.activeMultiPresets);
      if (checkbox.checked) {
        next.add(name);
      } else {
        next.delete(name);
      }
      setActiveMultiPresets(Array.from(next));
    });

    const text = document.createElement("span");
    text.textContent = name;

    item.append(checkbox, text);
    multiPresetList.append(item);
  });
}

function setActiveMultiPresets(names) {
  const known = new Set(getPresetNames());
  const next = [];

  names.forEach((name) => {
    if (known.has(name) && !next.includes(name)) {
      next.push(name);
    }
  });

  state.activeMultiPresets = next;
  renderMultiPresetControls();
  renderSceneLayers();
  queueSharedStatePush();
}

function redraw(renderScene = false) {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  renderActiveObjectCanvas(active);
  updateMainSourceMedia(active);
  updateCornerInputs(active);
  updateHandlePositions(active);
  drawGuides(active);

  quad.classList.toggle("is-circle", active.shape === "circle");
  applyWarpToElement(quad, state.width, state.height, active.corners);

  if (renderScene) {
    renderSceneLayers();
  }

  queueSharedStatePush();
}

function savePresets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.presets));
}

function loadPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    const normalized = {};

    Object.entries(parsed).forEach(([name, preset]) => {
      if (preset && typeof preset === "object") {
        normalized[name] = normalizePresetRecord(preset);
      }
    });

    state.presets = normalized;
  } catch {
    state.presets = {};
  }
}

function renderPresetListOnly() {
  const names = getPresetNames();
  const previousValue = presetList.value;

  presetList.innerHTML = "";
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    presetList.append(option);
  });

  if (names.includes(previousValue)) {
    presetList.value = previousValue;
  }
}

function refreshPresetList() {
  const names = getPresetNames();
  renderPresetListOnly();

  state.activeMultiPresets = state.activeMultiPresets.filter((name) => names.includes(name));
  if (!names.includes(state.currentPresetName)) {
    state.currentPresetName = "";
  }

  renderMultiPresetControls(names);
  renderSceneLayers();
  queueSharedStatePush();
}

function saveCurrentPreset(name) {
  ensureAtLeastOneObject();

  state.presets[name] = {
    width: state.width,
    height: state.height,
    objects: state.objects.map((object) => serializeObject(object)),
  };

  state.currentPresetName = name;
  savePresets();
  refreshPresetList();
}

function applyPreset(name) {
  const preset = state.presets[name];
  if (!preset) {
    return;
  }

  setResolution(preset.width, preset.height);
  state.objects = preset.objects.map((object, index) => normalizeObject(object, preset.width, preset.height, index));
  ensureAtLeastOneObject();

  state.activeObjectId = state.objects[0].id;
  state.currentPresetName = name;
  presetName.value = name;

  renderObjectList();
  syncEditorFieldsFromActiveObject();
  redraw(true);
}

function createObjectFromActiveTemplate() {
  const active = getActiveObject();

  return createObject({
    pattern: active.pattern,
    bg: active.bg,
    fg: active.fg,
    displayMode: active.displayMode,
    solidColor: active.solidColor,
    videoOpacity: active.videoOpacity,
    videoAssetId: active.videoAssetId,
    shape: active.shape,
  });
}

function duplicateActiveObject() {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  const offset = Math.max(12, Math.round(Math.min(state.width, state.height) * 0.025));
  const corners = active.corners.map((corner) => ({
    x: clamp(corner.x + offset, -state.width * 2, state.width * 3),
    y: clamp(corner.y + offset, -state.height * 2, state.height * 3),
  }));

  const copy = createObject({
    name: `${active.name} Copy`,
    shape: active.shape,
    corners,
    pattern: active.pattern,
    bg: active.bg,
    fg: active.fg,
    displayMode: active.displayMode,
    solidColor: active.solidColor,
    videoOpacity: active.videoOpacity,
    videoAssetId: active.videoAssetId,
  });

  state.objects.push(copy);
  setActiveObject(copy.id);
}

function deleteActiveObject() {
  if (state.objects.length <= 1) {
    const only = getActiveObject();
    if (only) {
      only.shape = "quad";
      only.corners = createDefaultCorners(state.width, state.height, 0);
      only.displayMode = "pattern";
      only.solidColor = "#ffffff";
      only.videoOpacity = 1;
      redraw(true);
    }
    return;
  }

  const index = state.objects.findIndex((object) => object.id === state.activeObjectId);
  if (index < 0) {
    return;
  }

  state.objects.splice(index, 1);

  const nextIndex = clamp(index, 0, state.objects.length - 1);
  state.activeObjectId = state.objects[nextIndex].id;

  renderObjectList();
  syncEditorFieldsFromActiveObject();
  redraw(true);
}

function fitActiveObjectToStage() {
  const active = getActiveObject();
  if (!active) {
    return;
  }
  active.corners = createDefaultCorners(state.width, state.height, 0);
}

function resetActiveObjectCorners() {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  active.corners = createDefaultCorners(state.width, state.height, 0);
}

function getMappedVideoElements() {
  const videos = Array.from(stage.querySelectorAll(".multi-layer video"));
  if (sourceVideo.style.display !== "none") {
    videos.push(sourceVideo);
  }
  return videos;
}

stage.addEventListener("pointermove", (event) => {
  if (state.activeHandle < 0) {
    return;
  }

  const active = getActiveObject();
  if (!active) {
    return;
  }

  const rect = stage.getBoundingClientRect();
  const px = ((event.clientX - rect.left) / rect.width) * state.width;
  const py = ((event.clientY - rect.top) / rect.height) * state.height;

  active.corners[state.activeHandle].x = clamp(px, -state.width * 2, state.width * 3);
  active.corners[state.activeHandle].y = clamp(py, -state.height * 2, state.height * 3);

  redraw();
});

window.addEventListener("pointerup", () => {
  state.activeHandle = -1;
});

patternType.addEventListener("input", () => {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  active.pattern = patternType.value;
  redraw(true);
});

bgColor.addEventListener("input", () => {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  active.bg = bgColor.value;
  redraw(true);
});

fgColor.addEventListener("input", () => {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  active.fg = fgColor.value;
  redraw(true);
});

solidColor.addEventListener("input", () => {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  active.solidColor = solidColor.value;
  redraw(true);
});

videoOpacityInput.addEventListener("input", () => {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  const percent = Number(videoOpacityInput.value);
  active.videoOpacity = normalizeVideoOpacity(percent / 100);
  setVideoOpacityInput(active.videoOpacity);
  redraw(true);
});

displayModeSelect.addEventListener("change", () => {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  active.displayMode = normalizeDisplayMode(displayModeSelect.value);
  if (active.displayMode === "video" && !state.videoAssets[active.videoAssetId] && state.selectedVideoAssetId) {
    active.videoAssetId = state.selectedVideoAssetId;
  }

  updateDisplayModeControlState(active.displayMode);
  redraw(true);
});

objectShapeSelect.addEventListener("change", () => {
  const active = getActiveObject();
  if (!active) {
    return;
  }

  active.shape = normalizeShape(objectShapeSelect.value);
  renderObjectList();
  redraw(true);
});

videoFileInput.addEventListener("change", async () => {
  const files = Array.from(videoFileInput.files || []);
  for (const file of files) {
    // Upload sequentially to keep ordering predictable in the asset list.
    await addVideoAsset(file);
  }
  videoFileInput.value = "";
});

videoAssetList.addEventListener("change", () => {
  state.selectedVideoAssetId = videoAssetList.value;
});

assignVideoCurrentBtn.addEventListener("click", () => {
  assignSelectedVideoToCurrent();
});

assignVideoPresetBtn.addEventListener("click", () => {
  assignSelectedVideoToPreset(getSelectedPresetName());
});

playVideosBtn.addEventListener("click", () => {
  getMappedVideoElements().forEach((video) => {
    attemptVideoPlay(video);
  });
});

pauseVideosBtn.addEventListener("click", () => {
  getMappedVideoElements().forEach((video) => {
    video.pause();
  });
});

applyResolutionBtn.addEventListener("click", () => {
  const oldWidth = state.width;
  const oldHeight = state.height;

  const newWidth = Number(outWidth.value);
  const newHeight = Number(outHeight.value);

  if (!Number.isFinite(newWidth) || !Number.isFinite(newHeight)) {
    return;
  }

  setResolution(newWidth, newHeight);

  state.objects = state.objects.map((object) => ({
    ...object,
    corners: object.corners.map((corner) => ({
      x: (corner.x / oldWidth) * state.width,
      y: (corner.y / oldHeight) * state.height,
    })),
  }));

  redraw(true);
});

resetCornersBtn.addEventListener("click", () => {
  resetActiveObjectCorners();
  redraw();
});

fitToStageBtn.addEventListener("click", () => {
  fitActiveObjectToStage();
  redraw();
});

objectList.addEventListener("change", () => {
  setActiveObject(objectList.value);
});

addObjectBtn.addEventListener("click", () => {
  const object = createObjectFromActiveTemplate();
  state.objects.push(object);
  setActiveObject(object.id);
});

duplicateObjectBtn.addEventListener("click", () => {
  duplicateActiveObject();
});

deleteObjectBtn.addEventListener("click", () => {
  deleteActiveObject();
});

toggleGuidesBtn.addEventListener("click", () => {
  state.guidesVisible = !state.guidesVisible;
  guides.classList.toggle("hidden", !state.guidesVisible);
  handlesWrap.classList.toggle("hidden", !state.guidesVisible);
  toggleGuidesBtn.textContent = state.guidesVisible ? "Hide Guides" : "Show Guides";
});

fullscreenBtn.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await stage.requestFullscreen();
  } catch {
    // Ignore fullscreen errors (e.g. user denied).
  }
});

savePresetBtn.addEventListener("click", () => {
  const name = presetName.value.trim();
  if (!name) {
    return;
  }

  saveCurrentPreset(name);
  presetList.value = name;
});

loadPresetBtn.addEventListener("click", () => {
  const name = getSelectedPresetName();
  if (!name) {
    return;
  }

  applyPreset(name);
});

deletePresetBtn.addEventListener("click", () => {
  const name = getSelectedPresetName();
  if (!name || !state.presets[name]) {
    return;
  }

  delete state.presets[name];
  savePresets();
  refreshPresetList();

  if (state.currentPresetName === name) {
    state.currentPresetName = "";
  }

  if (presetName.value.trim() === name) {
    presetName.value = "";
  }
});

selectAllMultiBtn.addEventListener("click", () => {
  setActiveMultiPresets(getPresetNames());
});

clearMultiBtn.addEventListener("click", () => {
  setActiveMultiPresets([]);
});

presetList.addEventListener("change", () => {
  presetName.value = presetList.value;
});

window.addEventListener("beforeunload", () => {
  Object.values(state.videoAssets).forEach((asset) => {
    if (typeof asset.url === "string" && asset.url.startsWith("blob:")) {
      URL.revokeObjectURL(asset.url);
    }
  });
});

async function bootstrap() {
  if (IS_OUTPUT_MODE) {
    document.body.classList.add("output-mode");
    state.guidesVisible = false;
    guides.classList.add("hidden");
    handlesWrap.classList.add("hidden");
  }

  setResolution(state.width, state.height);

  state.objects = [
    createObject({
      corners: createDefaultCorners(state.width, state.height, 0),
      shape: "quad",
      displayMode: "pattern",
      name: "Object 1",
    }),
  ];
  state.activeObjectId = state.objects[0].id;

  renderCornerInputs();
  renderHandles();
  renderVideoAssetList();

  loadPresets();
  refreshPresetList();

  renderObjectList();
  syncEditorFieldsFromActiveObject();

  if (IS_OUTPUT_MODE) {
    await pullSharedStateFromServer(true);
    startOutputModePolling();
  } else {
    const pulled = await pullSharedStateFromServer(true);
    if (!pulled) {
      queueSharedStatePush();
    }
  }

  redraw(true);
}

void bootstrap();
