/**
 * dsh-chime 客户端资源访问层。
 *
 * 架构（2026-09 重构）：本地音频与目录枚举**全部走 host half 提供的两条同源 HTTP 路由**，
 * 不再依赖任何 host Remote 通道：
 *
 * | 路由 | 返回 |
 * |---|---|
 * | `GET /dsh-chime/asset?path=<绝对路径>` | 音频字节（`Content-Type` 由 host 设置，响应 `no-store`） |
 * | `GET /dsh-chime/list?path=<绝对目录>` | JSON `{ path, entries: [{ name, path, type: 'file'\|'directory' }], truncated }` |
 *
 * 同源请求自动携带页面已有的 session cookie，**不需要任何 token**。
 *
 * 历史背景（实测）：host Remote 通道不可用，`uiWorkspace` 的枚举能力在原生
 * picker 后端上也不可用（该后端只支持 `pick`），因此本地音频与目录枚举统一改走上面的
 * 同源 HTTP 路由。`uiWorkspace.pickDirectory()` 仍然可用，原生目录选择器保持不变。
 *
 * 导出：
 * - {@link isLocalPath}：区分本地绝对路径与 http(s) URL；
 * - {@link toPlayableUrl}：把配置里的音源解析成 `<audio>` / `fetch` 可直接使用的 URL；
 * - {@link createFileBrowser}：`pickDirectory`（原生 picker）+ `listAudioFiles`（同源 list 路由）；
 * - {@link AUDIO_EXTENSIONS}：受支持的音频扩展名白名单。
 *
 * 第三种音源 `'local'`（2026-09 新增）：用户在配置页用**浏览器原生文件选择器**
 * 选的音频，浏览器不给完整路径，字节存在 IndexedDB 里（见 `localAudioStore.js`）。
 * `toPlayableUrl` 对 `'local'` 只做一件事：同步查 objectURL 缓存（
 * `getLocalAudioUrl(kind)`），拿不到就返回 `''`。
 *
 * 设计约定：
 * - 本模块不引入任何新依赖，浏览器与 Node 均可加载（纯 ESM）。
 * - `toPlayableUrl` / `isLocalPath` 是**纯函数，永不抛错**。
 * - 所有 I/O 失败（HTTP 非 2xx、`fetch` 抛错、JSON 解析失败、picker 抛错）都转成
 *   **带上下文的 `Error` 抛出**，绝不静默返回空结果：静默失败在 UI 上就是"点了没反应"。
 *
 * @module dsh-chime/client/assets
 */

import { getLocalAudioUrl } from './localAudioStore.js';

/**
 * 受支持的音频扩展名（小写，含点）。
 *
 * host half 的 `/dsh-chime/list` 路由也维护同一份白名单用于筛选条目
 * （两半各自维护，改动时记得两边同步）。
 *
 * @type {string[]}
 */
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'];

/** 带协议头的 URL（`scheme://…`，如 `https://`、`http://`）。 */
const SCHEME_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Windows 盘符绝对路径（`C:\…` / `C:/…`）。 */
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;

/**
 * 判断字符串是否为本地绝对路径，而非 http(s) URL。
 *
 * 识别以下三类（与 CONTRACT §4.3 一致）：
 * - Windows 盘符路径：`E:\a.mp3`、`E:/a.mp3`
 * - UNC 路径：`\\srv\share\a.mp3`
 * - POSIX 绝对路径：`/a.mp3`（含 `//srv/share/a.mp3`）
 *
 * 显式排除带协议头的 URL，因此 `https://host/a.mp3` **不会**被误判为路径。
 * 相对路径、`~/a.mp3`、裸盘符 `C:`、`file://` 与 `data:` URL 一律返回 `false`
 * （`file:` / `data:` 交由 `<audio>` 直接播放，不走 host 路由）。
 *
 * @param {unknown} src 待判断的来源字符串。
 * @returns {boolean} 是本地绝对路径则为 `true`。
 */
export function isLocalPath(src) {
  if (typeof src !== 'string') return false;
  const value = src.trim();
  if (value === '') return false;
  if (SCHEME_URL_RE.test(value)) return false;
  if (WINDOWS_DRIVE_RE.test(value)) return true;
  if (value.startsWith('\\\\')) return true;
  if (value.startsWith('/')) return true;
  return false;
}

/**
 * 把配置里的音源解析成可直接使用的播放 URL。
 *
 * - `source === 'local'` → **同步查 objectURL 缓存**：
 *   `getLocalAudioUrl(kind) ?? ''`。这种源没有路径，`src` 只是显示用的文件名，
 *   所以看的是 `kind` 而不是 `src`；IndexedDB 不可用 / 还没预热好时返回 `''`
 *   （表示"暂时没有可播放 URL"，播放引擎会给出可读失败原因）。
 * - `source === 'file'` → 同源 host 路由
 *   `/dsh-chime/asset?path=<encodeURIComponent(src)>`；**不再拼 `v` 版本参数**：
 *   host 侧该路由已返回 `Cache-Control: no-store`，本就不需要版本串破缓存，
 *   而且 host 只读 `path`。
 * - 其它（含 `source === 'url'` 与 `source` 缺失/非法）→ **原样返回 `src`**，
 *   由 `<audio>` 直接加载。
 * - `src` 非字符串或去除首尾空白后为空 → `''`（表示"未配置"）；`'local'` 例外，
 *   它只看 `kind`。
 *
 * 纯函数：任何输入都不会抛错（`'local'` 分支也整体包了 try/catch）。
 * `source === 'file'` 时路径会先 `trim()`，因为首尾空白不可能是合法路径的一部分。
 *
 * @param {unknown} src 音源：http(s) URL、本地绝对路径，或 `'local'` 下的显示文件名。
 * @param {unknown} source 来源类型：`'url' | 'file' | 'local'`。
 * @param {unknown} [kind] 音效种类；**仅 `source === 'local'` 时使用**（IndexedDB 键）。
 * @param {string} [routePrefix='/dsh-chime'] 组件自身的音源路由前缀。
 * @returns {string} 可播放 URL；未配置 / 未就绪时为 `''`。
 */
export function toPlayableUrl(src, source, kind, routePrefix = '/dsh-chime') {
  if (source === 'local') {
    try {
      const key = typeof kind === 'string' ? kind.trim() : '';
      if (key === '') return '';
      const url = getLocalAudioUrl(key);
      return typeof url === 'string' ? url : '';
    } catch {
      return '';
    }
  }

  if (typeof src !== 'string') return '';
  const value = src.trim();
  if (value === '') return '';
  if (source !== 'file') return src;

  return `${routePrefix}/asset?path=${encodeURIComponent(value)}`;
}

/**
 * 目录枚举结果。
 *
 * @typedef {object} ChimeBrowseResult
 * @property {Array<{ name: string, path: string, size: number }>} files
 *   音频候选（按名称升序）。同源 list 路由已按 {@link AUDIO_EXTENSIONS} 白名单筛选，
 *   因此这里就是可直接播放的文件；`size` 路由未提供，恒为 `0`。
 * @property {Array<{ name: string, path: string }>} directories
 *   可下钻的子目录（按名称升序）。
 * @property {boolean} enumerable 恒为 `true`：本实现枚举失败会抛错，不会返回"不可枚举"的结果。
 * @property {boolean} truncated `true` 表示 host 的条目上限截断了这一层，`files` 不是完整列表。
 */

/**
 * 构造目录浏览数据源，供配置页的文件选择器使用。
 *
 * - `pickDirectory()` → client Service `uiWorkspace`（`ctx.get('uiWorkspace')`），
 *   打开 host 原生目录选择器，`null` 表示用户取消；
 * - `listAudioFiles()` → 同源 `GET /dsh-chime/list?path=…`，按 host 给出的 `type` 分堆。
 *
 * **失败一律抛错，绝不静默返回 `null` / 空结果**：静默失败在 UI 上就是"点了没反应"。
 *
 * @param {object} ctx Client 根 Context。
 * @param {{routePrefix?: string}} [options] 组件自身的资源路由；默认保留通知路由。
 * @returns {{
 *   pickDirectory: (signal?: AbortSignal) => Promise<string|null>,
 *   listAudioFiles: (path: string, signal?: AbortSignal) => Promise<ChimeBrowseResult>,
 * }} 浏览器。
 */
export function createFileBrowser(ctx, { routePrefix = '/dsh-chime' } = {}) {
  return {
    /**
     * 打开 host 原生目录选择器。
     *
     * @param {AbortSignal} [_signal] 仅为兼容调用方签名而保留；`uiWorkspace.pickDirectory()`
     *   不接受 `signal`，此参数被忽略。
     * @returns {Promise<string|null>} 选中的绝对路径；**仅当用户取消时为 `null`**。
     * @throws {Error} `uiWorkspace` 不可用、调用抛异常，或返回值既不是 `null` 也不是合法路径时抛出。
     */
    async pickDirectory(_signal) {
      const workspace = uiWorkspaceService(ctx);
      if (!workspace || typeof workspace.pickDirectory !== 'function') {
        throw new Error('打开目录选择器失败：当前环境没有可用的 uiWorkspace 服务');
      }

      let picked;
      try {
        picked = await workspace.pickDirectory();
      } catch (error) {
        throw assetError(`打开目录选择器失败：${messageOf(error)}`, error);
      }

      if (picked === null) return null; // 只有 null 代表用户取消。
      if (typeof picked !== 'string' || picked.trim() === '') {
        throw new Error('打开目录选择器失败：uiWorkspace.pickDirectory() 返回了非法路径');
      }
      return picked;
    },

    /**
     * 列出目录下的音频文件与子目录。
     *
     * 走同源 `GET /dsh-chime/list?path=<encodeURIComponent(dir)>`：host 直接给出每个条目的
     * `type`，因此**不再按扩展名猜测**（白名单筛选由 host 路由负责）。
     *
     * @param {string} path 目录绝对路径（通常来自 `pickDirectory`）。
     * @param {AbortSignal} [signal] 调用方取消信号；传入时透传给 `fetch`。
     * @returns {Promise<ChimeBrowseResult>} 枚举结果；`enumerable` 恒为 `true`。
     * @throws {Error} 路径为空、`fetch` 不可用、HTTP 非 2xx（message 含状态码、状态文本与
     *   host 的 `{ error }` 说明）、`fetch` 抛错、
     *   JSON 解析失败或响应体缺少 `entries` 时抛出（底层原因挂在 `cause` 上）。
     */
    async listAudioFiles(path, signal) {
      const dir = typeof path === 'string' ? path.trim() : '';
      if (dir === '') {
        throw new Error('列出目录失败：目录路径为空');
      }
      if (typeof fetch !== 'function') {
        throw new Error('列出目录失败：当前环境不支持 fetch');
      }

      const url = `${routePrefix}/list?path=${encodeURIComponent(dir)}`;
      const init = signal === undefined || signal === null ? {} : { signal };

      let response;
      try {
        response = await fetch(url, init);
      } catch (error) {
        throw assetError(`列出目录失败：${dir}（${messageOf(error)}）`, error);
      }

      if (!httpOk(response)) {
        throw new Error(`列出目录失败：${dir}（${await httpFailureDetail(response)}）`);
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw assetError(`列出目录失败：${dir}（响应不是合法 JSON：${messageOf(error)}）`, error);
      }

      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entries)) {
        throw new Error(`列出目录失败：${dir}（host 未返回目录条目）`);
      }

      const files = [];
      const directories = [];
      for (const entry of payload.entries) {
        if (!entry || typeof entry !== 'object') continue;
        const name = entryName(entry);
        if (name === '') continue;
        const target = entryPath(entry, dir, name);
        // `type` 由 host 给出；既不是 file 也不是 directory 的条目无法归类，直接忽略
        // （不猜扩展名，也不把未知条目伪装成目录）。
        if (entry.type === 'file') files.push({ name, path: target, size: 0 });
        else if (entry.type === 'directory') directories.push({ name, path: target });
      }
      return browseResult(files, directories, true, payload.truncated === true);
    },
  };
}

/**
 * 取 client Service `uiWorkspace`（原生目录选择器的唯一入口）。
 *
 * @param {object} ctx Client 根 Context。
 * @returns {object|null} 服务实例；不可用时为 `null`。
 */
function uiWorkspaceService(ctx) {
  try {
    if (!ctx || typeof ctx.get !== 'function') return null;
    const service = ctx.get('uiWorkspace');
    return service && typeof service === 'object' ? service : null;
  } catch {
    return null;
  }
}

/**
 * 判断 HTTP 响应是否成功。
 *
 * 优先信 `response.ok`，其次看数值状态码，这样即使某一侧缺失也能正确判定
 * （测试桩与真实 `Response` 都适用）。
 *
 * @param {unknown} response `fetch` 的响应。
 * @returns {boolean} 2xx 则为 `true`。
 */
function httpOk(response) {
  if (response && response.ok === true) return true;
  const status = response && typeof response.status === 'number' ? response.status : NaN;
  return Number.isFinite(status) && status >= 200 && status < 300;
}

/**
 * 把失败响应转成可读原因（状态码 + 状态文本 + host 给的错误说明）。
 *
 * `/dsh-chime/list` 的非 2xx 响应体是 JSON `{ error }`（见 assets-bridge 的 host 契约），
 * 把它拼进 message 才能让 UI 显示"目录不存在"而不是干巴巴的 `HTTP 404`。
 * 响应体不是 JSON / 没有 `error` 时静默退回状态码，绝不因为"读错误信息失败"而掩盖 HTTP 错误。
 *
 * @param {unknown} response `fetch` 的响应。
 * @returns {Promise<string>} 例如 `HTTP 404 Not Found: 目录不存在`。
 */
async function httpFailureDetail(response) {
  const base = httpDetail(response);
  const message = await errorBodyMessage(response);
  return message === '' ? base : `${base}: ${message}`;
}

/**
 * 从失败响应体里取 host 的错误说明。
 *
 * @param {unknown} response `fetch` 的响应。
 * @returns {Promise<string>} 错误说明；取不到时为 `''`。
 */
async function errorBodyMessage(response) {
  try {
    if (!response || typeof response.json !== 'function') return '';
    const payload = await response.json();
    if (payload && typeof payload === 'object' && typeof payload.error === 'string') {
      return payload.error.trim();
    }
  } catch {
    /* 错误体不是 JSON：只保留 HTTP 状态信息。 */
  }
  return '';
}

/**
 * 把失败响应转成可读原因（仅状态码 + 状态文本）。
 *
 * @param {unknown} response `fetch` 的响应。
 * @returns {string} 例如 `HTTP 404 Not Found`；没有状态码时为说明文本。
 */
function httpDetail(response) {
  const status = response && typeof response.status === 'number' ? response.status : undefined;
  if (status === undefined) return '响应无效（没有 HTTP 状态码）';
  const text = response && typeof response.statusText === 'string' ? response.statusText.trim() : '';
  return text === '' ? `HTTP ${status}` : `HTTP ${status} ${text}`;
}

/**
 * 组装并排序枚举结果。
 *
 * @param {Array<{ name: string, path: string, size: number }>} files 音频候选。
 * @param {Array<{ name: string, path: string }>} directories 子目录。
 * @param {boolean} enumerable 恒为 `true`（枚举失败在上游已抛错）。
 * @param {boolean} [truncated] 枚举是否被 host 的条目上限截断。
 * @returns {ChimeBrowseResult} 结果对象（新数组，可直接交给 UI）。
 */
function browseResult(files, directories, enumerable, truncated = false) {
  files.sort(compareByName);
  directories.sort(compareByName);
  return {
    files,
    directories,
    enumerable: enumerable === true,
    truncated: truncated === true,
  };
}

/**
 * 取条目名：优先 `name`，否则从 `path` 取 basename。
 *
 * @param {unknown} entry 目录条目（`{ name, path, type }`）。
 * @returns {string} 条目名；无法确定时为 `''`。
 */
function entryName(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (typeof entry.name === 'string' && entry.name !== '') return entry.name;
  return typeof entry.path === 'string' ? baseName(entry.path) : '';
}

/**
 * 取条目路径：优先 host 给的 `path`，否则按目录分隔符拼接。
 *
 * @param {unknown} entry 目录条目。
 * @param {string} dir 当前目录。
 * @param {string} name 条目名。
 * @returns {string} 条目绝对路径。
 */
function entryPath(entry, dir, name) {
  if (entry && typeof entry.path === 'string' && entry.path !== '') return entry.path;
  return joinPath(dir, name);
}

/**
 * 取路径最后一段（同时接受 `/` 与 `\`）。
 *
 * @param {string} path 路径。
 * @returns {string} basename。
 */
function baseName(path) {
  const value = String(path);
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return index >= 0 ? value.slice(index + 1) : value;
}

/**
 * 用与目录一致的分隔符拼接子项路径。
 *
 * @param {string} dir 目录绝对路径。
 * @param {string} name 子项名。
 * @returns {string} 拼接后的路径。
 */
function joinPath(dir, name) {
  const separator = dir.includes('\\') ? '\\' : '/';
  const base = dir.endsWith('/') || dir.endsWith('\\') ? dir.slice(0, -1) : dir;
  return `${base}${separator}${name}`;
}

/**
 * 按名称升序比较（确定性、不依赖 locale）。
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
 * 构造带 `cause` 的错误（旧环境不支持第二个参数时退化为普通 Error）。
 *
 * @param {string} message 错误信息。
 * @param {unknown} cause 原始原因。
 * @returns {Error} 错误对象。
 */
function assetError(message, cause) {
  try {
    return new Error(message, { cause });
  } catch {
    const error = new Error(message);
    try {
      error.cause = cause;
    } catch {
      /* 只读 cause：忽略。 */
    }
    return error;
  }
}

/**
 * 把任意抛出物转成可读文本。
 *
 * @param {unknown} error 抛出物。
 * @returns {string} 可读信息。
 */
function messageOf(error) {
  if (error instanceof Error) return error.message || error.name || '未知错误';
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const code = typeof error.code === 'string' ? error.code : '';
    const message = typeof error.message === 'string' ? error.message : '';
    if (code && message) return `${code}: ${message}`;
    if (message) return message;
    if (code) return code;
  }
  try {
    return String(error);
  } catch {
    return '未知错误';
  }
}
