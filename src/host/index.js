/**
 * dsh-chime host half：把本地音频文件暴露成**同源 HTTP 资源**。
 *
 * 为什么需要 host half：实际环境里两条 client Remote 通道都不可用
 * （`uiWorkspace.listDirectory` → `directory-picker/unavailable`，
 * `ctx.remote.workspaceFiles` 在旧 web profile 上未挂载）。而 `dsh-host-webserver`
 * 的命名路由 `handler` 是**直接调用、不经过鉴权拦截**的
 * （证据 `.probe/host-webserver.js:229-236`），页面又已持有 session cookie，
 * 于是浏览器可以像普通 `<audio src>` 一样直接拉取本地音频。
 *
 * 三条路由：
 * - `GET /dsh-chime/asset?path=<绝对路径>&v=<版本>` → 音频字节
 *   （正确 Content-Type、`Cache-Control: no-store`、支持单段 Range → 206）
 * - `GET /dsh-chime/list?path=<绝对目录>` → `{ path, entries, truncated }`
 * - `POST /dsh-chime/raise` → 实验性：让 Desktop 外壳把窗口带到前台（CONTRACT §4.8）
 *
 * 安全边界（刻意为之，与本任务契约一致）：**不做 workspace/根目录约束**，
 * 只要求绝对路径；asset 额外要求扩展名在音频白名单内。理由是这个服务只监听
 * loopback（`webServer` 的 `host` 是 `127.0.0.1`），且 DSH 本来就是单用户环境，
 * 加根目录围栏只会挡住用户自己的音乐目录。两个 handler 都**绝不抛异常**：
 * 一切失败都落到明确的 HTTP 状态码 + 可读文本/JSON，并由 `dsh-host-webserver`
 * 的外层兜底（该外层在异常时只回 400，所以我们必须自己处理干净）。
 *
 * @module dsh-chime/host
 */

import { execFile } from 'node:child_process';
import { buildWindowsRaiseScript } from './windows-raise.js';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';

/** 音频扩展名 → `Content-Type`。 */
const AUDIO_CONTENT_TYPES = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
});

/** 一次 `list` 返回的条目上限；超出时截断并置 `truncated: true`。 */
const MAX_LIST_ENTRIES = 2000;

/** 音频字节路由（prefix）。 */
const ASSET_ROUTE_PATH = '/dsh-chime/asset';

/** 目录列表路由（prefix）。 */
const LIST_ROUTE_PATH = '/dsh-chime/list';

/** 实验性「把桌面窗口带到前台」路由（prefix，CONTRACT §4.7）。 */
const RAISE_ROUTE_PATH = '/dsh-chime/raise';

/** 防跨站凭据头：跨站请求带自定义头会触发预检，预检不通过时浏览器不会真正发出请求。 */
const RAISE_HEADER = 'x-dsh-chime';

/** `parseRangeHeader` 的三态返回值之一：语法合法但不可满足（→ 416）。 */
const INVALID_RANGE = Symbol('dsh-chime.invalid-range');

/** 需要 `webServer` 服务才能注册路由。 */
export const inject = ['webServer'];

/**
 * 插件入口：注册本地音频路由与一条实验性窗口唤起路由。
 *
 * @param {object} ctx Host 根 Context（含 `webServer` 服务）。
 * @returns {(() => void)|undefined} 没有 `ctx.effect` 时直接返回 disposer。
 */
export function apply(ctx) {
  const setup = () => registerLocalAudioRoutes(ctx);
  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(setup, 'dsh-chime: local audio routes');
    return undefined;
  }
  return setup();
}

/**
 * 注册三条路由（音频字节、目录列表、实验性窗口唤起）；服务缺失或注册失败时
 * 降级为「不注册」，绝不让插件激活失败。
 *
 * @param {object} ctx Host 根 Context。
 * @returns {() => void} 释放已注册路由的 disposer。
 */
function registerLocalAudioRoutes(ctx) {
  const webServer = resolveWebServer(ctx);
  if (webServer === null) {
    logWarn(ctx, '[dsh-chime] webServer service is unavailable; local audio routes were not registered');
    return () => {};
  }

  const disposers = [];
  const routes = [
    { kind: 'prefix', path: ASSET_ROUTE_PATH, handler: handleAssetRequest },
    { kind: 'prefix', path: LIST_ROUTE_PATH, handler: handleListRequest },
    { kind: 'prefix', path: RAISE_ROUTE_PATH, handler: createRaiseHandler() },
  ];
  for (const route of routes) {
    try {
      const dispose = webServer.register(route);
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      logWarn(ctx, `[dsh-chime] failed to register route ${route.path}: ${messageOf(error)}`);
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* 重复释放：忽略。 */
      }
    }
  };
}

/**
 * 取 `webServer` 服务（优先 `ctx.webServer`，退回 `ctx.get('webServer')`）。
 *
 * @param {object} ctx Host 根 Context。
 * @returns {{ register: (route: object) => (() => void) }|null} 服务；不可用时为 `null`。
 */
function resolveWebServer(ctx) {
  try {
    if (!ctx) return null;
    const direct = ctx.webServer;
    if (direct !== undefined && direct !== null) {
      return typeof direct.register === 'function' ? direct : null;
    }
    const fetched = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
    return fetched && typeof fetched.register === 'function' ? fetched : null;
  } catch {
    return null;
  }
}

/**
 * `/dsh-chime/asset` 的最外层容错壳。
 *
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @returns {Promise<void>} 永远 resolve。
 */
export async function handleAssetRequest(req, res) {
  try {
    await serveAsset(req, res);
  } catch (error) {
    sendText(res, 500, `dsh-chime asset route failed: ${messageOf(error)}`);
  }
}

/**
 * `/dsh-chime/list` 的最外层容错壳。
 *
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @returns {Promise<void>} 永远 resolve。
 */
export async function handleListRequest(req, res) {
  try {
    await serveList(req, res);
  } catch (error) {
    sendJson(res, 500, { error: `dsh-chime list route failed: ${messageOf(error)}` });
  }
}

/**
 * 建 `/dsh-chime/raise` 的请求处理器（实验性，CONTRACT §4.8）。
 *
 * 页面 focus 不能保证原生窗口激活，因此由宿主请求 Desktop 恢复/显示/聚焦，
 * Windows 额外核对前台 HWND；macOS / Linux 使用 dsh://open。
 * 并发点击共享一个短命辅助进程，不阻塞通知关闭。
 *
 * 两道限制：只接受 `POST`；必须带 `x-dsh-chime: raise` 头。跨站请求带自定义头会
 * 触发 CORS 预检，预检不通过时浏览器不会把真正的请求发出来 —— 避免任意网页把
 * DSH 窗口弹到前台。路由本身也只在 loopback 上监听。
 *
 * @param {{ execFile?: Function, platform?: string, desktopPid?: number }} [deps] 依赖（测试注入；默认用真实进程与平台）。
 * @returns {(req: object, res: object) => void} 路由处理器。
 */
export function createRaiseHandler(deps = {}) {
  const execImpl = typeof deps?.execFile === 'function' ? deps.execFile : execFile;
  const platform = typeof deps?.platform === 'string' ? deps.platform : process.platform;
  const desktopPid = deps.desktopPid === undefined ? process.ppid : deps.desktopPid;
  let inFlight = null;

  return async function handleRaiseRequest(req, res) {
    try {
      if (methodOf(req) !== 'POST') {
        sendJson(res, 405, { requested: false, error: 'method not allowed; use POST' });
        return;
      }
      if (headerOf(req, RAISE_HEADER) !== 'raise') {
        sendJson(res, 403, { requested: false, error: 'missing raise credential' });
        return;
      }
      const spec = raiseCommandFor(platform, desktopPid);
      if (spec === null) {
        sendJson(res, 202, { requested: false });
        return;
      }
      // Coalesce simultaneous notification clicks; never interleave foreground helpers.
      const pending = inFlight ??= runRaise(execImpl, spec);
      try {
        const outcome = await pending;
        sendJson(res, 202, { ...outcome, command: spec.command });
      } finally {
        if (inFlight === pending) inFlight = null;
      }
    } catch (error) {
      sendJson(res, 500, { requested: false, error: messageOf(error) });
    }
  };
}

/** Windows restores hidden windows through Desktop, then verifies the actual foreground HWND. */

/**
 * 取某平台的「唤起窗口」命令；未知平台返回 null（静默降级）。
 *
 * @param {string} platform 平台名。
 * @returns {{ command: string, args: string[] }|null} 启动命令。
 */
function raiseCommandFor(platform, desktopPid) {
  if (platform === 'win32') {
    return {
      command: resolvePowerShellPath(),
      verifyActivation: true,
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        Buffer.from(buildWindowsRaiseScript(desktopPid), 'utf16le').toString('base64'),
      ],
    };
  }
  // macOS：open 会触发 app 的 open-url，DSH 主进程里已接到 focusPrimaryWindow；
  // Linux：xdg-open 交给桌面环境，通常没有 Windows 那种前台锁。
  if (platform === 'darwin') return { command: 'open', args: ['dsh://open'] };
  if (platform === 'linux') return { command: 'xdg-open', args: ['dsh://open'] };
  return null;
}

/**
 * 解析 PowerShell 的绝对路径。
 *
 * 宿主进程的 PATH 未必包含 System32（实测 spawn('powershell.exe') 静默失败、
 * 子进程根本没出现），所以优先用绝对路径，最后才回落到裸名字。
 *
 * @returns {string} 可执行文件路径。
 */
function resolvePowerShellPath() {
  const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows'].filter(
    (root) => typeof root === 'string' && root.length > 0,
  );
  for (const root of roots) {
    const candidate = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // 读不到就试下一个候选。
    }
  }
  return 'powershell.exe';
}

/**
 * 执行唤起命令并等待它结束（`execFile`，不经 shell、参数不拼字符串）。
 *
 * 用等待而不是 detached spawn：DSH 的进程沙箱会静默清理 detached 子进程，
 * 之前「请求 202、窗口不动、连进程都看不到」就是这么来的。等到进程真正结束，
 * 响应才能带上退出码与 stderr —— 失败可诊断，成功也说明脚本确实跑完了。
 *
 * @param {Function} execImpl `execFile`（测试注入）。
 * @param {{ command: string, args: string[] }} spec 启动命令。
 * @returns {Promise<{ requested: boolean, exitCode: number|null, error?: string, stdout?: string, stderr?: string }>} 执行结果。
 */
function runRaise(execImpl, spec) {
  return new Promise((resolve) => {
    try {
      execImpl(
        spec.command,
        spec.args,
        { windowsHide: true, timeout: 8000 },
        (error, stdout, stderr) => {
          const output = String(stdout ?? '').trim();
          const diagnostics = String(stderr ?? '').trim();
          resolve({
            requested: error === null,
            ...(spec.verifyActivation ? error === null
              ? parseActivationResult(output)
              : { activated: false, reason: 'helper-failed' } : {}),
            exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
            ...(error === null ? {} : { error: messageOf(error) }),
            ...(output === '' ? {} : { stdout: output.slice(0, 400) }),
            ...(diagnostics === '' ? {} : { stderr: diagnostics.slice(0, 400) }),
          });
        },
      );
    } catch (error) {
      resolve({ requested: false, exitCode: null, error: messageOf(error),
        ...(spec.verifyActivation ? { activated: false, reason: 'helper-failed' } : {}),
      });
    }
  });
}

/** A successful helper exit is not proof of foreground activation. */
function parseActivationResult(output) {
  try {
    const result = JSON.parse(output);
    const reasons = ['activated', 'already-foreground', 'foreground-denied', 'hidden',
      'not-found', 'restore-pending', 'interrupted', 'ambiguous', 'protocol-error', 'helper-error'];
    if (!result || typeof result.activated !== 'boolean' || !reasons.includes(result.reason)
      || !Number.isInteger(result.attempts) || result.attempts < 0 || result.attempts > 4
      || !['normal', 'minimized', 'hidden', 'unknown'].includes(result.initialState)
      || typeof result.protocolRequested !== 'boolean'
      || (result.restoreCycle !== undefined && typeof result.restoreCycle !== 'boolean')
      || (result.activated && result.initialState === 'unknown')
      || result.activated !== ['activated', 'already-foreground'].includes(result.reason)) {
      throw new Error('invalid activation result');
    }
    return { activated: result.activated, reason: result.reason, attempts: result.attempts,
      initialState: result.initialState, protocolRequested: result.protocolRequested,
      ...(typeof result.restoreCycle === 'boolean' ? { restoreCycle: result.restoreCycle } : {}),
      ...(Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0 ? { elapsedMs: result.elapsedMs } : {}),
    };
  } catch {
    return { activated: false, reason: 'invalid-result' };
  }
}

/**
 * 提供音频字节。
 *
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @returns {Promise<void>} 无返回值。
 */
async function serveAsset(req, res) {
  const method = methodOf(req);
  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, 405, 'method not allowed; use GET');
    return;
  }

  const target = queryAbsolutePath(req, 'path');
  if (target === null) {
    sendText(res, 400, 'query parameter "path" must be a non-empty absolute file path');
    return;
  }

  const extension = extname(target).toLowerCase();
  const contentType = AUDIO_CONTENT_TYPES[extension];
  if (contentType === undefined) {
    sendText(res, 400, `unsupported audio extension: ${extension === '' ? '(none)' : extension}`);
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
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
  };

  if (method === 'HEAD') {
    res.writeHead(200, { ...entityHeaders, 'Content-Length': String(size) });
    res.end();
    return;
  }

  const range = parseRangeHeader(headerOf(req, 'range'), size);
  if (range === INVALID_RANGE) {
    res.writeHead(416, {
      ...entityHeaders,
      'Content-Range': `bytes */${size}`,
      'Content-Length': '0',
    });
    res.end();
    return;
  }
  if (range === null) {
    res.writeHead(200, { ...entityHeaders, 'Content-Length': String(size) });
    res.end(data);
    return;
  }

  const chunk = data.subarray(range.start, range.end + 1);
  res.writeHead(206, {
    ...entityHeaders,
    'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    'Content-Length': String(chunk.length),
  });
  res.end(chunk);
}

/**
 * 列出一层目录：目录全部返回，文件只返回音频白名单内的。
 *
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @returns {Promise<void>} 无返回值。
 */
async function serveList(req, res) {
  const method = methodOf(req);
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'method not allowed; use GET' });
    return;
  }

  const requested = queryAbsolutePath(req, 'path');
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
      error: `cannot list directory: ${dir} (${messageOf(error)})`,
    });
    return;
  }

  const directories = [];
  const files = [];
  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      directories.push({ name: dirent.name, path: join(dir, dirent.name), type: 'directory' });
      continue;
    }
    // 只认普通文件；symlink / socket / FIFO 一律跳过（避免越界或阻塞）。
    if (!dirent.isFile()) continue;
    const extension = extname(dirent.name).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(AUDIO_CONTENT_TYPES, extension)) continue;
    files.push({ name: dirent.name, path: join(dir, dirent.name), type: 'file' });
  }
  directories.sort(compareByName);
  files.sort(compareByName);

  const all = directories.concat(files);
  const truncated = all.length > MAX_LIST_ENTRIES;
  sendJson(res, 200, {
    path: dir,
    entries: truncated ? all.slice(0, MAX_LIST_ENTRIES) : all,
    truncated,
  });
}

/**
 * 解析 `Range` 头（只支持单段 `bytes=`）。
 *
 * @param {unknown} header `Range` 头原值。
 * @param {number} size 文件字节数。
 * @returns {{ start: number, end: number }|null|typeof INVALID_RANGE} 命中区间、`null`（按整文件处理）
 *   或 {@link INVALID_RANGE}（→ 416）。
 */
function parseRangeHeader(header, size) {
  if (typeof header !== 'string') return null;
  const value = header.trim();
  if (value === '') return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  // 多段区间或未知单位：不猜，整文件 200。
  if (match === null) return null;

  const rawStart = match[1];
  const rawEnd = match[2];
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    // 后缀区间：`bytes=-N` → 最后 N 字节。
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return INVALID_RANGE;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return INVALID_RANGE;
  if (size === 0 || start >= size || end < 0 || start > end) return INVALID_RANGE;
  return { start, end };
}

/**
 * 解析必填的绝对路径 query 参数（拒绝空串、NUL、相对路径）。
 *
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {string} name 参数名。
 * @returns {string|null} 绝对路径；非法时为 `null`。
 */
function queryAbsolutePath(req, name) {
  let raw;
  try {
    const requestUrl = req && typeof req.url === 'string' && req.url !== '' ? req.url : '/';
    raw = new URL(requestUrl, 'http://localhost').searchParams.get(name);
  } catch {
    return null;
  }
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.includes('\0')) return null;
  return isAbsolute(trimmed) ? trimmed : null;
}

/**
 * 取请求方法（缺省按 `GET` 处理）。
 *
 * @param {import('node:http').IncomingMessage} req 请求。
 * @returns {string} 大写方法名。
 */
function methodOf(req) {
  return req && typeof req.method === 'string' ? req.method.toUpperCase() : 'GET';
}

/**
 * 读一个请求头（大小写不敏感）。
 *
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {string} name 头名（小写）。
 * @returns {unknown} 头值。
 */
function headerOf(req, name) {
  const headers = req ? req.headers : undefined;
  if (!headers || typeof headers !== 'object') return undefined;
  if (headers[name] !== undefined) return headers[name];
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) return headers[key];
  }
  return undefined;
}

/**
 * 文件读取失败的 HTTP 状态码。
 *
 * @param {unknown} error 抛出物。
 * @returns {number} 状态码。
 */
function statusForFileError(error) {
  const code = errorCodeOf(error);
  if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return 404;
  if (code === 'EACCES' || code === 'EPERM') return 403;
  return 500;
}

/**
 * 目录列举失败的 HTTP 状态码。
 *
 * @param {unknown} error 抛出物。
 * @returns {number} 状态码。
 */
function statusForDirectoryError(error) {
  const code = errorCodeOf(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') return 404;
  if (code === 'EACCES' || code === 'EPERM') return 403;
  return 500;
}

/**
 * 取 Node 错误码。
 *
 * @param {unknown} error 抛出物。
 * @returns {string} 错误码；没有则为 `''`。
 */
function errorCodeOf(error) {
  return error && typeof error === 'object' && typeof error.code === 'string' ? error.code : '';
}

/**
 * 写纯文本响应。
 *
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {number} status 状态码。
 * @param {string} message 文本。
 */
function sendText(res, status, message) {
  sendBody(res, status, 'text/plain; charset=utf-8', Buffer.from(`${message}\n`, 'utf8'));
}

/**
 * 写 JSON 响应。
 *
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {number} status 状态码。
 * @param {unknown} value JSON 可序列化值。
 */
function sendJson(res, status, value) {
  sendBody(res, status, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(value), 'utf8'));
}

/**
 * 写响应体，任何 socket 级异常都被吞掉（连接可能已被浏览器取消）。
 *
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {number} status 状态码。
 * @param {string} contentType `Content-Type`。
 * @param {Buffer} body 响应体。
 */
function sendBody(res, status, contentType, body) {
  try {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    try {
      res.end();
    } catch {
      /* socket 已关闭：忽略。 */
    }
  }
}

/**
 * 按名称字典序比较（确定性、不依赖 locale）。
 *
 * @param {{ name: string }} a 左项。
 * @param {{ name: string }} b 右项。
 * @returns {number} 比较结果。
 */
function compareByName(a, b) {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

/**
 * 取可读错误文本。
 *
 * @param {unknown} error 抛出物。
 * @returns {string} 可读信息。
 */
function messageOf(error) {
  if (error instanceof Error) return error.message || error.name || 'unknown error';
  if (typeof error === 'string') return error;
  try {
    return String(error);
  } catch {
    return 'unknown error';
  }
}

/**
 * 警告日志（`ctx.logger` 不可用时退回 `console.warn`）。
 *
 * @param {object} ctx Host 根 Context。
 * @param {string} message 日志内容。
 */
function logWarn(ctx, message) {
  try {
    const logger = ctx ? ctx.logger : undefined;
    if (logger && typeof logger.warn === 'function') {
      logger.warn(message);
      return;
    }
  } catch {
    /* 忽略 logger 异常。 */
  }
  try {
    console.warn(message);
  } catch {
    /* 忽略。 */
  }
}
