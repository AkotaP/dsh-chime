// src/host/index.js
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
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
var ASSET_ROUTE_PATH = "/dsh-chime/asset";
var LIST_ROUTE_PATH = "/dsh-chime/list";
var RAISE_ROUTE_PATH = "/dsh-chime/raise";
var RAISE_HEADER = "x-dsh-chime";
var INVALID_RANGE = Symbol("dsh-chime.invalid-range");
var inject = ["webServer"];
function apply(ctx) {
  const setup = () => registerLocalAudioRoutes(ctx);
  if (ctx && typeof ctx.effect === "function") {
    ctx.effect(setup, "dsh-chime: local audio routes");
    return void 0;
  }
  return setup();
}
function registerLocalAudioRoutes(ctx) {
  const webServer = resolveWebServer(ctx);
  if (webServer === null) {
    logWarn(ctx, "[dsh-chime] webServer service is unavailable; local audio routes were not registered");
    return () => {
    };
  }
  const disposers = [];
  const routes = [
    { kind: "prefix", path: ASSET_ROUTE_PATH, handler: handleAssetRequest },
    { kind: "prefix", path: LIST_ROUTE_PATH, handler: handleListRequest },
    { kind: "prefix", path: RAISE_ROUTE_PATH, handler: createRaiseHandler() }
  ];
  for (const route of routes) {
    try {
      const dispose = webServer.register(route);
      if (typeof dispose === "function") disposers.push(dispose);
    } catch (error) {
      logWarn(ctx, `[dsh-chime] failed to register route ${route.path}: ${messageOf(error)}`);
    }
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
      }
    }
  };
}
function resolveWebServer(ctx) {
  try {
    if (!ctx) return null;
    const direct = ctx.webServer;
    if (direct !== void 0 && direct !== null) {
      return typeof direct.register === "function" ? direct : null;
    }
    const fetched = typeof ctx.get === "function" ? ctx.get("webServer") : void 0;
    return fetched && typeof fetched.register === "function" ? fetched : null;
  } catch {
    return null;
  }
}
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
function createRaiseHandler(deps = {}) {
  const execImpl = typeof deps?.execFile === "function" ? deps.execFile : execFile;
  const platform = typeof deps?.platform === "string" ? deps.platform : process.platform;
  return async function handleRaiseRequest(req, res) {
    try {
      if (methodOf(req) !== "POST") {
        sendJson(res, 405, { requested: false, error: "method not allowed; use POST" });
        return;
      }
      if (headerOf(req, RAISE_HEADER) !== "raise") {
        sendJson(res, 403, { requested: false, error: "missing raise credential" });
        return;
      }
      const spec = raiseCommandFor(platform);
      if (spec === null) {
        sendJson(res, 202, { requested: false });
        return;
      }
      const outcome = await runRaise(execImpl, spec);
      sendJson(res, 202, { ...outcome, command: spec.command });
    } catch (error) {
      sendJson(res, 500, { requested: false, error: messageOf(error) });
    }
  };
}
var WINDOWS_RAISE_SCRIPT = `$log = Join-Path $env:TEMP 'dsh-chime-raise.log'
try { Add-Content -Path $log -Value ((Get-Date -Format o) + ' raise') } catch {}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DshChimeRaise {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
}
'@
$script:target = [IntPtr]::Zero
$cb = [DshChimeRaise+EnumProc]{
  param($h, $p)
  $cn = New-Object System.Text.StringBuilder 256
  [void][DshChimeRaise]::GetClassNameW($h, $cn, 256)
  $sb = New-Object System.Text.StringBuilder 512
  [void][DshChimeRaise]::GetWindowTextW($h, $sb, 512)
  if ($cn.ToString() -eq 'Chrome_WidgetWin_1' -and $sb.ToString() -like '*DeepSeek Harness*') {
    $script:target = $h
    return $false
  }
  return $true
}
[void][DshChimeRaise]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:target -ne [IntPtr]::Zero) {
  if (-not [DshChimeRaise]::IsWindowVisible($script:target)) {
    try { Add-Content -Path $log -Value 'skipped-hidden' } catch {}
  } else {
    if ([DshChimeRaise]::IsIconic($script:target)) {
      [void][DshChimeRaise]::PostMessage($script:target, 0x0112, [IntPtr]0xF120, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 300
    }
    [DshChimeRaise]::SwitchToThisWindow($script:target, $true)
    [void][DshChimeRaise]::SetForegroundWindow($script:target)
  }
}`;
function raiseCommandFor(platform) {
  if (platform === "win32") {
    return {
      command: resolvePowerShellPath(),
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        Buffer.from(WINDOWS_RAISE_SCRIPT, "utf16le").toString("base64")
      ]
    };
  }
  if (platform === "darwin") return { command: "open", args: ["dsh://open"] };
  if (platform === "linux") return { command: "xdg-open", args: ["dsh://open"] };
  return null;
}
function resolvePowerShellPath() {
  const roots = [process.env.SystemRoot, process.env.windir, "C:\\Windows"].filter(
    (root) => typeof root === "string" && root.length > 0
  );
  for (const root of roots) {
    const candidate = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
    }
  }
  return "powershell.exe";
}
function runRaise(execImpl, spec) {
  return new Promise((resolve2) => {
    try {
      execImpl(
        spec.command,
        spec.args,
        { windowsHide: true, timeout: 8e3 },
        (error, stdout, stderr) => {
          const output = String(stdout ?? "").trim();
          const diagnostics = String(stderr ?? "").trim();
          resolve2({
            requested: error === null,
            exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : null,
            ...error === null ? {} : { error: messageOf(error) },
            ...output === "" ? {} : { stdout: output.slice(0, 400) },
            ...diagnostics === "" ? {} : { stderr: diagnostics.slice(0, 400) }
          });
        }
      );
    } catch (error) {
      resolve2({ requested: false, exitCode: null, error: messageOf(error) });
    }
  });
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
function queryAbsolutePath(req, name) {
  let raw;
  try {
    const requestUrl = req && typeof req.url === "string" && req.url !== "" ? req.url : "/";
    raw = new URL(requestUrl, "http://localhost").searchParams.get(name);
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
function headerOf(req, name) {
  const headers = req ? req.headers : void 0;
  if (!headers || typeof headers !== "object") return void 0;
  if (headers[name] !== void 0) return headers[name];
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) return headers[key];
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
function logWarn(ctx, message) {
  try {
    const logger = ctx ? ctx.logger : void 0;
    if (logger && typeof logger.warn === "function") {
      logger.warn(message);
      return;
    }
  } catch {
  }
  try {
    console.warn(message);
  } catch {
  }
}
export {
  apply,
  createRaiseHandler,
  inject
};
