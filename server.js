const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = __dirname;
const RUNTIME_DIR = path.join(ROOT_DIR, ".runtime");
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
const STATE_FILE = path.join(RUNTIME_DIR, "shared-state.json");

const MAX_STATE_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".ogv": "video/ogg",
};

const shared = {
  version: 0,
  updatedAt: null,
  state: null,
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function safeFilename(name) {
  const parsed = path.parse(name || "video");
  const ext = (parsed.ext || "").replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);
  const base = (parsed.name || "video")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 48);

  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const normalizedExt = ext || ".bin";
  return `${id}-${base || "video"}${normalizedExt}`;
}

async function ensureRuntimeFiles() {
  await fsp.mkdir(RUNTIME_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
}

async function loadStateFromDisk() {
  try {
    const raw = await fsp.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return;
    }

    shared.version = Number(parsed.version) || 0;
    shared.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
    shared.state = parsed.state && typeof parsed.state === "object" ? parsed.state : null;
  } catch {
    // No state file yet.
  }
}

async function persistStateToDisk() {
  const content = JSON.stringify(shared, null, 2);
  const tempPath = `${STATE_FILE}.tmp`;
  await fsp.writeFile(tempPath, content, "utf8");
  await fsp.rename(tempPath, STATE_FILE);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;

    req.on("data", (chunk) => {
      if (done) {
        return;
      }

      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (done) {
        return;
      }

      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });

    req.on("error", (error) => {
      if (!done) {
        done = true;
        reject(error);
      }
    });
  });
}

function writeUploadFile(req, targetPath, maxBytes) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(targetPath, { flags: "wx" });
    let total = 0;
    let finished = false;

    function fail(error) {
      if (finished) {
        return;
      }
      finished = true;
      req.unpipe(stream);
      stream.destroy();
      fsp.unlink(targetPath).catch(() => {});
      reject(error);
    }

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        fail(new Error("upload_too_large"));
        req.destroy();
      }
    });

    req.on("error", (error) => {
      fail(error);
    });

    stream.on("error", (error) => {
      fail(error);
    });

    stream.on("finish", () => {
      if (finished) {
        return;
      }
      finished = true;
      resolve(total);
    });

    req.pipe(stream);
  });
}

function resolveStaticPath(requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const normalized = decodedPath === "/" ? "/index.html" : decodedPath;
  const joined = path.normalize(path.join(ROOT_DIR, normalized));

  if (!joined.startsWith(ROOT_DIR)) {
    return null;
  }

  return joined;
}

async function serveStaticFile(reqPath, res) {
  const filePath = resolveStaticPath(reqPath);
  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let stats;
  try {
    stats = await fsp.stat(filePath);
  } catch {
    sendText(res, 404, "Not found");
    return;
  }

  if (!stats.isFile()) {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stats.size,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=60",
  });

  fs.createReadStream(filePath).pipe(res);
}

async function handleUpload(req, res, reqUrl) {
  const nameFromQuery = reqUrl.searchParams.get("name") || "video";
  const filename = safeFilename(nameFromQuery);
  const targetPath = path.join(UPLOAD_DIR, filename);

  try {
    const bytes = await writeUploadFile(req, targetPath, MAX_UPLOAD_BYTES);
    if (bytes <= 0) {
      await fsp.unlink(targetPath).catch(() => {});
      sendJson(res, 400, { error: "empty_upload" });
      return;
    }

    sendJson(res, 200, {
      id: filename,
      name: nameFromQuery,
      url: `/uploads/${encodeURIComponent(filename)}`,
    });
  } catch (error) {
    if (error && error.message === "upload_too_large") {
      sendJson(res, 413, { error: "upload_too_large" });
      return;
    }

    sendJson(res, 500, { error: "upload_failed" });
  }
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || "localhost";
  const reqUrl = new URL(req.url || "/", `http://${host}`);

  if (req.method === "GET" && reqUrl.pathname === "/api/state") {
    sendJson(res, 200, shared);
    return;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/state") {
    try {
      const body = await readJsonBody(req, MAX_STATE_BYTES);
      if (!body || typeof body !== "object" || !body.state || typeof body.state !== "object") {
        sendJson(res, 400, { error: "invalid_state_payload" });
        return;
      }

      shared.version += 1;
      shared.updatedAt = new Date().toISOString();
      shared.state = body.state;

      await persistStateToDisk();

      sendJson(res, 200, {
        ok: true,
        version: shared.version,
        updatedAt: shared.updatedAt,
      });
    } catch (error) {
      if (error && error.message === "body_too_large") {
        sendJson(res, 413, { error: "state_payload_too_large" });
        return;
      }

      if (error && error.message === "invalid_json") {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }

      sendJson(res, 500, { error: "state_write_failed" });
    }
    return;
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/upload") {
    await handleUpload(req, res, reqUrl);
    return;
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, version: shared.version });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    await serveStaticFile(reqUrl.pathname, res);
    return;
  }

  sendText(res, 405, "Method Not Allowed");
});

async function start() {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || "0.0.0.0";

  await ensureRuntimeFiles();
  await loadStateFromDisk();

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`Projection Mapper server listening on http://${host}:${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
