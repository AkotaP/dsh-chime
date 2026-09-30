/**
 * dsh-chime 播放引擎：**Web Audio 主路径 + HTMLAudioElement 回退**。
 *
 * 为什么是 Web Audio（task-7 的核心结论）：
 * `HTMLAudioElement.play()` 受浏览器 autoplay 策略约束，而提示音的主要场景是
 * **自动触发**（对话完成 / 审批 / 中断）——那一刻没有任何用户手势，`play()` 必然被
 * `NotAllowedError` 拒绝。`AudioBufferSourceNode.start()` 只要 `AudioContext` 已经
 * running，就不再需要手势，所以自动播放链路必须走 Web Audio。
 *
 * 音源如何变成可播放 URL（task-11）：`ctx.remote.workspaceFiles` 在旧版 web profile 不可用，
 * 因此不再由 client 读取字节，而是由 **host half 的同源 HTTP 路由** 暴露本地文件
 * （`/dsh-chime/asset?path=...&v=...`）。引擎只依赖注入的同步纯函数
 * `deps.resolveSource(src, source, kind) → url`，`file` / `url` / `local` 三种来源**此后走完全相同的路径**
 * （`fetch` → `decodeAudioData` → `BufferSource`；失败回退 `HTMLAudioElement`）。
 *
 * 对外契约（`CONTRACT.md` §4.2）保持兼容：`prepare / play / setVolume / preview / dispose`，
 * 另外新增 `unlock()` 与 `lastFailure(kind)`。
 *
 * 行为约定：
 * - `src` 为空（含纯空白 / 非字符串）→ 不发声、不构造任何音频对象、**不创建 AudioContext**。
 * - `play()` 永远静默：返回 `boolean`，失败原因放进 `lastFailure(kind)`。
 * - `preview()` 失败时抛 `Error`（带 `code`），供设置页显示可读原因。
 * - 没有 `AudioContext` → 回退 `HTMLAudioElement`；两者都没有 → 安静返回 false / 抛明确错误。
 *
 * 本模块不 import 任何业务模块（`assets.js` 只通过 deps 注入），可单独测试。
 *
 * @module dsh-chime/audio
 */

/** 未知音量时的兜底值，与 config.js 的 `DEFAULT_CHIME.volume` 保持一致。 */
const DEFAULT_VOLUME = 0.8;

/** `resume()` 的最长等待预算（毫秒）：避免无手势时 `play()` 永久挂起。 */
const RESUME_BUDGET_MS = 200;

/**
 * `local` 源在 IndexedDB 里没有对应文件时的可读原因。
 * `local` 源没有路径，只能按 kind 取 objectURL，解析出空串就是"没存过文件"。
 */
const LOCAL_AUDIO_MISSING = '未找到该音效的本地音频，请重新选择文件';

/**
 * 失败代码（挂在抛出的 Error 上，便于 UI / 日志分支）。
 * @type {Readonly<Record<string, string>>}
 */
export const AUDIO_FAILURES = Object.freeze({
  /** `decodeAudioData` 失败（文件损坏或格式不受支持）。 */
  DECODE_FAILED: 'DECODE_FAILED',
  /** 资源返回 HTTP 非 2xx（含 host 的 `/dsh-chime/asset` 路由报错）；Error 上带 `status`。 */
  ASSET_HTTP_ERROR: 'ASSET_HTTP_ERROR',
  /** 网络层失败：fetch 抛错（断网 / CORS 未开启）或响应不可读。 */
  FETCH_FAILED: 'FETCH_FAILED',
  /** `deps.resolveSource` 没能给出可播放 URL（防御性分支，契约保证不会发生）。 */
  RESOLVE_FAILED: 'RESOLVE_FAILED',
  /** 回退到 `HTMLAudioElement` 后仍被 autoplay 策略拒绝。 */
  AUTOPLAY_BLOCKED: 'AUTOPLAY_BLOCKED',
  /** 音源格式不受支持或无法解码（含元素路径的 NotSupportedError）。 */
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  /** 环境里既没有 AudioContext 也没有 Audio。 */
  NO_BACKEND: 'NO_BACKEND',
  /** 引擎已 `dispose()`。 */
  DISPOSED: 'DISPOSED',
  /** 其他未归类失败。 */
  UNKNOWN: 'UNKNOWN',
});

/** 面向用户的失败文案（中文，设置页直接展示）。 */
const FAILURE_MESSAGES = {
  DECODE_FAILED: '音频解码失败（文件可能损坏或格式不受支持）',
  ASSET_HTTP_ERROR: '音频资源请求失败',
  FETCH_FAILED: '拉取音频失败（网络错误或目标站未开启 CORS）',
  RESOLVE_FAILED: '无法把音源解析为可播放 URL',
  AUTOPLAY_BLOCKED: '浏览器拦截了自动播放，请先点击一次页面（或在设置页点一次「试听」）来解锁音频',
  UNSUPPORTED_FORMAT: '音源格式不受支持或无法解码',
  NO_BACKEND: '当前环境不支持音频播放（缺少 AudioContext 与 Audio）',
  DISPOSED: '音频引擎已释放',
  UNKNOWN: '播放失败',
};

/**
 * 音效种类（与 config.js 的 `CHIME_KINDS` 一致）。
 * @typedef {'approval' | 'question' | 'interrupted' | 'completed'} ChimeKind
 */

/**
 * 音效来源类型。
 * @typedef {'url' | 'file' | 'local'} ChimeSource
 */

/**
 * 播放引擎依赖（全部可缺省；缺省时 `src` 被原样当作 URL）。
 * @typedef {object} AudioEngineDeps
 * @property {(src: string, source?: ChimeSource, kind?: ChimeKind) => string} [resolveSource]
 *   同步纯函数：把配置里的音源换成**可播放 URL**（`file` → host 的同源
 *   `/dsh-chime/asset?path=...&v=...`；`url` → 原样；`local` → 按 `kind` 从
 *   IndexedDB 取 objectURL，取不到时返回空串）。由 `assets.js` 的
 *   `toPlayableUrl` 注入。
 */

/**
 * 播放参数。
 * @typedef {object} PlayOptions
 * @property {string} [src] 音频 URL、本地绝对路径，或 `local` 源的显示文件名；空字符串表示未配置。
 * @property {ChimeSource} [source] `'url' | 'file' | 'local'`。
 * @property {number} [volume] 0..1，越界钳制。
 */

/**
 * 单个 kind 的运行时状态。
 * @typedef {object} KindState
 * @property {AudioBufferSourceNode|null} sourceNode 正在播放的 BufferSource。
 * @property {GainNode|null} gain 当前播放对应的增益节点（`setVolume` 实时改它）。
 * @property {Audio|null} audio 回退路径的音频元素。
 * @property {string|null} audioUrl 回退元素绑定的 URL。
 */

/**
 * 创建播放引擎。
 *
 * 实现自行决定的细节（契约/任务未定义处，均取最简可靠方案）：
 * - `unlock()` 是**同步**函数（要在用户手势里直接调用），返回 AudioContext 是否已 running。
 * - `lastFailure(kind)` 返回内部 Error 实例（含 `code` / `kind` / `at` / 可能含 `cause`），
 *   或 `null`；请只读使用。
 * - `prepare(kind, src, source)` 是"预热"：只 fetch + 解码并写缓存，不发声；返回 `boolean`，从不抛错。
 * - `preview()` 对**未配置（src 为空）**仍按 CONTRACT §4.2 返回 `false`（不算失败），
 *   其余失败一律抛带 `code` 的 Error。
 * - 解码后的 `AudioBuffer` **按最终 URL 字符串**缓存（本地文件 URL 自带 `v` 版本参数，
 *   URL 变了自然重取）。回退用的 `Audio` 元素按 **kind + url** 持有（若按 url 跨 kind 共享，
 *   两个音效会互相抢占实例，破坏"每个音效独立"的语义）。
 * - `dispose()` 幂等：停播、abort 在途 fetch、清空缓存、`close()` 上下文。
 *
 * @param {AudioEngineDeps} [deps] 外部依赖。
 * @returns {{
 *   prepare: (kind: ChimeKind, src: string, source?: ChimeSource) => Promise<boolean>,
 *   play: (kind: ChimeKind, options?: PlayOptions) => Promise<boolean>,
 *   setVolume: (kind: ChimeKind, volume: number) => number,
 *   preview: (kind: ChimeKind, options?: PlayOptions) => Promise<boolean>,
 *   unlock: () => boolean,
 *   lastFailure: (kind: ChimeKind) => Error|null,
 *   dispose: () => void,
 * }} 播放引擎。
 */
export function createAudioEngine(deps = {}) {
  /** 注入的音源解析器；缺省时原样返回 `src`（纯 URL 场景仍可用）。 */
  const resolvePlayableUrl =
    typeof deps.resolveSource === 'function' ? deps.resolveSource : (src) => src;

  /** @type {Map<string, KindState>} kind → 运行时状态 */
  const states = new Map();
  /** @type {Map<string, { buffer: AudioBuffer }>} 最终 URL → 解码缓存 */
  const urlBuffers = new Map();
  /** @type {Map<string, number>} kind → 音量 */
  const volumes = new Map();
  /** @type {Map<string, Error>} kind → 最近一次失败 */
  const failures = new Map();

  /** @type {AudioContext|null} 懒创建的共享上下文 */
  let context = null;
  /** 引擎生命周期 controller：dispose 时 abort 在途 fetch。 */
  const lifecycle = typeof AbortController === 'function' ? new AbortController() : null;
  let disposed = false;

  // ---------------------------------------------------------------- 状态

  /**
   * 取（或创建）某个 kind 的运行时状态。
   * @param {string} kind 音效种类。
   * @returns {KindState} 运行时状态。
   */
  function stateFor(kind) {
    let state = states.get(kind);
    if (!state) {
      state = { sourceNode: null, gain: null, audio: null, audioUrl: null };
      states.set(kind, state);
    }
    return state;
  }

  /**
   * 停掉某个 kind 正在播放的声音（BufferSource / 元素）并断开节点。
   * 这是"同一 kind 不叠放"的实现点。
   * @param {KindState} state 运行时状态。
   * @returns {void}
   */
  function stopState(state) {
    if (state.sourceNode) {
      const node = state.sourceNode;
      state.sourceNode = null;
      try {
        node.onended = null;
      } catch {
        // ignore
      }
      try {
        node.stop();
      } catch {
        // 可能已自然结束，ignore
      }
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }
    if (state.gain) {
      const gain = state.gain;
      state.gain = null;
      try {
        gain.disconnect();
      } catch {
        // ignore
      }
    }
    if (state.audio) {
      const audio = state.audio;
      state.audio = null;
      state.audioUrl = null;
      teardownElement(audio);
    }
  }

  /**
   * 把配置里的音源解析成可播放 URL（本地 `file` 源由 host 的同源路由暴露；
   * `local` 源按 kind 取 IndexedDB 里的 objectURL）。
   * @param {string} src 音源（URL、本地绝对路径，或 `local` 源的显示文件名）。
   * @param {unknown} source `'url' | 'file' | 'local'`。
   * @param {ChimeKind} kind 当前音效种类（`local` 源据此取 objectURL）。
   * @returns {string} 可播放 URL（同源相对路径或 `blob:` URL）。
   */
  function resolveUrl(src, source, kind) {
    const isLocal = source === 'local';
    let resolved;
    try {
      resolved = resolvePlayableUrl(src, source, kind);
    } catch (error) {
      throw createFailure(
        AUDIO_FAILURES.RESOLVE_FAILED,
        isLocal ? LOCAL_AUDIO_MISSING : detailOf(error),
        error,
      );
    }
    if (typeof resolved !== 'string' || resolved.trim() === '') {
      throw createFailure(
        AUDIO_FAILURES.RESOLVE_FAILED,
        // `local` 源的可用性取决于 IndexedDB 里是否真的存过文件，
        // 空串不是契约外的异常，而是"还没选文件"，所以给可操作的原因。
        isLocal ? LOCAL_AUDIO_MISSING : 'resolveSource 未返回可播放 URL',
      );
    }
    return resolved;
  }

  // ------------------------------------------------------------ 上下文

  /**
   * 懒创建 `AudioContext`（**同步**），创建后立刻尝试 `resume()`。
   * 引擎已 dispose、或环境没有 AudioContext 时返回 `null`。
   * @returns {AudioContext|null} 共享上下文。
   */
  function ensureContext() {
    if (disposed) return null;
    if (context) {
      safeResume(context);
      return context;
    }
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof Ctor !== 'function') return null;
    try {
      context = new Ctor();
    } catch {
      context = null;
      return null;
    }
    safeResume(context);
    return context;
  }

  /**
   * 尽力唤醒上下文（fire-and-forget，绝不让 Promise 变成未处理拒绝）。
   * @param {AudioContext|null} ctx 上下文。
   * @returns {void}
   */
  function safeResume(ctx) {
    if (!ctx) return;
    try {
      if (ctx.state === 'running' || ctx.state === 'closed') return;
      const result = ctx.resume();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // ignore
    }
  }

  /**
   * 等待上下文进入 running（有上限），用于区分"真的开始发声"与"被 autoplay 拦住"。
   * @param {AudioContext} ctx 上下文。
   * @returns {Promise<boolean>} 是否 running。
   */
  async function waitForRunning(ctx) {
    if (!ctx) return false;
    if (ctx.state === 'running') return true;
    safeResume(ctx);
    if (ctx.state === 'running') return true;
    await delay(RESUME_BUDGET_MS);
    return ctx.state === 'running';
  }

  /**
   * 有上限的延时；环境没有 setTimeout 时立即 resolve。
   * @param {number} ms 毫秒。
   * @returns {Promise<void>} 完成信号。
   */
  function delay(ms) {
    return new Promise((resolve) => {
      try {
        setTimeout(resolve, ms);
      } catch {
        resolve();
      }
    });
  }

  // --------------------------------------------------------------- 解码

  /**
   * `decodeAudioData`（同时兼容 Promise 风格与回调风格）。
   * @param {ArrayBuffer} arrayBuffer 音频字节。
   * @returns {Promise<AudioBuffer>} 解码结果。
   */
  async function decodeArrayBuffer(arrayBuffer) {
    const ctx = ensureContext();
    if (!ctx) throw createFailure(AUDIO_FAILURES.NO_BACKEND);
    return await new Promise((resolve, reject) => {
      let settled = false;
      const done = (buffer) => {
        if (settled) return;
        settled = true;
        if (buffer) resolve(buffer);
        else reject(createFailure(AUDIO_FAILURES.DECODE_FAILED, 'decodeAudioData 返回空'));
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      try {
        const result = ctx.decodeAudioData(arrayBuffer, done, fail);
        if (result && typeof result.then === 'function') result.then(done, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  /**
   * 拉取可播放 URL 并解码，**按最终 URL 字符串**缓存（本地文件 URL 自带 `v` 版本参数）。
   * @param {string} url 可播放 URL（网络 URL 或 host 同源路由 URL）。
   * @returns {Promise<AudioBuffer>} 解码结果。
   */
  async function loadBufferFromUrl(url) {
    const cached = urlBuffers.get(url);
    if (cached && cached.buffer) return cached.buffer;

    if (typeof fetch !== 'function') {
      throw createFailure(AUDIO_FAILURES.FETCH_FAILED, '当前环境没有 fetch');
    }
    let response;
    try {
      response = await fetch(url, lifecycle ? { signal: lifecycle.signal } : undefined);
    } catch (error) {
      throw createFailure(AUDIO_FAILURES.FETCH_FAILED, detailOf(error), error);
    }
    if (!response) throw createFailure(AUDIO_FAILURES.FETCH_FAILED, '响应无效');
    if (response.ok === false) {
      const status = Number(response.status) || 0;
      const failure = createFailure(
        AUDIO_FAILURES.ASSET_HTTP_ERROR,
        status ? 'HTTP ' + status : '响应无效',
      );
      failure.status = status;
      throw failure;
    }
    let arrayBuffer;
    try {
      arrayBuffer = await response.arrayBuffer();
    } catch (error) {
      throw createFailure(AUDIO_FAILURES.FETCH_FAILED, detailOf(error), error);
    }
    let buffer;
    try {
      buffer = await decodeArrayBuffer(arrayBuffer);
    } catch (error) {
      if (error && error.code) throw error;
      throw createFailure(AUDIO_FAILURES.DECODE_FAILED, detailOf(error), error);
    }
    urlBuffers.set(url, { buffer });
    return buffer;
  }

  // ------------------------------------------------------------- 播放

  /**
   * 用 Web Audio 播放一个已解码的 buffer。
   * @param {ChimeKind} kind 音效种类。
   * @param {AudioBuffer} buffer 解码结果。
   * @param {number} volume 已钳制音量。
   * @returns {Promise<void>} 播放已启动时 resolve。
   */
  async function startBuffer(kind, buffer, volume) {
    const ctx = ensureContext();
    if (!ctx) throw createFailure(AUDIO_FAILURES.NO_BACKEND);
    const running = await waitForRunning(ctx);
    if (!running) throw createFailure(AUDIO_FAILURES.AUTOPLAY_BLOCKED);
    if (disposed) throw createFailure(AUDIO_FAILURES.DISPOSED);

    const state = stateFor(kind);
    stopState(state);

    let node = null;
    let gain = null;
    try {
      node = ctx.createBufferSource();
      gain = ctx.createGain();
      node.buffer = buffer;
      setGainValue(gain, ctx, volume);
      node.connect(gain);
      gain.connect(ctx.destination);
      node.start(0);
    } catch (error) {
      try {
        if (node) node.disconnect();
      } catch {
        // ignore
      }
      try {
        if (gain) gain.disconnect();
      } catch {
        // ignore
      }
      throw createFailure(AUDIO_FAILURES.UNSUPPORTED_FORMAT, detailOf(error), error);
    }

    state.sourceNode = node;
    state.gain = gain;
    try {
      node.onended = () => {
        if (state.sourceNode === node) {
          state.sourceNode = null;
          state.gain = null;
        }
      };
    } catch {
      // ignore
    }
  }

  /**
   * 用 `HTMLAudioElement` 播放（回退路径）。
   * @param {ChimeKind} kind 音效种类。
   * @param {string} url 可播放 URL（网络 URL 或 host 同源路由 URL）。
   * @param {number} volume 已钳制音量。
   * @param {Error|null} priorFailure 回退前发生的失败（作为 cause 保留）。
   * @returns {Promise<void>} 播放已启动时 resolve。
   */
  async function playElement(kind, url, volume, priorFailure) {
    const Ctor = globalThis.Audio;
    if (typeof Ctor !== 'function') {
      throw createFailure(
        AUDIO_FAILURES.NO_BACKEND,
        priorFailure ? '回退路径也不可用：' + detailOf(priorFailure) : '',
        priorFailure,
      );
    }

    const state = stateFor(kind);
    stopState(state);

    let audio = state.audioUrl === url ? state.audio : null;
    if (!audio) {
      try {
        audio = new Ctor(url);
      } catch (error) {
        throw createFailure(AUDIO_FAILURES.UNSUPPORTED_FORMAT, detailOf(error), error);
      }
      if (!audio || typeof audio.play !== 'function') throw createFailure(AUDIO_FAILURES.NO_BACKEND);
      state.audio = audio;
      state.audioUrl = url;
    }

    try {
      audio.volume = volume;
    } catch {
      // ignore
    }
    try {
      audio.currentTime = 0;
    } catch {
      // ignore
    }

    let played;
    try {
      played = audio.play();
    } catch (error) {
      throw elementFailure(error, priorFailure);
    }
    try {
      if (played && typeof played.then === 'function') await played;
    } catch (error) {
      throw elementFailure(error, priorFailure);
    }
  }

  /**
   * 把元素播放失败归类：autoplay 拦截 vs 格式 / 解码问题。
   * @param {unknown} error 原始错误。
   * @param {Error|null} priorFailure 回退前的失败。
   * @returns {Error} 带 code 的失败。
   */
  function elementFailure(error, priorFailure) {
    if (error && error.name === 'NotAllowedError') {
      return createFailure(AUDIO_FAILURES.AUTOPLAY_BLOCKED, detailOf(error), priorFailure || error);
    }
    return createFailure(AUDIO_FAILURES.UNSUPPORTED_FORMAT, detailOf(error), error);
  }

  /**
   * 播放一次（内部实现，失败抛带 code 的 Error）。
   * `file` / `url` / `local` 在此被 `resolveUrl` 统一成可播放 URL，之后走同一条路径。
   *
   * @param {ChimeKind} kind 音效种类。
   * @param {{ src: string, source: unknown, volume: unknown }} opts 归一化后的参数。
   * @returns {Promise<void>} 播放已启动时 resolve。
   */
  async function playOnce(kind, opts) {
    if (disposed) throw createFailure(AUDIO_FAILURES.DISPOSED);
    const volume = resolveVolume(kind, opts.volume);
    const url = resolveUrl(opts.src, opts.source, kind);

    /** @type {Error|null} */
    let priorFailure = null;
    const ctx = ensureContext();
    if (ctx) {
      try {
        const buffer = await loadBufferFromUrl(url);
        await startBuffer(kind, buffer, volume);
        return;
      } catch (error) {
        const code = error && error.code;
        if (
          code === AUDIO_FAILURES.NO_BACKEND ||
          code === AUDIO_FAILURES.DISPOSED ||
          code === AUDIO_FAILURES.AUTOPLAY_BLOCKED
        ) {
          throw error;
        }
        priorFailure = error instanceof Error ? error : createFailure(AUDIO_FAILURES.UNKNOWN, detailOf(error));
      }
    }
    try {
      await playElement(kind, url, volume, priorFailure);
    } catch (error) {
      throw pickRootFailure(priorFailure, error);
    }
  }

  /**
   * 两条路径都失败时报哪个原因：autoplay 拦截最可操作，其次是 fetch / 解码根因。
   * @param {Error|null} rootFailure fetch / 解码失败。
   * @param {Error} elementError 元素回退失败。
   * @returns {Error} 最终抛出的失败。
   */
  function pickRootFailure(rootFailure, elementError) {
    if (elementError && elementError.code === AUDIO_FAILURES.AUTOPLAY_BLOCKED) return elementError;
    return rootFailure || elementError || createFailure(AUDIO_FAILURES.UNKNOWN);
  }

  // ---------------------------------------------------------- 对外 API

  /**
   * 取本次播放音量：显式值优先，其次该 kind 已设音量，最后默认值。
   * @param {string} kind 音效种类。
   * @param {unknown} volume 显式音量。
   * @returns {number} 0..1。
   */
  function resolveVolume(kind, volume) {
    if (typeof volume === 'number') return clampVolume(volume);
    const known = volumes.get(kind);
    return typeof known === 'number' ? known : DEFAULT_VOLUME;
  }

  /**
   * 记录某个 kind 的失败：写入 `lastFailure` 并附加 `kind` / `at`。
   * @param {string} kind 音效种类。
   * @param {Error} failure 带 code 的失败。
   * @returns {void}
   */
  function recordFailure(kind, failure) {
    try {
      failure.kind = kind;
      failure.at = Date.now();
    } catch {
      // Error 属性一般可写；写不进也不影响。
    }
    failures.set(kind, failure);
  }

  /**
   * 预热：解析 URL → fetch + 解码并写缓存，不发声、不抛错。
   * `src` 为空时直接返回 `false`（且**不创建** AudioContext）。
   *
   * @param {ChimeKind} kind 音效种类（保持契约签名）。
   * @param {string} src 音频 URL 或本地绝对路径。
   * @param {ChimeSource} [source] 来源类型。
   * @returns {Promise<boolean>} 是否已就绪。
   */
  async function prepare(kind, src, source) {
    if (disposed) return false;
    const path = normalizeSrc(src);
    if (path === '') return false;
    try {
      if (!ensureContext()) return false;
      await loadBufferFromUrl(resolveUrl(path, source, kind));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 播放某个音效。**永远静默**：失败返回 `false`，原因写进 `lastFailure(kind)`。
   * `src` 为空 → 不发声、不构造任何音频对象、不创建 AudioContext。
   *
   * @param {ChimeKind} kind 音效种类。
   * @param {PlayOptions} [options] 播放参数。
   * @returns {Promise<boolean>} 是否真的开始发声。
   */
  async function play(kind, options) {
    if (disposed) {
      recordFailure(kind, createFailure(AUDIO_FAILURES.DISPOSED));
      return false;
    }
    const opts = normalizeOptions(options);
    if (opts.src === '') {
      // 未配置 = 静音；顺手清掉旧失败，避免 UI 一直挂着过期错误。
      failures.delete(kind);
      return false;
    }
    try {
      await playOnce(kind, opts);
      failures.delete(kind);
      return true;
    } catch (error) {
      recordFailure(kind, toFailure(error));
      return false;
    }
  }

  /**
   * 仅设置音量（0..1，越界钳制）；对**正在播放**的音效立即生效。
   *
   * @param {ChimeKind} kind 音效种类。
   * @param {number} volume 目标音量。
   * @returns {number} 实际生效的音量。
   */
  function setVolume(kind, volume) {
    const clamped = clampVolume(volume);
    volumes.set(kind, clamped);
    const state = states.get(kind);
    if (state) {
      if (state.gain) setGainValue(state.gain, context, clamped);
      if (state.audio) {
        try {
          state.audio.volume = clamped;
        } catch {
          // ignore
        }
      }
    }
    return clamped;
  }

  /**
   * 试听：与 `play` 同路径，但失败时**抛带原因的 Error**（设置页展示用）。
   * 未配置（`src` 为空）仍按 `CONTRACT.md` §4.2 返回 `false`，不算失败。
   *
   * @param {ChimeKind} kind 音效种类。
   * @param {PlayOptions} [options] 播放参数。
   * @returns {Promise<boolean>} 是否真的开始发声。
   * @throws {Error} 带 `code` 的失败原因。
   */
  async function preview(kind, options) {
    const opts = normalizeOptions(options);
    if (opts.src === '') return false;
    if (disposed) {
      const failure = createFailure(AUDIO_FAILURES.DISPOSED);
      recordFailure(kind, failure);
      throw failure;
    }
    try {
      await playOnce(kind, opts);
      failures.delete(kind);
      return true;
    } catch (error) {
      const failure = toFailure(error);
      recordFailure(kind, failure);
      throw failure;
    }
  }

  /**
   * 在用户手势里解锁音频（幂等）：懒创建 AudioContext 并 `resume()`。
   * 解锁之后，自动触发（无手势）的提示音才能真的响。
   *
   * @returns {boolean} AudioContext 当前是否 running（无后端时为 false）。
   */
  function unlock() {
    if (disposed) return false;
    const ctx = ensureContext();
    if (!ctx) return false;
    safeResume(ctx);
    return ctx.state === 'running';
  }

  /**
   * 最近一次失败原因。
   * @param {ChimeKind} kind 音效种类。
   * @returns {Error|null} 带 `code` / `kind` / `at` 的 Error；没有失败为 null。
   */
  function lastFailure(kind) {
    return failures.get(kind) || null;
  }

  /**
   * 释放全部资源：停播、abort 在途 fetch、清空缓存、关闭 AudioContext。幂等。
   * @returns {void}
   */
  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      if (lifecycle) lifecycle.abort();
    } catch {
      // ignore
    }
    for (const kind of Array.from(states.keys())) {
      const state = states.get(kind);
      if (state) stopState(state);
      states.delete(kind);
    }
    urlBuffers.clear();
    volumes.clear();
    failures.clear();

    const ctx = context;
    context = null;
    if (ctx) {
      try {
        const result = ctx.close();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        // ignore
      }
    }
  }

  return { prepare, play, setVolume, preview, unlock, lastFailure, dispose };
}

// ------------------------------------------------------------ 小工具

/**
 * 把任意错误整形成带 code 的失败。
 * @param {unknown} error 原始错误。
 * @returns {Error} 带 code 的失败。
 */
function toFailure(error) {
  if (error instanceof Error && typeof error.code === 'string' && error.code) return error;
  return createFailure(AUDIO_FAILURES.UNKNOWN, detailOf(error), error);
}

/**
 * 构造带 code 的失败。
 * @param {string} code `AUDIO_FAILURES` 中的代码。
 * @param {string} [detail] 追加细节（可为空）。
 * @param {unknown} [cause] 原始错误。
 * @returns {Error} 带 code 的失败。
 */
function createFailure(code, detail, cause) {
  const base = FAILURE_MESSAGES[code] || FAILURE_MESSAGES.UNKNOWN;
  const extra = typeof detail === 'string' ? detail.trim() : '';
  const message = extra ? base + '：' + extra : base;
  const error = new Error(message);
  error.name = 'ChimeAudioError';
  error.code = code;
  if (cause !== undefined) {
    try {
      error.cause = cause;
    } catch {
      // ignore
    }
  }
  return error;
}

/**
 * 提炼错误细节文本（截断到 160 字）。
 * @param {unknown} error 原始错误。
 * @returns {string} 细节文本。
 */
function detailOf(error) {
  if (!error) return '';
  const text = typeof error === 'string' ? error : error.message || String(error);
  return text.length > 160 ? text.slice(0, 157) + '...' : text;
}

/**
 * 归一化播放参数。
 * @param {unknown} options 原始参数。
 * @returns {{ src: string, source: unknown, volume: unknown }} 归一化结果。
 */
function normalizeOptions(options) {
  const opts = options && typeof options === 'object' ? options : {};
  return { src: normalizeSrc(opts.src), source: opts.source, volume: opts.volume };
}

/**
 * 归一化 `src`：非字符串或纯空白一律视为"未配置"。
 * @param {unknown} src 原始音源。
 * @returns {string} 可用音源或空字符串。
 */
function normalizeSrc(src) {
  if (typeof src !== 'string') return '';
  return src.trim().length === 0 ? '' : src;
}

/**
 * 音量钳制到 0..1；非有限数字回落到默认音量。
 * @param {unknown} value 原始音量。
 * @returns {number} 0..1 之间的音量。
 */
function clampVolume(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * 设置增益值（尽量用 `setValueAtTime` 避免爆音）。
 * @param {GainNode} gain 增益节点。
 * @param {AudioContext|null} ctx 上下文（可为 null）。
 * @param {number} value 0..1。
 * @returns {void}
 */
function setGainValue(gain, ctx, value) {
  try {
    const param = gain && gain.gain;
    if (!param) return;
    if (typeof param.setValueAtTime === 'function') {
      param.setValueAtTime(value, (ctx && ctx.currentTime) || 0);
    } else {
      param.value = value;
    }
  } catch {
    try {
      gain.gain.value = value;
    } catch {
      // ignore
    }
  }
}

/**
 * 停掉并断开一个音频元素。
 * @param {Audio} audio 音频元素。
 * @returns {void}
 */
function teardownElement(audio) {
  if (!audio) return;
  try {
    audio.pause();
  } catch {
    // ignore
  }
  try {
    if (typeof audio.removeAttribute === 'function') audio.removeAttribute('src');
    else audio.src = '';
  } catch {
    // ignore
  }
  try {
    if (typeof audio.load === 'function') audio.load();
  } catch {
    // ignore
  }
}
