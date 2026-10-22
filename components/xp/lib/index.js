// src/host/index.js
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
var AUDIO_CONTENT_TYPES = Object.freeze({
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".webm": "audio/webm"
});
var MAX_LIST_ENTRIES = 2e3;
var INVALID_RANGE = Symbol("dsh-chime.invalid-range");
async function handleAssetRequest(req, res) {
  try {
    await serveAsset(req, res);
  } catch (error) {
    sendText(res, 500, `dsh-chime asset route failed: ${messageOf(error)}`);
  }
}
async function handleListRequest(req, res) {
  try {
    await serveList(req, res);
  } catch (error) {
    sendJson(res, 500, { error: `dsh-chime list route failed: ${messageOf(error)}` });
  }
}
async function serveAsset(req, res) {
  const method = methodOf(req);
  if (method !== "GET" && method !== "HEAD") {
    sendText(res, 405, "method not allowed; use GET");
    return;
  }
  const target = queryAbsolutePath(req, "path");
  if (target === null) {
    sendText(res, 400, 'query parameter "path" must be a non-empty absolute file path');
    return;
  }
  const extension = extname(target).toLowerCase();
  const contentType = AUDIO_CONTENT_TYPES[extension];
  if (contentType === void 0) {
    sendText(res, 400, `unsupported audio extension: ${extension === "" ? "(none)" : extension}`);
    return;
  }
  let info;
  try {
    info = await stat(target);
  } catch {
    sendText(res, 404, `file not found: ${target}`);
    return;
  }
  if (!info.isFile()) {
    sendText(res, 404, `not a regular file: ${target}`);
    return;
  }
  let data;
  try {
    data = await readFile(target);
  } catch (error) {
    sendText(res, statusForFileError(error), `cannot read file: ${target} (${messageOf(error)})`);
    return;
  }
  const size = data.length;
  const entityHeaders = {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes"
  };
  if (method === "HEAD") {
    res.writeHead(200, { ...entityHeaders, "Content-Length": String(size) });
    res.end();
    return;
  }
  const range = parseRangeHeader(headerOf(req, "range"), size);
  if (range === INVALID_RANGE) {
    res.writeHead(416, {
      ...entityHeaders,
      "Content-Range": `bytes */${size}`,
      "Content-Length": "0"
    });
    res.end();
    return;
  }
  if (range === null) {
    res.writeHead(200, { ...entityHeaders, "Content-Length": String(size) });
    res.end(data);
    return;
  }
  const chunk = data.subarray(range.start, range.end + 1);
  res.writeHead(206, {
    ...entityHeaders,
    "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    "Content-Length": String(chunk.length)
  });
  res.end(chunk);
}
async function serveList(req, res) {
  const method = methodOf(req);
  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, { error: "method not allowed; use GET" });
    return;
  }
  const requested = queryAbsolutePath(req, "path");
  if (requested === null) {
    sendJson(res, 400, { error: 'query parameter "path" must be a non-empty absolute directory path' });
    return;
  }
  const dir = resolve(requested);
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    sendJson(res, statusForDirectoryError(error), {
      error: `cannot list directory: ${dir} (${messageOf(error)})`
    });
    return;
  }
  const directories = [];
  const files = [];
  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      directories.push({ name: dirent.name, path: join(dir, dirent.name), type: "directory" });
      continue;
    }
    if (!dirent.isFile()) continue;
    const extension = extname(dirent.name).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(AUDIO_CONTENT_TYPES, extension)) continue;
    files.push({ name: dirent.name, path: join(dir, dirent.name), type: "file" });
  }
  directories.sort(compareByName);
  files.sort(compareByName);
  const all = directories.concat(files);
  const truncated = all.length > MAX_LIST_ENTRIES;
  sendJson(res, 200, {
    path: dir,
    entries: truncated ? all.slice(0, MAX_LIST_ENTRIES) : all,
    truncated
  });
}
function parseRangeHeader(header, size) {
  if (typeof header !== "string") return null;
  const value = header.trim();
  if (value === "") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (match === null) return null;
  const rawStart = match[1];
  const rawEnd = match[2];
  if (rawStart === "" && rawEnd === "") return null;
  let start;
  let end;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return INVALID_RANGE;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return INVALID_RANGE;
  if (size === 0 || start >= size || end < 0 || start > end) return INVALID_RANGE;
  return { start, end };
}
function queryAbsolutePath(req, name2) {
  let raw;
  try {
    const requestUrl = req && typeof req.url === "string" && req.url !== "" ? req.url : "/";
    raw = new URL(requestUrl, "http://localhost").searchParams.get(name2);
  } catch {
    return null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.includes("\0")) return null;
  return isAbsolute(trimmed) ? trimmed : null;
}
function methodOf(req) {
  return req && typeof req.method === "string" ? req.method.toUpperCase() : "GET";
}
function headerOf(req, name2) {
  const headers = req ? req.headers : void 0;
  if (!headers || typeof headers !== "object") return void 0;
  if (headers[name2] !== void 0) return headers[name2];
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name2) return headers[key];
  }
  return void 0;
}
function statusForFileError(error) {
  const code = errorCodeOf(error);
  if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return 404;
  if (code === "EACCES" || code === "EPERM") return 403;
  return 500;
}
function statusForDirectoryError(error) {
  const code = errorCodeOf(error);
  if (code === "ENOENT" || code === "ENOTDIR") return 404;
  if (code === "EACCES" || code === "EPERM") return 403;
  return 500;
}
function errorCodeOf(error) {
  return error && typeof error === "object" && typeof error.code === "string" ? error.code : "";
}
function sendText(res, status, message) {
  sendBody(res, status, "text/plain; charset=utf-8", Buffer.from(`${message}
`, "utf8"));
}
function sendJson(res, status, value) {
  sendBody(res, status, "application/json; charset=utf-8", Buffer.from(JSON.stringify(value), "utf8"));
}
function sendBody(res, status, contentType, body) {
  try {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    try {
      res.end();
    } catch {
    }
  }
}
function compareByName(a, b) {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}
function messageOf(error) {
  if (error instanceof Error) return error.message || error.name || "unknown error";
  if (typeof error === "string") return error;
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}

// src/xp/host.js
var name = "dsh-chime-xp";
var inject = ["webServer"];
function apply(ctx) {
  const register = () => {
    const web = ctx.get("webServer");
    const disposers = [];
    try {
      disposers.push(web.register({ kind: "prefix", path: "/dsh-chime-xp/asset", handler: handleAssetRequest }));
      disposers.push(web.register({ kind: "prefix", path: "/dsh-chime-xp/list", handler: handleListRequest }));
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose();
      throw error;
    }
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  };
  ctx.effect(register, "dsh-chime-xp: independent audio routes");
}
export {
  apply,
  inject,
  name
};
