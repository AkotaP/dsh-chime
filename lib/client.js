window.__ModuleLoader__.load({
  id: "dsh-chime",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/client/index.js
    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);
    var import_react2 = require("react");

    // src/client/config.js
    var STORAGE_KEY = "dsh.chime.config.v1";
    var CHIME_KINDS = Object.freeze(["approval", "question", "interrupted", "completed"]);
    var DEFAULT_CHIME = Object.freeze({ src: "", volume: 0.8, source: "url" });
    var ATTENTION_POLICIES = Object.freeze([
      "current-only",
      "away",
      "away-or-other",
      "always",
      "never"
    ]);
    var DEFAULT_CONFIG = deepFreeze({
      // 提醒时机（CONTRACT §3.7）：会话维度 × 窗口焦点维度，音效与通知各选一档。
      // 音效保持「只看当前会话」的既有听感；通知默认更聪明 —— 你正看着那条会话时不必再弹，
      // 但只要你不在 DSH、或事件来自别的会话，就一定弹。
      attention: {
        sound: "current-only",
        notify: "away-or-other"
      },
      completionMinSeconds: 10,
      // 完成音的最短任务时长（秒）；0 = 不设门槛
      enabled: true,
      // 音效总开关
      maxDepth: 0,
      // 最深发声的会话层级；0 = 只有主对话
      // 系统通知是**独立于音效**的一条通道：它有自己的总开关与逐类开关，
      // 不受音效总开关、音源配置的影响（音效关了、没配音源，通知照样弹）。
      notify: {
        enabled: false,
        // 通知总开关（默认关，与音效的「默认静音」保持一致）
        kinds: { approval: true, question: true, interrupted: true, completed: true },
        // 实验性（CONTRACT §4.8）：点击通知时让桌面版窗口回到前台。默认关闭 ——
        // 它会在宿主侧起一个短命的辅助进程，只对 Desktop 安装有意义。
        raiseWindow: false
      },
      kinds: {
        approval: { src: "", volume: 0.8, source: "url" },
        question: { src: "", volume: 0.8, source: "url" },
        interrupted: { src: "", volume: 0.8, source: "url" },
        completed: { src: "", volume: 0.8, source: "url" }
      }
    });
    function normalizeConfig(raw) {
      const source = isPlainObject(raw) ? raw : {};
      const rawKinds = isPlainObject(source.kinds) ? source.kinds : {};
      const kinds = {};
      for (const kind of CHIME_KINDS) {
        kinds[kind] = normalizeChime(rawKinds[kind]);
      }
      return {
        enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CONFIG.enabled,
        // 老配置的 backgroundSessions 在这里折算进 attention.sound，之后即被丢弃。
        attention: normalizeAttention(source.attention, source.backgroundSessions),
        completionMinSeconds: normalizeMinSeconds(source.completionMinSeconds),
        maxDepth: normalizeMaxDepth(source.maxDepth),
        notify: normalizeNotify(source.notify),
        kinds: (
          /** @type {Record<ChimeKind, ChimeConfig>} */
          kinds
        )
      };
    }
    function createConfigStore() {
      const listeners = /* @__PURE__ */ new Set();
      let snapshot = normalizeConfig(readPersisted());
      function commit(candidate) {
        if (candidate === snapshot || configsEqual(candidate, snapshot)) return snapshot;
        snapshot = candidate;
        writePersisted(snapshot);
        for (const listener of Array.from(listeners)) {
          try {
            listener(snapshot);
          } catch {
          }
        }
        return snapshot;
      }
      return {
        /** @returns {ChimeConfigSnapshot} 当前快照（视为只读）。 */
        getSnapshot() {
          return snapshot;
        },
        /**
         * 订阅变更。
         * @param {(config: ChimeConfigSnapshot) => void} fn 监听函数。
         * @returns {() => void} 取消订阅（幂等）。
         */
        subscribe(fn) {
          if (typeof fn !== "function") return () => {
          };
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
        /**
         * 浅合并顶层字段。
         * @param {object} [patch] 例如 `{ enabled: false }`。
         * @returns {ChimeConfigSnapshot} 生效后的快照。
         */
        update(patch) {
          const safe = isPlainObject(patch) ? patch : {};
          const merged = { ...snapshot, ...safe };
          if (!("kinds" in safe)) merged.kinds = snapshot.kinds;
          return commit(normalizeConfig(merged));
        },
        /**
         * 只合并某一个音效的字段（src / volume / source）。
         * @param {ChimeKind} kind 音效种类；非法时不做任何事。
         * @param {object} [patch] 例如 `{ src, source, volume }`。
         * @returns {ChimeConfigSnapshot} 生效后的快照。
         */
        setKind(kind, patch) {
          if (!CHIME_KINDS.includes(kind)) return snapshot;
          const safe = isPlainObject(patch) ? patch : {};
          const kinds = {
            ...snapshot.kinds,
            [kind]: { ...snapshot.kinds[kind], ...safe }
          };
          return commit(normalizeConfig({ ...snapshot, kinds }));
        },
        /** @returns {ChimeConfigSnapshot} 恢复默认配置（并写回存储）。 */
        reset() {
          return commit(normalizeConfig(null));
        }
      };
    }
    function normalizeChime(raw) {
      const source = isPlainObject(raw) ? raw : {};
      return {
        src: typeof source.src === "string" ? source.src : DEFAULT_CHIME.src,
        volume: normalizeVolume(source.volume),
        source: normalizeSource(source.source)
      };
    }
    var CHIME_SOURCES = Object.freeze(["url", "file", "local"]);
    function normalizeSource(value) {
      return typeof value === "string" && CHIME_SOURCES.includes(value) ? value : "url";
    }
    function normalizeVolume(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CHIME.volume;
      return Math.min(1, Math.max(0, value));
    }
    function normalizeAttention(raw, legacyBackgroundSessions) {
      const source = isPlainObject(raw) ? raw : {};
      const legacySound = legacyBackgroundSessions === true ? "always" : DEFAULT_CONFIG.attention.sound;
      return {
        sound: normalizePolicy(source.sound, legacySound),
        notify: normalizePolicy(source.notify, DEFAULT_CONFIG.attention.notify)
      };
    }
    function normalizePolicy(value, fallback) {
      return typeof value === "string" && ATTENTION_POLICIES.includes(value) ? value : fallback;
    }
    function normalizeNotify(raw) {
      const source = isPlainObject(raw) ? raw : {};
      const rawKinds = isPlainObject(source.kinds) ? source.kinds : {};
      const kinds = {};
      for (const kind of CHIME_KINDS) {
        const value = rawKinds[kind];
        kinds[kind] = typeof value === "boolean" ? value : DEFAULT_CONFIG.notify.kinds[kind];
      }
      return {
        enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CONFIG.notify.enabled,
        kinds: (
          /** @type {Record<ChimeKind, boolean>} */
          kinds
        ),
        raiseWindow: typeof source.raiseWindow === "boolean" ? source.raiseWindow : DEFAULT_CONFIG.notify.raiseWindow
      };
    }
    var MIN_SECONDS_MAX = 3600;
    function normalizeMinSeconds(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return DEFAULT_CONFIG.completionMinSeconds;
      }
      return Math.min(MIN_SECONDS_MAX, Math.max(0, Math.floor(value)));
    }
    var MAX_DEPTH_MAX = 16;
    function normalizeMaxDepth(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return DEFAULT_CONFIG.maxDepth;
      }
      return Math.min(MAX_DEPTH_MAX, Math.max(0, Math.floor(value)));
    }
    function configsEqual(a, b) {
      if (a === b) return true;
      if (!a || !b) return false;
      if (a.enabled !== b.enabled || a.completionMinSeconds !== b.completionMinSeconds || a.maxDepth !== b.maxDepth) {
        return false;
      }
      if (!a.attention || !b.attention) return false;
      if (a.attention.sound !== b.attention.sound || a.attention.notify !== b.attention.notify) {
        return false;
      }
      if (!a.notify || !b.notify) return false;
      if (a.notify.enabled !== b.notify.enabled) return false;
      if (a.notify.raiseWindow !== b.notify.raiseWindow) return false;
      for (const kind of CHIME_KINDS) {
        if (a.notify.kinds?.[kind] !== b.notify.kinds?.[kind]) return false;
      }
      for (const kind of CHIME_KINDS) {
        const left = a.kinds[kind];
        const right = b.kinds[kind];
        if (!left || !right) return false;
        if (left.src !== right.src || left.volume !== right.volume || left.source !== right.source) {
          return false;
        }
      }
      return true;
    }
    function readPersisted() {
      try {
        const storage = globalThis.localStorage;
        if (!storage || typeof storage.getItem !== "function") return null;
        const text = storage.getItem(STORAGE_KEY);
        if (typeof text !== "string" || text.length === 0) return null;
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
    function writePersisted(config) {
      try {
        const storage = globalThis.localStorage;
        if (!storage || typeof storage.setItem !== "function") return;
        storage.setItem(STORAGE_KEY, JSON.stringify(config));
      } catch {
      }
    }
    function isPlainObject(value) {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    function deepFreeze(value) {
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
      }
      return value;
    }

    // src/client/audio.js
    var DEFAULT_VOLUME = 0.8;
    var RESUME_BUDGET_MS = 200;
    var MAX_VOICES = 32;
    var LOCAL_AUDIO_MISSING = "\u672A\u627E\u5230\u8BE5\u97F3\u6548\u7684\u672C\u5730\u97F3\u9891\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u6587\u4EF6";
    var AUDIO_FAILURES = Object.freeze({
      /** `decodeAudioData` 失败（文件损坏或格式不受支持）。 */
      DECODE_FAILED: "DECODE_FAILED",
      /** 资源返回 HTTP 非 2xx（含 host 的 `/dsh-chime/asset` 路由报错）；Error 上带 `status`。 */
      ASSET_HTTP_ERROR: "ASSET_HTTP_ERROR",
      /** 网络层失败：fetch 抛错（断网 / CORS 未开启）或响应不可读。 */
      FETCH_FAILED: "FETCH_FAILED",
      /** `deps.resolveSource` 没能给出可播放 URL（防御性分支，契约保证不会发生）。 */
      RESOLVE_FAILED: "RESOLVE_FAILED",
      /** 回退到 `HTMLAudioElement` 后仍被 autoplay 策略拒绝。 */
      AUTOPLAY_BLOCKED: "AUTOPLAY_BLOCKED",
      /** 音源格式不受支持或无法解码（含元素路径的 NotSupportedError）。 */
      UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
      /** 环境里既没有 AudioContext 也没有 Audio。 */
      NO_BACKEND: "NO_BACKEND",
      /** 引擎已 `dispose()`。 */
      DISPOSED: "DISPOSED",
      /** 其他未归类失败。 */
      UNKNOWN: "UNKNOWN"
    });
    var FAILURE_MESSAGES = {
      DECODE_FAILED: "\u97F3\u9891\u89E3\u7801\u5931\u8D25\uFF08\u6587\u4EF6\u53EF\u80FD\u635F\u574F\u6216\u683C\u5F0F\u4E0D\u53D7\u652F\u6301\uFF09",
      ASSET_HTTP_ERROR: "\u97F3\u9891\u8D44\u6E90\u8BF7\u6C42\u5931\u8D25",
      FETCH_FAILED: "\u62C9\u53D6\u97F3\u9891\u5931\u8D25\uFF08\u7F51\u7EDC\u9519\u8BEF\u6216\u76EE\u6807\u7AD9\u672A\u5F00\u542F CORS\uFF09",
      RESOLVE_FAILED: "\u65E0\u6CD5\u628A\u97F3\u6E90\u89E3\u6790\u4E3A\u53EF\u64AD\u653E URL",
      AUTOPLAY_BLOCKED: "\u6D4F\u89C8\u5668\u62E6\u622A\u4E86\u81EA\u52A8\u64AD\u653E\uFF0C\u8BF7\u5148\u70B9\u51FB\u4E00\u6B21\u9875\u9762\uFF08\u6216\u5728\u8BBE\u7F6E\u9875\u70B9\u4E00\u6B21\u300C\u8BD5\u542C\u300D\uFF09\u6765\u89E3\u9501\u97F3\u9891",
      UNSUPPORTED_FORMAT: "\u97F3\u6E90\u683C\u5F0F\u4E0D\u53D7\u652F\u6301\u6216\u65E0\u6CD5\u89E3\u7801",
      NO_BACKEND: "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u97F3\u9891\u64AD\u653E\uFF08\u7F3A\u5C11 AudioContext \u4E0E Audio\uFF09",
      DISPOSED: "\u97F3\u9891\u5F15\u64CE\u5DF2\u91CA\u653E",
      UNKNOWN: "\u64AD\u653E\u5931\u8D25"
    };
    function createAudioEngine(deps = {}) {
      const resolvePlayableUrl = typeof deps.resolveSource === "function" ? deps.resolveSource : (src) => src;
      const states = /* @__PURE__ */ new Map();
      const urlBuffers = /* @__PURE__ */ new Map();
      const urlLoads = /* @__PURE__ */ new Map();
      const activeVoices = /* @__PURE__ */ new Set();
      const allowOverlap = deps.allowOverlap === true;
      const cancelled = Symbol("audio playback cancelled");
      const volumes = /* @__PURE__ */ new Map();
      const failures = /* @__PURE__ */ new Map();
      let context = null;
      const lifecycle = typeof AbortController === "function" ? new AbortController() : null;
      let disposed = false;
      function stateFor(kind) {
        let state = states.get(kind);
        if (!state) {
          state = { generation: 0, voices: /* @__PURE__ */ new Set() };
          states.set(kind, state);
        }
        return state;
      }
      function stopState(state) {
        for (const voice of Array.from(state.voices)) releaseVoice(voice, true);
      }
      function releaseVoice(voice, stopPlayback = false) {
        if (voice.released) return;
        voice.released = true;
        voice.state.voices.delete(voice);
        activeVoices.delete(voice);
        const { node, gain, audio } = voice;
        if (node) {
          try {
            node.onended = null;
          } catch {
          }
          if (stopPlayback) {
            try {
              node.stop();
            } catch {
            }
          }
          try {
            node.disconnect();
          } catch {
          }
        }
        if (gain) {
          try {
            gain.disconnect();
          } catch {
          }
        }
        if (audio) {
          try {
            audio.onended = null;
          } catch {
          }
          teardownElement(audio);
        }
      }
      function trackVoice(state, node = null, gain = null, audio = null) {
        if (!allowOverlap) stopState(state);
        if (allowOverlap && activeVoices.size >= MAX_VOICES) {
          releaseVoice(activeVoices.values().next().value, true);
        }
        const voice = { state, node, gain, audio, released: false };
        state.voices.add(voice);
        activeVoices.add(voice);
        (node || audio).onended = () => releaseVoice(voice);
        return voice;
      }
      function checkStart(kind, state, generation2, opts) {
        if (disposed) throw createFailure(AUDIO_FAILURES.DISPOSED);
        if (state.generation !== generation2 || opts.signal?.aborted) throw cancelled;
        if (typeof deps.shouldStart === "function" && !deps.shouldStart(kind, opts)) throw cancelled;
      }
      function stop(kind) {
        const targets = kind === void 0 ? states.values() : [states.get(kind)];
        for (const state of targets) {
          if (!state) continue;
          state.generation += 1;
          stopState(state);
        }
      }
      function resolveUrl(src, source, kind) {
        const isLocal = source === "local";
        let resolved;
        try {
          resolved = resolvePlayableUrl(src, source, kind);
        } catch (error) {
          throw createFailure(
            AUDIO_FAILURES.RESOLVE_FAILED,
            isLocal ? LOCAL_AUDIO_MISSING : detailOf(error),
            error
          );
        }
        if (typeof resolved !== "string" || resolved.trim() === "") {
          throw createFailure(
            AUDIO_FAILURES.RESOLVE_FAILED,
            // `local` 源的可用性取决于 IndexedDB 里是否真的存过文件，
            // 空串不是契约外的异常，而是"还没选文件"，所以给可操作的原因。
            isLocal ? LOCAL_AUDIO_MISSING : "resolveSource \u672A\u8FD4\u56DE\u53EF\u64AD\u653E URL"
          );
        }
        return resolved;
      }
      function ensureContext() {
        if (disposed) return null;
        if (context) {
          safeResume(context);
          return context;
        }
        const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (typeof Ctor !== "function") return null;
        try {
          context = new Ctor();
        } catch {
          context = null;
          return null;
        }
        safeResume(context);
        return context;
      }
      function safeResume(ctx) {
        if (!ctx) return;
        try {
          if (ctx.state === "running" || ctx.state === "closed") return;
          const result = ctx.resume();
          if (result && typeof result.catch === "function") result.catch(() => {
          });
        } catch {
        }
      }
      async function waitForRunning(ctx) {
        if (!ctx) return false;
        if (ctx.state === "running") return true;
        safeResume(ctx);
        if (ctx.state === "running") return true;
        await delay(RESUME_BUDGET_MS);
        return ctx.state === "running";
      }
      function delay(ms) {
        return new Promise((resolve) => {
          try {
            setTimeout(resolve, ms);
          } catch {
            resolve();
          }
        });
      }
      async function decodeArrayBuffer(arrayBuffer) {
        const ctx = ensureContext();
        if (!ctx) throw createFailure(AUDIO_FAILURES.NO_BACKEND);
        return await new Promise((resolve, reject) => {
          let settled = false;
          const done = (buffer) => {
            if (settled) return;
            settled = true;
            if (buffer) resolve(buffer);
            else reject(createFailure(AUDIO_FAILURES.DECODE_FAILED, "decodeAudioData \u8FD4\u56DE\u7A7A"));
          };
          const fail = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
          };
          try {
            const result = ctx.decodeAudioData(arrayBuffer, done, fail);
            if (result && typeof result.then === "function") result.then(done, fail);
          } catch (error) {
            fail(error);
          }
        });
      }
      async function loadBufferFromUrl(url) {
        if (disposed) throw createFailure(AUDIO_FAILURES.DISPOSED);
        const cached = urlBuffers.get(url);
        if (cached && cached.buffer) return cached.buffer;
        const pending = urlLoads.get(url);
        if (pending) return pending;
        const loading = fetchAndDecode(url);
        urlLoads.set(url, loading);
        try {
          return await loading;
        } finally {
          if (urlLoads.get(url) === loading) urlLoads.delete(url);
        }
      }
      async function fetchAndDecode(url) {
        if (disposed) throw createFailure(AUDIO_FAILURES.DISPOSED);
        if (typeof fetch !== "function") {
          throw createFailure(AUDIO_FAILURES.FETCH_FAILED, "\u5F53\u524D\u73AF\u5883\u6CA1\u6709 fetch");
        }
        let response;
        try {
          response = await fetch(url, lifecycle ? { signal: lifecycle.signal } : void 0);
        } catch (error) {
          throw createFailure(AUDIO_FAILURES.FETCH_FAILED, detailOf(error), error);
        }
        if (disposed) throw createFailure(AUDIO_FAILURES.DISPOSED);
        if (!response) throw createFailure(AUDIO_FAILURES.FETCH_FAILED, "\u54CD\u5E94\u65E0\u6548");
        if (response.ok === false) {
          const status = Number(response.status) || 0;
          const failure = createFailure(
            AUDIO_FAILURES.ASSET_HTTP_ERROR,
            status ? "HTTP " + status : "\u54CD\u5E94\u65E0\u6548"
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
        if (disposed) throw createFailure(AUDIO_FAILURES.DISPOSED);
        urlBuffers.set(url, { buffer });
        return buffer;
      }
      async function startBuffer(kind, buffer, volume, opts, state, generation2) {
        checkStart(kind, state, generation2, opts);
        const ctx = ensureContext();
        if (!ctx) throw createFailure(AUDIO_FAILURES.NO_BACKEND);
        const running = await waitForRunning(ctx);
        checkStart(kind, state, generation2, opts);
        if (!running) throw createFailure(AUDIO_FAILURES.AUTOPLAY_BLOCKED);
        let node = null;
        let gain = null;
        let voice = null;
        try {
          node = ctx.createBufferSource();
          gain = ctx.createGain();
          node.buffer = buffer;
          node.playbackRate.value = opts.playbackRate;
          setGainValue(gain, ctx, volume);
          node.connect(gain);
          gain.connect(ctx.destination);
          voice = trackVoice(state, node, gain);
          node.start(0);
        } catch (error) {
          if (voice) releaseVoice(voice, true);
          else {
            try {
              if (node) node.disconnect();
            } catch {
            }
            try {
              if (gain) gain.disconnect();
            } catch {
            }
          }
          throw createFailure(AUDIO_FAILURES.UNSUPPORTED_FORMAT, detailOf(error), error);
        }
      }
      async function playElement(kind, url, volume, priorFailure, opts, state, generation2) {
        checkStart(kind, state, generation2, opts);
        const Ctor = globalThis.Audio;
        if (typeof Ctor !== "function") {
          throw createFailure(
            AUDIO_FAILURES.NO_BACKEND,
            priorFailure ? "\u56DE\u9000\u8DEF\u5F84\u4E5F\u4E0D\u53EF\u7528\uFF1A" + detailOf(priorFailure) : "",
            priorFailure
          );
        }
        let audio;
        try {
          audio = new Ctor(url);
        } catch (error) {
          throw createFailure(AUDIO_FAILURES.UNSUPPORTED_FORMAT, detailOf(error), error);
        }
        if (!audio || typeof audio.play !== "function") throw createFailure(AUDIO_FAILURES.NO_BACKEND);
        try {
          audio.volume = volume;
        } catch {
        }
        try {
          audio.currentTime = 0;
        } catch {
        }
        try {
          audio.playbackRate = opts.playbackRate;
        } catch {
        }
        for (const property of ["preservesPitch", "mozPreservesPitch", "webkitPreservesPitch"]) {
          try {
            if (property in audio) audio[property] = false;
          } catch {
          }
        }
        const voice = trackVoice(state, null, null, audio);
        try {
          await audio.play();
          checkStart(kind, state, generation2, opts);
          if (voice.released) throw cancelled;
        } catch (error) {
          releaseVoice(voice, true);
          teardownElement(audio);
          if (error === cancelled || disposed) throw error;
          checkStart(kind, state, generation2, opts);
          throw elementFailure(error, priorFailure);
        }
      }
      function elementFailure(error, priorFailure) {
        if (error && error.name === "NotAllowedError") {
          return createFailure(AUDIO_FAILURES.AUTOPLAY_BLOCKED, detailOf(error), priorFailure || error);
        }
        return createFailure(AUDIO_FAILURES.UNSUPPORTED_FORMAT, detailOf(error), error);
      }
      async function playOnce(kind, opts) {
        const state = stateFor(kind);
        const generation2 = state.generation;
        checkStart(kind, state, generation2, opts);
        const volume = resolveVolume(kind, opts.volume);
        const url = resolveUrl(opts.src, opts.source, kind);
        let priorFailure = null;
        const ctx = ensureContext();
        if (ctx) {
          try {
            const buffer = await loadBufferFromUrl(url);
            await startBuffer(kind, buffer, volume, opts, state, generation2);
            return;
          } catch (error) {
            checkStart(kind, state, generation2, opts);
            if (error === cancelled) throw error;
            const code = error && error.code;
            if (code === AUDIO_FAILURES.NO_BACKEND || code === AUDIO_FAILURES.DISPOSED || code === AUDIO_FAILURES.AUTOPLAY_BLOCKED) {
              throw error;
            }
            priorFailure = error instanceof Error ? error : createFailure(AUDIO_FAILURES.UNKNOWN, detailOf(error));
          }
        }
        try {
          await playElement(kind, url, volume, priorFailure, opts, state, generation2);
        } catch (error) {
          checkStart(kind, state, generation2, opts);
          if (error === cancelled) throw error;
          throw pickRootFailure(priorFailure, error);
        }
      }
      function pickRootFailure(rootFailure, elementError) {
        if (elementError && elementError.code === AUDIO_FAILURES.AUTOPLAY_BLOCKED) return elementError;
        return rootFailure || elementError || createFailure(AUDIO_FAILURES.UNKNOWN);
      }
      function resolveVolume(kind, volume) {
        if (typeof volume === "number") return clampVolume(volume);
        const known = volumes.get(kind);
        return typeof known === "number" ? known : DEFAULT_VOLUME;
      }
      function recordFailure(kind, failure) {
        try {
          failure.kind = kind;
          failure.at = Date.now();
        } catch {
        }
        failures.set(kind, failure);
      }
      async function prepare(kind, src, source) {
        if (disposed) return false;
        const path = normalizeSrc(src);
        if (path === "") return false;
        try {
          if (!ensureContext()) return false;
          await loadBufferFromUrl(resolveUrl(path, source, kind));
          return !disposed;
        } catch {
          return false;
        }
      }
      async function play(kind, options) {
        if (disposed) {
          recordFailure(kind, createFailure(AUDIO_FAILURES.DISPOSED));
          return false;
        }
        const opts = normalizeOptions(options);
        if (opts.src === "") {
          failures.delete(kind);
          return false;
        }
        try {
          await playOnce(kind, opts);
          failures.delete(kind);
          return true;
        } catch (error) {
          if (error === cancelled) return false;
          recordFailure(kind, toFailure(error));
          return false;
        }
      }
      function setVolume(kind, volume) {
        const clamped = clampVolume(volume);
        volumes.set(kind, clamped);
        const state = states.get(kind);
        if (state) {
          for (const voice of state.voices) {
            if (voice.gain) setGainValue(voice.gain, context, clamped);
            if (voice.audio) {
              try {
                voice.audio.volume = clamped;
              } catch {
              }
            }
          }
        }
        return clamped;
      }
      async function preview(kind, options) {
        const opts = normalizeOptions(options);
        if (opts.src === "") return false;
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
          if (error === cancelled) return false;
          const failure = toFailure(error);
          recordFailure(kind, failure);
          throw failure;
        }
      }
      function unlock() {
        if (disposed) return false;
        const ctx = ensureContext();
        if (!ctx) return false;
        safeResume(ctx);
        return ctx.state === "running";
      }
      function lastFailure(kind) {
        return failures.get(kind) || null;
      }
      function dispose() {
        if (disposed) return;
        disposed = true;
        stop();
        try {
          if (lifecycle) lifecycle.abort();
        } catch {
        }
        for (const kind of Array.from(states.keys())) {
          const state = states.get(kind);
          if (state) stopState(state);
          states.delete(kind);
        }
        urlBuffers.clear();
        urlLoads.clear();
        volumes.clear();
        failures.clear();
        const ctx = context;
        context = null;
        if (ctx) {
          try {
            const result = ctx.close();
            if (result && typeof result.catch === "function") result.catch(() => {
            });
          } catch {
          }
        }
      }
      return { prepare, play, setVolume, preview, stop, unlock, lastFailure, dispose };
    }
    function toFailure(error) {
      if (error instanceof Error && typeof error.code === "string" && error.code) return error;
      return createFailure(AUDIO_FAILURES.UNKNOWN, detailOf(error), error);
    }
    function createFailure(code, detail, cause) {
      const base = FAILURE_MESSAGES[code] || FAILURE_MESSAGES.UNKNOWN;
      const extra = typeof detail === "string" ? detail.trim() : "";
      const message = extra ? base + "\uFF1A" + extra : base;
      const error = new Error(message);
      error.name = "ChimeAudioError";
      error.code = code;
      if (cause !== void 0) {
        try {
          error.cause = cause;
        } catch {
        }
      }
      return error;
    }
    function detailOf(error) {
      if (!error) return "";
      const text = typeof error === "string" ? error : error.message || String(error);
      return text.length > 160 ? text.slice(0, 157) + "..." : text;
    }
    function normalizeOptions(options) {
      const opts = options && typeof options === "object" ? options : {};
      const playbackRate = typeof opts.playbackRate === "number" && Number.isFinite(opts.playbackRate) ? Math.min(4, Math.max(0.25, opts.playbackRate)) : 1;
      return {
        src: normalizeSrc(opts.src),
        source: opts.source,
        volume: opts.volume,
        playbackRate,
        signal: opts.signal
      };
    }
    function normalizeSrc(src) {
      if (typeof src !== "string") return "";
      return src.trim().length === 0 ? "" : src;
    }
    function clampVolume(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_VOLUME;
      return Math.min(1, Math.max(0, value));
    }
    function setGainValue(gain, ctx, value) {
      try {
        const param = gain && gain.gain;
        if (!param) return;
        if (typeof param.setValueAtTime === "function") {
          param.setValueAtTime(value, ctx && ctx.currentTime || 0);
        } else {
          param.value = value;
        }
      } catch {
        try {
          gain.gain.value = value;
        } catch {
        }
      }
    }
    function teardownElement(audio) {
      if (!audio) return;
      try {
        audio.pause();
      } catch {
      }
      try {
        if (typeof audio.removeAttribute === "function") audio.removeAttribute("src");
        else audio.src = "";
      } catch {
      }
      try {
        if (typeof audio.load === "function") audio.load();
      } catch {
      }
    }

    // src/client/localAudioStore.js
    var localAudioStore_exports = {};
    __export(localAudioStore_exports, {
      LOCAL_AUDIO_DB_NAME: () => LOCAL_AUDIO_DB_NAME,
      LOCAL_AUDIO_STORE_NAME: () => LOCAL_AUDIO_STORE_NAME,
      getLocalAudio: () => getLocalAudio,
      getLocalAudioUrl: () => getLocalAudioUrl,
      isLocalAudioSupported: () => isLocalAudioSupported,
      listLocalAudio: () => listLocalAudio,
      putLocalAudio: () => putLocalAudio,
      releaseAll: () => releaseAll,
      removeLocalAudio: () => removeLocalAudio,
      warmLocalAudioUrls: () => warmLocalAudioUrls
    });
    var LOCAL_AUDIO_DB_NAME = "dsh-chime-audio";
    var LOCAL_AUDIO_STORE_NAME = "files";
    var DB_VERSION = 1;
    var ERROR_NAME = "ChimeLocalAudioError";
    var PUT_FAILED = "\u4FDD\u5B58\u672C\u5730\u97F3\u9891\u5931\u8D25";
    var READ_FAILED = "\u8BFB\u53D6\u672C\u5730\u97F3\u9891\u5931\u8D25";
    var REMOVE_FAILED = "\u5220\u9664\u672C\u5730\u97F3\u9891\u5931\u8D25";
    var STORE_UNAVAILABLE = "\u672C\u5730\u97F3\u9891\u5B58\u50A8\u4E0D\u53EF\u7528";
    var TYPE_EXTENSIONS = Object.freeze({
      "audio/mpeg": ".mp3",
      "audio/mp3": ".mp3",
      "audio/wav": ".wav",
      "audio/x-wav": ".wav",
      "audio/wave": ".wav",
      "audio/ogg": ".ogg",
      "audio/mp4": ".m4a",
      "audio/x-m4a": ".m4a",
      "audio/aac": ".aac",
      "audio/flac": ".flac",
      "audio/x-flac": ".flac",
      "audio/webm": ".webm"
    });
    var connection = null;
    var opening = null;
    var generation = 0;
    var objectUrls = /* @__PURE__ */ new Map();
    var hydrations = /* @__PURE__ */ new Map();
    var absentKinds = /* @__PURE__ */ new Set();
    function isLocalAudioSupported() {
      try {
        const factory = globalThis.indexedDB;
        return factory !== null && factory !== void 0 && typeof factory.open === "function";
      } catch {
        return false;
      }
    }
    async function putLocalAudio(kind, file) {
      const key = normalizeKind(kind);
      if (key === "") {
        throw localAudioError(`${PUT_FAILED}\uFF1A\u97F3\u6548\u79CD\u7C7B\u65E0\u6548`);
      }
      if (!isBlobLike(file)) {
        throw localAudioError(`${PUT_FAILED}\uFF1A\u6CA1\u6709\u62FF\u5230\u6709\u6548\u7684\u97F3\u9891\u6587\u4EF6`);
      }
      if (!isLocalAudioSupported()) {
        throw localAudioError(`${PUT_FAILED}\uFF1A\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 IndexedDB\uFF08\u53EF\u80FD\u5904\u4E8E\u9690\u79C1\u6A21\u5F0F\u6216\u7981\u7528\u4E86\u672C\u5730\u5B58\u50A8\uFF09`);
      }
      const record = {
        kind: key,
        blob: file,
        name: nameOf(file),
        type: typeof file.type === "string" ? file.type : "",
        size: typeof file.size === "number" && Number.isFinite(file.size) ? file.size : 0,
        savedAt: Date.now()
      };
      const savedGeneration = generation;
      await transact("readwrite", PUT_FAILED, (store, setValue, fail) => {
        let request;
        try {
          request = store.put(record);
        } catch (error) {
          fail(localAudioError(`${PUT_FAILED}\uFF1A${key}`, error));
          return;
        }
        if (!request) {
          fail(localAudioError(`${PUT_FAILED}\uFF1A${key}\uFF08\u5B58\u50A8\u672A\u63A5\u53D7\u5199\u5165\u8BF7\u6C42\uFF09`));
          return;
        }
        request.onsuccess = () => setValue(true);
        request.onerror = () => fail(localAudioError(`${PUT_FAILED}\uFF1A${key}`, request.error));
      });
      absentKinds.delete(key);
      if (savedGeneration === generation) cacheObjectUrl(key, file);
      return { name: record.name, size: record.size };
    }
    async function getLocalAudio(kind) {
      const key = normalizeKind(kind);
      if (key === "") return null;
      try {
        const record = await transact("readonly", READ_FAILED, (store, setValue, fail) => {
          let request;
          try {
            request = store.get(key);
          } catch (error) {
            fail(localAudioError(`${READ_FAILED}\uFF1A${key}`, error));
            return;
          }
          if (!request) {
            fail(localAudioError(`${READ_FAILED}\uFF1A${key}\uFF08\u5B58\u50A8\u672A\u8FD4\u56DE\u8BFB\u53D6\u8BF7\u6C42\uFF09`));
            return;
          }
          request.onsuccess = () => setValue(normalizeRecord(request.result));
          request.onerror = () => fail(localAudioError(`${READ_FAILED}\uFF1A${key}`, request.error));
        });
        return record || null;
      } catch {
        return null;
      }
    }
    async function removeLocalAudio(kind) {
      const key = normalizeKind(kind);
      if (key === "") return false;
      releaseObjectUrl(key);
      absentKinds.add(key);
      try {
        const existed = await transact("readwrite", REMOVE_FAILED, (store, setValue, fail) => {
          let probe;
          try {
            probe = store.get(key);
          } catch (error) {
            fail(localAudioError(`${REMOVE_FAILED}\uFF1A${key}`, error));
            return;
          }
          if (!probe) {
            fail(localAudioError(`${REMOVE_FAILED}\uFF1A${key}\uFF08\u5B58\u50A8\u672A\u8FD4\u56DE\u8BFB\u53D6\u8BF7\u6C42\uFF09`));
            return;
          }
          probe.onsuccess = () => {
            const found = probe.result !== void 0 && probe.result !== null;
            setValue(found);
            try {
              const deletion = store.delete(key);
              if (deletion) {
                deletion.onerror = () => fail(localAudioError(`${REMOVE_FAILED}\uFF1A${key}`, deletion.error));
              }
            } catch (error) {
              fail(localAudioError(`${REMOVE_FAILED}\uFF1A${key}`, error));
            }
          };
          probe.onerror = () => fail(localAudioError(`${REMOVE_FAILED}\uFF1A${key}`, probe.error));
        });
        return existed === true;
      } catch {
        return false;
      }
    }
    async function listLocalAudio() {
      try {
        const records = await transact("readonly", READ_FAILED, (store, setValue, fail) => {
          readAllRecords(store, setValue, fail);
        });
        const summary = {};
        const rows = Array.isArray(records) ? records : [];
        for (const row of rows) {
          const key = normalizeKind(row && row.kind);
          if (key === "" || key === "__proto__") continue;
          const record = normalizeRecord(row);
          if (!record) continue;
          summary[key] = { name: record.name, size: record.size };
        }
        return summary;
      } catch {
        return {};
      }
    }
    function getLocalAudioUrl(kind) {
      try {
        const key = normalizeKind(kind);
        if (key === "") return null;
        const cached = objectUrls.get(key);
        if (typeof cached === "string" && cached !== "") return cached;
        if (!absentKinds.has(key) && !hydrations.has(key) && isLocalAudioSupported()) {
          void hydrate(key);
        }
        return null;
      } catch {
        return null;
      }
    }
    async function warmLocalAudioUrls() {
      try {
        if (!isLocalAudioSupported()) return null;
        const records = await transact("readonly", READ_FAILED, (store, setValue, fail) => {
          readAllRecords(store, setValue, fail);
        });
        if (!Array.isArray(records)) return null;
        const warmed = {};
        for (const row of records) {
          const key = normalizeKind(row && row.kind);
          if (key === "") continue;
          const record = normalizeRecord(row);
          if (!record) continue;
          const url = cacheObjectUrl(key, record.blob);
          if (url) warmed[key] = url;
        }
        return warmed;
      } catch {
        return null;
      }
    }
    function releaseAll() {
      generation += 1;
      for (const url of objectUrls.values()) revokeObjectUrl(url);
      objectUrls.clear();
      hydrations.clear();
      absentKinds.clear();
      const db = connection;
      connection = null;
      opening = null;
      if (db) {
        try {
          db.close();
        } catch {
        }
      }
    }
    function cacheObjectUrl(key, blob) {
      releaseObjectUrl(key);
      if (!canCreateObjectUrl() || !isBlobLike(blob)) return null;
      let url = null;
      try {
        url = globalThis.URL.createObjectURL(blob);
      } catch {
        return null;
      }
      if (typeof url !== "string" || url === "") return null;
      objectUrls.set(key, url);
      absentKinds.delete(key);
      return url;
    }
    function releaseObjectUrl(key) {
      const url = objectUrls.get(key);
      if (url === void 0) return;
      objectUrls.delete(key);
      revokeObjectUrl(url);
    }
    function canCreateObjectUrl() {
      try {
        return typeof globalThis.URL === "function" && typeof globalThis.URL.createObjectURL === "function";
      } catch {
        return false;
      }
    }
    function revokeObjectUrl(url) {
      try {
        if (typeof url !== "string" || url === "") return;
        const urlApi = globalThis.URL;
        if (!urlApi || typeof urlApi.revokeObjectURL !== "function") return;
        urlApi.revokeObjectURL(url);
      } catch {
      }
    }
    function hydrate(key) {
      const running = hydrations.get(key);
      if (running) return running;
      const startedAt = generation;
      const task = (async () => {
        const record = await getLocalAudio(key);
        if (startedAt !== generation) return null;
        if (!record) {
          absentKinds.add(key);
          return null;
        }
        return cacheObjectUrl(key, record.blob);
      })();
      const guarded = task.catch(() => null).then((url) => {
        if (hydrations.get(key) === guarded) hydrations.delete(key);
        return url;
      });
      hydrations.set(key, guarded);
      return guarded;
    }
    function openDatabase() {
      if (connection) return Promise.resolve(connection);
      if (opening) return opening;
      const startedAt = generation;
      const task = new Promise((resolve, reject) => {
        if (!isLocalAudioSupported()) {
          reject(
            localAudioError(
              `${STORE_UNAVAILABLE}\uFF1A\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 IndexedDB\uFF08\u53EF\u80FD\u5904\u4E8E\u9690\u79C1\u6A21\u5F0F\u6216\u7981\u7528\u4E86\u672C\u5730\u5B58\u50A8\uFF09`
            )
          );
          return;
        }
        let request;
        try {
          request = globalThis.indexedDB.open(LOCAL_AUDIO_DB_NAME, DB_VERSION);
        } catch (error) {
          reject(localAudioError(`${STORE_UNAVAILABLE}\uFF1A\u65E0\u6CD5\u6253\u5F00 IndexedDB`, error));
          return;
        }
        if (!request || typeof request !== "object") {
          reject(localAudioError(`${STORE_UNAVAILABLE}\uFF1AIndexedDB \u672A\u8FD4\u56DE\u6253\u5F00\u8BF7\u6C42`));
          return;
        }
        request.onupgradeneeded = () => {
          try {
            const db = request.result;
            if (db && db.objectStoreNames && !db.objectStoreNames.contains(LOCAL_AUDIO_STORE_NAME)) {
              db.createObjectStore(LOCAL_AUDIO_STORE_NAME, { keyPath: "kind" });
            }
          } catch {
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          if (!db) {
            reject(localAudioError(`${STORE_UNAVAILABLE}\uFF1AIndexedDB \u672A\u8FD4\u56DE\u6570\u636E\u5E93\u8FDE\u63A5`));
            return;
          }
          if (startedAt !== generation) {
            try {
              db.close();
            } catch {
            }
            reject(localAudioError(`${STORE_UNAVAILABLE}\uFF1A\u672C\u5730\u97F3\u9891\u5B58\u50A8\u5DF2\u91CA\u653E`));
            return;
          }
          connection = db;
          try {
            db.onversionchange = () => {
              try {
                db.close();
              } catch {
              }
              if (connection === db) connection = null;
            };
          } catch {
          }
          resolve(db);
        };
        request.onerror = () => reject(localAudioError(`${STORE_UNAVAILABLE}\uFF1A\u6253\u5F00 IndexedDB \u5931\u8D25`, request.error));
      });
      opening = task.then(
        (db) => {
          opening = null;
          return db;
        },
        (error) => {
          opening = null;
          throw error;
        }
      );
      return opening;
    }
    function transact(mode, failureMessage, work) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let value;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          reject(asLocalAudioError(error, failureMessage));
        };
        const succeed = () => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        openDatabase().then(
          (db) => {
            let tx;
            try {
              tx = db.transaction(LOCAL_AUDIO_STORE_NAME, mode);
            } catch (error) {
              fail(localAudioError(`${failureMessage}\uFF1A\u65E0\u6CD5\u5F00\u59CB\u5B58\u50A8\u4E8B\u52A1`, error));
              return;
            }
            tx.oncomplete = succeed;
            tx.onabort = () => fail(localAudioError(`${failureMessage}\uFF1A\u5B58\u50A8\u4E8B\u52A1\u88AB\u4E2D\u65AD`, tx.error));
            tx.onerror = () => fail(localAudioError(`${failureMessage}\uFF1A\u5B58\u50A8\u4E8B\u52A1\u5931\u8D25`, tx.error));
            let store;
            try {
              store = tx.objectStore(LOCAL_AUDIO_STORE_NAME);
            } catch (error) {
              fail(localAudioError(`${failureMessage}\uFF1A\u65E0\u6CD5\u8BBF\u95EE\u5B58\u50A8`, error));
              return;
            }
            try {
              work(store, (v) => {
                value = v;
              }, fail);
            } catch (error) {
              fail(localAudioError(`${failureMessage}\uFF1A\u5B58\u50A8\u64CD\u4F5C\u5931\u8D25`, error));
              try {
                tx.abort();
              } catch {
              }
            }
          },
          (error) => fail(localAudioError(`${failureMessage}\uFF1A${detailOf2(error)}`, error))
        );
      });
    }
    function readAllRecords(store, setValue, fail) {
      let all = null;
      try {
        if (typeof store.getAll === "function") all = store.getAll();
      } catch {
        all = null;
      }
      if (all) {
        all.onsuccess = () => setValue(Array.isArray(all.result) ? all.result : []);
        all.onerror = () => fail(localAudioError(`${READ_FAILED}\uFF1A\u5B58\u50A8\u8FD4\u56DE\u9519\u8BEF`, all.error));
        return;
      }
      let cursorRequest;
      try {
        cursorRequest = store.openCursor();
      } catch (error) {
        fail(localAudioError(`${READ_FAILED}\uFF1A\u65E0\u6CD5\u904D\u5386\u5B58\u50A8`, error));
        return;
      }
      if (!cursorRequest) {
        fail(localAudioError(`${READ_FAILED}\uFF1A\u5B58\u50A8\u672A\u8FD4\u56DE\u6E38\u6807`));
        return;
      }
      const rows = [];
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          setValue(rows);
          return;
        }
        rows.push(cursor.value);
        try {
          cursor.continue();
        } catch (error) {
          fail(localAudioError(`${READ_FAILED}\uFF1A\u904D\u5386\u5B58\u50A8\u5931\u8D25`, error));
        }
      };
      cursorRequest.onerror = () => fail(localAudioError(`${READ_FAILED}\uFF1A\u904D\u5386\u5B58\u50A8\u5931\u8D25`, cursorRequest.error));
    }
    function normalizeKind(kind) {
      return typeof kind === "string" ? kind.trim() : "";
    }
    function isBlobLike(value) {
      return !!value && typeof value === "object" && typeof value.size === "number" && typeof value.type === "string";
    }
    function nameOf(value) {
      if (value && typeof value.name === "string" && value.name.trim() !== "") return value.name;
      const type = value && typeof value.type === "string" ? value.type : "";
      return `audio${TYPE_EXTENSIONS[type] || ""}`;
    }
    function normalizeRecord(value) {
      if (!value || typeof value !== "object") return null;
      const blob = value.blob;
      if (!isBlobLike(blob)) return null;
      const size = typeof value.size === "number" && Number.isFinite(value.size) ? value.size : blob.size;
      return {
        blob: (
          /** @type {Blob} */
          blob
        ),
        name: nameOf(value),
        type: typeof value.type === "string" ? value.type : typeof blob.type === "string" ? blob.type : "",
        size: typeof size === "number" && Number.isFinite(size) ? size : 0
      };
    }
    function localAudioError(message, cause) {
      let error;
      try {
        error = cause === void 0 ? new Error(message) : new Error(message, { cause });
      } catch {
        error = new Error(message);
      }
      error.name = ERROR_NAME;
      if (cause !== void 0) {
        try {
          if (error.cause === void 0) error.cause = cause;
        } catch {
        }
      }
      return error;
    }
    function asLocalAudioError(error, failureMessage) {
      if (error instanceof Error && error.name === ERROR_NAME) return error;
      return localAudioError(failureMessage, error);
    }
    function detailOf2(error) {
      if (error === void 0 || error === null) return "\u672A\u77E5\u539F\u56E0";
      let text;
      try {
        text = error instanceof Error ? error.message || error.name : String(error);
      } catch {
        text = "\u672A\u77E5\u539F\u56E0";
      }
      if (typeof text !== "string" || text === "") return "\u672A\u77E5\u539F\u56E0";
      return text.length > 160 ? `${text.slice(0, 157)}...` : text;
    }
    if (isLocalAudioSupported()) {
      void warmLocalAudioUrls().catch(() => null);
    }

    // src/client/assets.js
    function toPlayableUrl(src, source, kind, routePrefix = "/dsh-chime") {
      if (source === "local") {
        try {
          const key = typeof kind === "string" ? kind.trim() : "";
          if (key === "") return "";
          const url = getLocalAudioUrl(key);
          return typeof url === "string" ? url : "";
        } catch {
          return "";
        }
      }
      if (typeof src !== "string") return "";
      const value = src.trim();
      if (value === "") return "";
      if (source !== "file") return src;
      return `${routePrefix}/asset?path=${encodeURIComponent(value)}`;
    }
    function createFileBrowser(ctx, { routePrefix = "/dsh-chime" } = {}) {
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
          if (!workspace || typeof workspace.pickDirectory !== "function") {
            throw new Error("\u6253\u5F00\u76EE\u5F55\u9009\u62E9\u5668\u5931\u8D25\uFF1A\u5F53\u524D\u73AF\u5883\u6CA1\u6709\u53EF\u7528\u7684 uiWorkspace \u670D\u52A1");
          }
          let picked;
          try {
            picked = await workspace.pickDirectory();
          } catch (error) {
            throw assetError(`\u6253\u5F00\u76EE\u5F55\u9009\u62E9\u5668\u5931\u8D25\uFF1A${messageOf(error)}`, error);
          }
          if (picked === null) return null;
          if (typeof picked !== "string" || picked.trim() === "") {
            throw new Error("\u6253\u5F00\u76EE\u5F55\u9009\u62E9\u5668\u5931\u8D25\uFF1AuiWorkspace.pickDirectory() \u8FD4\u56DE\u4E86\u975E\u6CD5\u8DEF\u5F84");
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
          const dir = typeof path === "string" ? path.trim() : "";
          if (dir === "") {
            throw new Error("\u5217\u51FA\u76EE\u5F55\u5931\u8D25\uFF1A\u76EE\u5F55\u8DEF\u5F84\u4E3A\u7A7A");
          }
          if (typeof fetch !== "function") {
            throw new Error("\u5217\u51FA\u76EE\u5F55\u5931\u8D25\uFF1A\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 fetch");
          }
          const url = `${routePrefix}/list?path=${encodeURIComponent(dir)}`;
          const init = signal === void 0 || signal === null ? {} : { signal };
          let response;
          try {
            response = await fetch(url, init);
          } catch (error) {
            throw assetError(`\u5217\u51FA\u76EE\u5F55\u5931\u8D25\uFF1A${dir}\uFF08${messageOf(error)}\uFF09`, error);
          }
          if (!httpOk(response)) {
            throw new Error(`\u5217\u51FA\u76EE\u5F55\u5931\u8D25\uFF1A${dir}\uFF08${await httpFailureDetail(response)}\uFF09`);
          }
          let payload;
          try {
            payload = await response.json();
          } catch (error) {
            throw assetError(`\u5217\u51FA\u76EE\u5F55\u5931\u8D25\uFF1A${dir}\uFF08\u54CD\u5E94\u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${messageOf(error)}\uFF09`, error);
          }
          if (!payload || typeof payload !== "object" || !Array.isArray(payload.entries)) {
            throw new Error(`\u5217\u51FA\u76EE\u5F55\u5931\u8D25\uFF1A${dir}\uFF08host \u672A\u8FD4\u56DE\u76EE\u5F55\u6761\u76EE\uFF09`);
          }
          const files = [];
          const directories = [];
          for (const entry of payload.entries) {
            if (!entry || typeof entry !== "object") continue;
            const name = entryName(entry);
            if (name === "") continue;
            const target = entryPath(entry, dir, name);
            if (entry.type === "file") files.push({ name, path: target, size: 0 });
            else if (entry.type === "directory") directories.push({ name, path: target });
          }
          return browseResult(files, directories, true, payload.truncated === true);
        }
      };
    }
    function uiWorkspaceService(ctx) {
      try {
        if (!ctx || typeof ctx.get !== "function") return null;
        const service = ctx.get("uiWorkspace");
        return service && typeof service === "object" ? service : null;
      } catch {
        return null;
      }
    }
    function httpOk(response) {
      if (response && response.ok === true) return true;
      const status = response && typeof response.status === "number" ? response.status : NaN;
      return Number.isFinite(status) && status >= 200 && status < 300;
    }
    async function httpFailureDetail(response) {
      const base = httpDetail(response);
      const message = await errorBodyMessage(response);
      return message === "" ? base : `${base}: ${message}`;
    }
    async function errorBodyMessage(response) {
      try {
        if (!response || typeof response.json !== "function") return "";
        const payload = await response.json();
        if (payload && typeof payload === "object" && typeof payload.error === "string") {
          return payload.error.trim();
        }
      } catch {
      }
      return "";
    }
    function httpDetail(response) {
      const status = response && typeof response.status === "number" ? response.status : void 0;
      if (status === void 0) return "\u54CD\u5E94\u65E0\u6548\uFF08\u6CA1\u6709 HTTP \u72B6\u6001\u7801\uFF09";
      const text = response && typeof response.statusText === "string" ? response.statusText.trim() : "";
      return text === "" ? `HTTP ${status}` : `HTTP ${status} ${text}`;
    }
    function browseResult(files, directories, enumerable, truncated = false) {
      files.sort(compareByName);
      directories.sort(compareByName);
      return {
        files,
        directories,
        enumerable: enumerable === true,
        truncated: truncated === true
      };
    }
    function entryName(entry) {
      if (!entry || typeof entry !== "object") return "";
      if (typeof entry.name === "string" && entry.name !== "") return entry.name;
      return typeof entry.path === "string" ? baseName(entry.path) : "";
    }
    function entryPath(entry, dir, name) {
      if (entry && typeof entry.path === "string" && entry.path !== "") return entry.path;
      return joinPath(dir, name);
    }
    function baseName(path) {
      const value = String(path);
      const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
      return index >= 0 ? value.slice(index + 1) : value;
    }
    function joinPath(dir, name) {
      const separator = dir.includes("\\") ? "\\" : "/";
      const base = dir.endsWith("/") || dir.endsWith("\\") ? dir.slice(0, -1) : dir;
      return `${base}${separator}${name}`;
    }
    function compareByName(a, b) {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    }
    function assetError(message, cause) {
      try {
        return new Error(message, { cause });
      } catch {
        const error = new Error(message);
        try {
          error.cause = cause;
        } catch {
        }
        return error;
      }
    }
    function messageOf(error) {
      if (error instanceof Error) return error.message || error.name || "\u672A\u77E5\u9519\u8BEF";
      if (typeof error === "string") return error;
      if (error && typeof error === "object") {
        const code = typeof error.code === "string" ? error.code : "";
        const message = typeof error.message === "string" ? error.message : "";
        if (code && message) return `${code}: ${message}`;
        if (message) return message;
        if (code) return code;
      }
      try {
        return String(error);
      } catch {
        return "\u672A\u77E5\u9519\u8BEF";
      }
    }

    // src/client/locale.js
    var NS = "dshChime";
    var zh = {
      // —— 表头引导 ——
      formatHint: "\u7C98\u8D34 http(s) \u7F51\u7EDC\u94FE\u63A5\uFF0C\u6216\u672C\u5730\u97F3\u9891\u6587\u4EF6\u7684\u5B8C\u6574\u8DEF\u5F84\uFF08Linux/macOS \u5982 /home/you/ding.mp3\uFF0CWindows \u5982 E:\\Sounds\\ding.mp3\uFF09\u3002\u63D2\u4EF6\u4E0D\u4F1A\u590D\u5236\u4F60\u7684\u6587\u4EF6\u3002",
      // —— 顶层开关 ——
      enabled: "\u542F\u7528\u63D0\u793A\u97F3",
      enabledHint: "\u603B\u5F00\u5173\u5DF2\u5173\u95ED\uFF0C\u6240\u6709\u4E8B\u4EF6\u90FD\u4E0D\u4F1A\u53D1\u58F0\uFF08\u8BD5\u542C\u4ECD\u53EF\u7528\uFF09\u3002",
      // —— 提醒时机（会话维度 × 窗口焦点维度，CONTRACT §3.7）——
      attentionSoundLabel: "\u97F3\u6548\u63D0\u9192\u65F6\u673A",
      attentionNotifyLabel: "\u901A\u77E5\u63D0\u9192\u65F6\u673A",
      policy_current_only: "\u53EA\u770B\u5F53\u524D\u4F1A\u8BDD",
      policy_current_only_hint: "\u5F53\u524D\u6253\u5F00\u7684\u4F1A\u8BDD\u6709\u4E8B\u5C31\u63D0\u9192\uFF0C\u5176\u4ED6\u4F1A\u8BDD\u4E0D\u6253\u6270\u3002",
      policy_away: "\u53EA\u5728\u6211\u4E0D\u5728 DSH \u65F6",
      policy_away_hint: "\u4F60\u6B63\u770B\u7740 DSH \u65F6\u4E0D\u63D0\u9192\uFF0C\u5207\u8D70\u4E4B\u540E\u624D\u63D0\u9192 \u2014\u2014 \u5BF9\u9F50 Codex \u684C\u9762\u7AEF\u7684\u9ED8\u8BA4\u7B56\u7565\u3002",
      policy_away_or_other: "\u6211\u4E0D\u5728\uFF0C\u6216\u4E8B\u60C5\u5728\u522B\u7684\u4F1A\u8BDD",
      policy_away_or_other_hint: "\u63A8\u8350\uFF1A\u4F60\u6B63\u76EF\u7740\u90A3\u6761\u4F1A\u8BDD\u65F6\u4E0D\u6253\u6270\uFF0C\u5176\u4F59\u60C5\u51B5\u4E00\u5F8B\u63D0\u9192\uFF0C\u4E0D\u4F1A\u6F0F\u6389\u540E\u53F0\u4F1A\u8BDD\u3002",
      policy_always: "\u603B\u662F\u63D0\u9192",
      policy_always_hint: "\u4EFB\u4F55\u4F1A\u8BDD\u3001\u4EFB\u4F55\u65F6\u5019\u90FD\u63D0\u9192\u3002",
      policy_never: "\u4ECE\u4E0D\u63D0\u9192",
      policy_never_hint: "\u8FD9\u6761\u901A\u9053\u5F7B\u5E95\u9759\u97F3\u3002",
      policy_short_current_only: "\u4EC5\u5F53\u524D\u4F1A\u8BDD",
      policy_short_away: "\u4EC5\u79BB\u5F00\u65F6",
      policy_short_away_or_other: "\u79BB\u5F00\u6216\u6709\u65B0\u60C5\u51B5",
      policy_short_always: "\u5168\u90E8\u63D0\u9192",
      policy_short_never: "\u9759\u97F3",
      // —— 通用配置（两条通道共用的安静规则）——
      configSectionTitle: "\u901A\u7528\u914D\u7F6E",
      maxDepthLabel: "\u6700\u6DF1\u54CD\u5E94\u7684\u5BF9\u8BDD\u5C42\u7EA7",
      maxDepthUnit: "\u5C42\uFF080 = \u53EA\u6709\u4E3B\u5BF9\u8BDD\uFF09",
      maxDepthHint: "0 = \u53EA\u6709\u4E3B\u5BF9\u8BDD\uFF1B1 = \u4E3B\u5BF9\u8BDD\u548C\u5B83\u7684\u76F4\u63A5\u5B50\u4EE3\u7406\uFF1B\u4F9D\u6B64\u7C7B\u63A8\u3002\u5C42\u7EA7\u66F4\u6DF1\u7684\u4E8B\u4EF6\u4E0D\u63D0\u9192\uFF08\u97F3\u6548\u548C\u901A\u77E5\u90FD\u8DF3\u8FC7\uFF09\u3002",
      // —— 系统通知（独立于音效的第二条通道）——
      notifyTitle: "\u7CFB\u7EDF\u901A\u77E5",
      notifyHint: "\u4E8B\u4EF6\u53D1\u751F\u65F6\u5F39\u4E00\u6761\u7CFB\u7EDF\u901A\u77E5\u3002\u5B83\u4E0E\u97F3\u6548\u662F\u4E24\u6761\u72EC\u7ACB\u901A\u9053\uFF0C\u63D0\u9192\u65F6\u673A\u5355\u72EC\u8BBE\u7F6E\u3002",
      notifyEnable: "\u542F\u7528\u7CFB\u7EDF\u901A\u77E5",
      notifyPerKind: "\u53D1\u9001\u7CFB\u7EDF\u901A\u77E5",
      notifyPerKindOff: "\u901A\u77E5\u603B\u5F00\u5173\u672A\u5F00\uFF0C\u8FD9\u91CC\u52FE\u4E86\u4E5F\u6682\u65F6\u4E0D\u751F\u6548\u3002",
      notifyRequest: "\u6388\u6743",
      notifyRequesting: "\u8BF7\u6C42\u4E2D\u2026",
      notifyPermissionDefault: "\u5C1A\u672A\u6388\u6743\uFF0C\u70B9\u300C\u6388\u6743\u300D\u540E\u7CFB\u7EDF\u624D\u4F1A\u5F39\u51FA\u901A\u77E5\u3002",
      notifyPermissionGranted: "\u5DF2\u6388\u6743\u3002",
      notifyPermissionDenied: "\u5DF2\u88AB\u7CFB\u7EDF\u62D2\u7EDD\uFF0C\u9700\u8981\u5230\u7CFB\u7EDF\u8BBE\u7F6E\u91CC\u91CD\u65B0\u5141\u8BB8\u3002",
      notifyPermissionUnsupported: "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u7CFB\u7EDF\u901A\u77E5\u3002",
      notifyTest: "\u6D4B\u8BD5\u901A\u77E5",
      notifyTestReady: "\u5DF2\u53D1\u51FA\u3002\u5982\u679C\u7CFB\u7EDF\u6CA1\u5F39\u51FA\u6765\uFF0C\u90A3\u5C31\u662F\u7CFB\u7EDF\u901A\u77E5\u8BBE\u7F6E\uFF08\u4E13\u6CE8\u52A9\u624B / \u901A\u77E5\u6743\u9650\uFF09\u628A\u5B83\u62E6\u4F4F\u4E86\u3002",
      notifyTestDisabled: "\u6CA1\u5F39\uFF1A\u901A\u77E5\u603B\u5F00\u5173\u5173\u7740\u3002",
      notifyTestKindOff: "\u6CA1\u5F39\uFF1A\u8FD9\u4E00\u7C7B\u4E8B\u4EF6\u7684\u901A\u77E5\u5F00\u5173\u6CA1\u52FE\u3002",
      notifyTestUnsupported: "\u6CA1\u5F39\uFF1A\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u7CFB\u7EDF\u901A\u77E5\u3002",
      notifyTestPermission: "\u6CA1\u5F39\uFF1A\u6743\u9650\u72B6\u6001\u662F {state}\u3002",
      notifyTestConfigError: "\u6CA1\u5F39\uFF1A\u8BFB\u4E0D\u5230\u914D\u7F6E\uFF08\u5185\u90E8\u9519\u8BEF\uFF09\u3002",
      notifyTestUnknownKind: "\u6CA1\u5F39\uFF1A\u672A\u77E5\u7684\u4E8B\u4EF6\u7C7B\u578B\uFF08\u5185\u90E8\u9519\u8BEF\uFF09\u3002",
      notifyTestDisposed: "\u6CA1\u5F39\uFF1A\u63D2\u4EF6\u5DF2\u505C\u7528\u3002",
      // —— 实验性：点击通知把桌面窗口带到前台（CONTRACT §4.7）——
      notifyRaiseWindow: "\u70B9\u51FB\u901A\u77E5\u65F6\u628A\u7A97\u53E3\u5E26\u5230\u524D\u53F0",
      notifyRaiseWindowHint: "\u5B9E\u9A8C\u6027\u529F\u80FD\uFF0C\u9ED8\u8BA4\u5173\u95ED\u3002Windows \u4F1A\u6062\u590D\u6700\u5C0F\u5316\u7A97\u53E3\uFF0C\u5E76\u901A\u8FC7\u684C\u9762\u5916\u58F3\u663E\u793A\u5173\u95ED\u5230\u6258\u76D8\u7684\u7A97\u53E3\uFF0C\u518D\u6821\u9A8C\u5B9E\u9645\u524D\u53F0\u72B6\u6001\u3002\u666E\u901A\u540E\u53F0\u4ECD\u65E0\u6CD5\u6FC0\u6D3B\u65F6\uFF0C\u4F1A\u77ED\u6682\u6700\u5C0F\u5316\u540E\u6062\u590D\u4E00\u6B21\uFF0C\u53EF\u80FD\u95EA\u52A8\uFF1B\u7CFB\u7EDF\u4ECD\u53EF\u80FD\u62D2\u7EDD\u6FC0\u6D3B\u3002macOS / Linux \u8D70 dsh://open\u3002\u5E76\u53D1\u70B9\u51FB\u5171\u4EAB\u4E00\u4E2A\u77ED\u547D\u8F85\u52A9\u8FDB\u7A0B\u3002\u4EC5 Desktop \u5B89\u88C5\u6709\u6548\uFF0CWeb \u7248\u4F1A\u5FFD\u7565\u3002",
      experimentalTag: "\u5B9E\u9A8C\u6027",
      notify_kind_approval_title: "DSH \xB7 \u7B49\u5F85\u6388\u6743",
      notify_kind_approval_body: "\u6709\u5DE5\u5177\u8C03\u7528\u5728\u7B49\u4F60\u7684\u6279\u51C6\u3002",
      notify_kind_question_title: "DSH \xB7 \u5F85\u56DE\u7B54",
      notify_kind_question_body: "\u6709\u4E2A\u95EE\u9898\u5728\u7B49\u4F60\u56DE\u590D\u3002",
      notify_kind_interrupted_title: "DSH \xB7 \u5DF2\u4E2D\u65AD",
      notify_kind_interrupted_body: "\u5BF9\u8BDD\u56E0\u9519\u8BEF\u65E0\u6CD5\u7EE7\u7EED\u3002",
      notify_kind_completed_title: "DSH \xB7 \u5DF2\u5B8C\u6210",
      notify_kind_completed_body: "\u4EFB\u52A1\u7ED3\u675F\u4E86\u3002",
      notifyBodyFromSession: "\u6765\u81EA\u4F1A\u8BDD \u2014\u2014\u300C{session}\u300D",
      // —— 四类事件 ——
      kind_approval_label: "\u6743\u9650\u5BA1\u6279",
      kind_approval_hint: "\u7B49\u5F85\u4F60\u6279\u51C6\u5DE5\u5177\u8C03\u7528\u65F6\u3002",
      kind_question_label: "\u56DE\u7B54\u95EE\u9898",
      kind_question_hint: "\u63D0\u95EE\u6216\u8BA1\u5212\u5BA1\u6279\u7B49\u5F85\u4F60\u56DE\u590D\u65F6\u3002",
      kind_interrupted_label: "\u4E2D\u65AD",
      kind_interrupted_hint: "\u5BF9\u8BDD\u56E0\u9519\u8BEF\u65E0\u6CD5\u7EE7\u7EED\u65F6\uFF08\u81EA\u52A8\u91CD\u8BD5\u4E0D\u7B97\uFF09\u3002",
      kind_completed_label: "\u5B8C\u6210",
      kind_completed_hint: "\u4EFB\u52A1\u771F\u6B63\u7ED3\u675F\uFF08\u65E0\u5B50\u4EE3\u7406\u3001\u65E0\u540E\u53F0\u4EFB\u52A1\uFF09\u65F6\u3002",
      // —— 每一行的控件 ——
      srcPlaceholder: "\u672A\u8BBE\u7F6E\uFF08\u4E0D\u54CD\uFF09",
      volume: "\u97F3\u91CF",
      preview: "\u8BD5\u542C",
      clear: "\u6E05\u9664",
      // —— 「完成」卡片的最短任务时长门槛 ——
      completionMinLabel: "\u6700\u77ED\u4EFB\u52A1\u65F6\u957F",
      completionMinUnit: "\u79D2\uFF080 = \u603B\u662F\u54CD\uFF09",
      completionMinHint: "\u8DDD\u4E0A\u4E00\u6B21\u7528\u6237\u8F93\u5165\u4E0D\u8DB3\u8FD9\u4E2A\u79D2\u6570\u65F6\uFF0C\u300C\u5B8C\u6210\u300D\u4E0D\u63D0\u9192\uFF08\u97F3\u6548\u548C\u901A\u77E5\u90FD\u8DF3\u8FC7\uFF09\uFF0C\u907F\u514D\u5C0F\u4EFB\u52A1\u9891\u7E41\u6253\u6270\u3002",
      // —— 行内错误 ——
      actionFailed: "\u64CD\u4F5C\u5931\u8D25",
      previewEmpty: "\u672A\u8BBE\u7F6E\u97F3\u6548\uFF0C\u65E0\u6CD5\u8BD5\u542C\u3002",
      previewUnsupported: "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u8BD5\u542C\u3002",
      previewFailed: "\u8BD5\u542C\u5931\u8D25\uFF1A\u65E0\u6CD5\u64AD\u653E\u8BE5\u97F3\u6E90\u3002",
      previewFailedReason: "\u8BD5\u542C\u5931\u8D25\uFF1A{message}",
      // —— 页脚与摘要卡片 ——
      storageHint: "\u94FE\u63A5\u652F\u6301 http(s) \u5730\u5740\u6216\u672C\u5730\u7EDD\u5BF9\u8DEF\u5F84\uFF1B\u6539\u52A8\u5373\u65F6\u751F\u6548\u5E76\u4FDD\u5B58\u5728\u672C\u673A\u6D4F\u89C8\u5668\u3002",
      summaryCount: "{total} \u9879\u4E2D\u5DF2\u914D\u7F6E {configured} \u9879",
      summaryEnabled: "\u63D0\u793A\u97F3\u5DF2\u542F\u7528",
      summaryDisabled: "\u63D0\u793A\u97F3\u5DF2\u505C\u7528",
      summaryNotifyOn: "\u7CFB\u7EDF\u901A\u77E5\u5DF2\u5F00"
    };
    var en = {
      // —— Header guidance ——
      formatHint: "Paste an http(s) link, or the full path to a local audio file (e.g. /home/you/ding.mp3 on Linux/macOS, E:\\Sounds\\ding.mp3 on Windows). The plugin never copies your file.",
      // —— Global switches ——
      enabled: "Enable sounds",
      enabledHint: "Sounds are turned off globally \u2014 no event will play (preview still works).",
      // —— Attention timing (session × window focus, CONTRACT §3.7) ——
      attentionSoundLabel: "Sound timing",
      attentionNotifyLabel: "Notification timing",
      policy_current_only: "Only the current session",
      policy_current_only_hint: "Ring when the session you have open has news; leave the others alone.",
      policy_away: "Only when I am away from DSH",
      policy_away_hint: "Stay quiet while you are looking at DSH, ring once you switch away \u2014 the Codex desktop default.",
      policy_away_or_other: "When I am away, or it is another session",
      policy_away_or_other_hint: "Recommended: quiet only while you are actually looking at that session; everything else rings, so background sessions are never missed.",
      policy_always: "Always",
      policy_always_hint: "Ring for any session, at any time.",
      policy_never: "Never",
      policy_never_hint: "Mute this channel entirely.",
      policy_short_current_only: "current session only",
      policy_short_away: "only when away",
      policy_short_away_or_other: "away or other sessions",
      policy_short_always: "everything",
      policy_short_never: "muted",
      // —— General (quiet rules shared by both channels) ——
      configSectionTitle: "General",
      maxDepthLabel: "Maximum session depth",
      maxDepthUnit: "levels (0 = main session only)",
      maxDepthHint: "0 notifies only for the main session; 1 also for its direct subagents, and so on. Events from deeper sessions are skipped on both channels.",
      // —— System notifications (a second, independent channel) ——
      notifyTitle: "System notifications",
      notifyHint: "Show a desktop notification when an event fires. It is a second channel, independent of sound, with its own timing policy.",
      notifyEnable: "Enable system notifications",
      notifyPerKind: "Send a notification",
      notifyPerKindOff: "The notification master switch is off, so this does not take effect yet.",
      notifyRequest: "Allow",
      notifyRequesting: "Requesting\u2026",
      notifyPermissionDefault: 'Not allowed yet \u2014 press "Allow" so the system can show them.',
      notifyPermissionGranted: "Allowed.",
      notifyPermissionDenied: "Blocked by the system; re-allow it in your system settings.",
      notifyPermissionUnsupported: "System notifications are not available in this environment.",
      notifyTest: "Test notification",
      notifyTestReady: "Sent. If nothing appeared, your system notification settings (Focus Assist / notification permission) are holding it back.",
      notifyTestDisabled: "Not sent: the notification master switch is off.",
      notifyTestKindOff: "Not sent: this event type is not ticked.",
      notifyTestUnsupported: "Not sent: this environment does not support system notifications.",
      notifyTestPermission: "Not sent: permission state is {state}.",
      notifyTestConfigError: "Not sent: the configuration could not be read (internal error).",
      notifyTestUnknownKind: "Not sent: unknown event type (internal error).",
      notifyTestDisposed: "Not sent: the plugin has been disposed.",
      notifyRaiseWindow: "Bring the window to the front on click",
      notifyRaiseWindowHint: "Experimental, off by default. Windows restores minimized windows and asks the desktop shell to show tray-hidden windows, then verifies foreground activation. If a visible background window still cannot be activated, one brief minimize/restore cycle may cause flicker; the OS can still deny activation. macOS and Linux use dsh://open. Concurrent clicks share a short-lived helper process. Desktop installs only \u2014 the browser ignores it.",
      experimentalTag: "Experimental",
      notify_kind_approval_title: "DSH \xB7 Approval needed",
      notify_kind_approval_body: "A tool call is waiting for your approval.",
      notify_kind_question_title: "DSH \xB7 Answer needed",
      notify_kind_question_body: "A question is waiting for your reply.",
      notify_kind_interrupted_title: "DSH \xB7 Interrupted",
      notify_kind_interrupted_body: "The conversation could not continue because of an error.",
      notify_kind_completed_title: "DSH \xB7 Finished",
      notify_kind_completed_body: "The task has finished.",
      notifyBodyFromSession: 'From session \u2014 "{session}"',
      // —— The four events ——
      kind_approval_label: "Approval",
      kind_approval_hint: "While a tool call is waiting for your approval.",
      kind_question_label: "Question",
      kind_question_hint: "While a question or plan review is waiting for your answer.",
      kind_interrupted_label: "Interrupted",
      kind_interrupted_hint: "When a conversation cannot continue because of an error (automatic retries do not count).",
      kind_completed_label: "Completion",
      kind_completed_hint: "When a task truly finishes (no subagents, no background jobs running).",
      // —— Per-row controls ——
      srcPlaceholder: "Not set (silent)",
      volume: "Volume",
      preview: "Preview",
      clear: "Clear",
      // —— Completion card: minimum task duration ——
      completionMinLabel: "Minimum task duration",
      completionMinUnit: "seconds (0 = always ring)",
      completionMinHint: "Skip the completion event \u2014 on both channels \u2014 when less than this many seconds have passed since your last message, so small tasks stay quiet.",
      // —— Inline errors ——
      actionFailed: "Operation failed",
      previewEmpty: "No sound is set, so there is nothing to preview.",
      previewUnsupported: "Preview is not available in this environment.",
      previewFailed: "Preview failed: this audio source could not be played.",
      previewFailedReason: "Preview failed: {message}",
      // —— Footer and summary card ——
      storageHint: "Links may be http(s) URLs or absolute local paths; changes take effect immediately and are stored in this browser.",
      summaryCount: "{configured} of {total} configured",
      summaryEnabled: "Sounds on",
      summaryDisabled: "Sounds off",
      summaryNotifyOn: "notifications on"
    };

    // src/client/detect.js
    var COMPLETION_DEBOUNCE_MS = 1200;
    var DEFAULT_POLL_MS = 400;
    var MAX_SESSION_DEPTH = 32;
    function shouldDeliver(policy, isActiveSession, focused) {
      switch (policy) {
        case "always":
          return true;
        case "never":
          return false;
        case "away":
          return !focused;
        case "away-or-other":
          return !focused || !isActiveSession;
        case "current-only":
        default:
          return isActiveSession;
      }
    }
    var ACTIVE_JOB_STATUSES = /* @__PURE__ */ new Set(["running", "stopping"]);
    var EMPTY_LIST = Object.freeze({
      ids: Object.freeze([]),
      byId: Object.freeze({}),
      projectionsBySession: Object.freeze({}),
      phase: "pending"
    });
    function defaultOnError(error, where) {
      try {
        globalThis.console?.warn?.(`[dsh-chime] ${where}`, error);
      } catch {
      }
    }
    function createSessionState() {
      return {
        pendingKind: void 0,
        errorFired: false,
        seenActive: false,
        armAt: null,
        timer: null
      };
    }
    function readFrom(source, id) {
      if (source === null || source === void 0) return void 0;
      if (typeof source.get === "function") return source.get(id);
      return source[id];
    }
    function addKeys(source, out) {
      if (source === null || source === void 0) return out;
      if (typeof source.keys === "function" && typeof source.get === "function") {
        for (const key of source.keys()) out.add(key);
        return out;
      }
      for (const key of Object.keys(source)) out.add(key);
      return out;
    }
    function collectSessionIds(statuses, list) {
      const ids = /* @__PURE__ */ new Set();
      addKeys(statuses, ids);
      if (Array.isArray(list?.ids)) for (const id of list.ids) ids.add(id);
      addKeys(list?.byId, ids);
      return ids;
    }
    function normalizePendingKind(kind) {
      switch (kind) {
        case "approval":
          return "approval";
        case "question":
        case "plan-review":
          return "question";
        default:
          return void 0;
      }
    }
    function runningChildCount(list, parentId, statuses) {
      const catalog = list?.projectionsBySession?.[parentId]?.values?.subagentCatalog;
      if (!Array.isArray(catalog)) return 0;
      let count = 0;
      for (const child of catalog) {
        const childId = child?.id;
        if (childId === void 0) continue;
        const running = readFrom(statuses, childId)?.running ?? list?.byId?.[childId]?.running;
        if (running === true) count += 1;
      }
      return count;
    }
    function readActiveJobs(activeJobs, id) {
      const raw = readFrom(activeJobs, id);
      if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, raw) : 0;
      if (!Array.isArray(raw)) return 0;
      let count = 0;
      for (const item of raw) {
        if (typeof item === "number") {
          if (item > 0) count += 1;
        } else if (ACTIVE_JOB_STATUSES.has(item?.status)) {
          count += 1;
        }
      }
      return count;
    }
    function createDetector(deps) {
      const {
        getStatuses = () => /* @__PURE__ */ new Map(),
        getSessionList = () => EMPTY_LIST,
        countActiveJobs = async () => 0,
        onChime = () => {
        },
        getConfig = () => ({}),
        getAgentError = null,
        getSessionSnapshot = null,
        getLastUserMessageTime = null,
        isFocused = () => true,
        now = () => Date.now(),
        setTimeout: schedule = (fn, ms) => setTimeout(fn, ms),
        clearTimeout: cancel = (handle) => clearTimeout(handle),
        debounceMs: rawDebounceMs = COMPLETION_DEBOUNCE_MS,
        pollMs: rawPollMs = DEFAULT_POLL_MS,
        onError = defaultOnError
      } = deps ?? {};
      const debounceMs = typeof rawDebounceMs === "number" && Number.isFinite(rawDebounceMs) && rawDebounceMs >= 0 ? rawDebounceMs : COMPLETION_DEBOUNCE_MS;
      const pollMs = typeof rawPollMs === "number" && Number.isFinite(rawPollMs) && rawPollMs > 0 ? rawPollMs : DEFAULT_POLL_MS;
      const states = /* @__PURE__ */ new Map();
      const jobCounts = /* @__PURE__ */ new Map();
      const depthCache = /* @__PURE__ */ new Map();
      let lastData = { statuses: /* @__PURE__ */ new Map(), list: EMPTY_LIST, activeJobs: /* @__PURE__ */ new Map() };
      let disposed = false;
      let started = false;
      let ticking = false;
      let pollHandle = null;
      let pendingTick = false;
      function report(error, where) {
        try {
          onError(error, where);
        } catch {
        }
      }
      function stateOf(id) {
        let state = states.get(id);
        if (state === void 0) {
          state = createSessionState();
          states.set(id, state);
        }
        return state;
      }
      function cancelArm(state) {
        if (state.timer !== null) {
          try {
            cancel(state.timer);
          } catch (error) {
            report(error, "clearTimeout");
          }
          state.timer = null;
        }
        state.armAt = null;
      }
      function armCompletion(id, state, nowMs) {
        state.armAt = nowMs;
        const onDeadline = () => {
          state.timer = null;
          if (disposed) return;
          if (started) {
            void tick();
          } else {
            evaluate(lastData.statuses, lastData.list, lastData.activeJobs);
          }
          if (!disposed && state.armAt !== null && state.timer === null) {
            const remaining = debounceMs - (now() - state.armAt);
            if (remaining > 0) {
              state.timer = schedule(onDeadline, remaining);
            }
          }
        };
        try {
          state.timer = schedule(onDeadline, debounceMs);
        } catch (error) {
          report(error, "setTimeout");
          state.timer = null;
        }
      }
      function agentErrorFor(id, status, row) {
        const direct = status?.lastAgentError ?? row?.lastAgentError;
        if (direct !== void 0 && direct !== null && direct !== false) return direct;
        if (typeof getAgentError === "function") {
          try {
            const value = getAgentError(id);
            if (value !== void 0 && value !== null && value !== false) return value;
          } catch (error) {
            report(error, "getAgentError");
          }
        }
        if (typeof getSessionSnapshot === "function") {
          try {
            const value = getSessionSnapshot(id)?.lastAgentError;
            if (value !== void 0 && value !== null && value !== false) return value;
          } catch (error) {
            report(error, "getSessionSnapshot");
          }
        }
        return null;
      }
      function lastUserMessageTimeFor(id) {
        if (typeof getLastUserMessageTime !== "function") return void 0;
        try {
          const value = getLastUserMessageTime(id);
          return typeof value === "number" ? value : void 0;
        } catch (error) {
          report(error, "getLastUserMessageTime");
          return void 0;
        }
      }
      function completionTooShort(id, nowMs, config) {
        const min = Number(config?.completionMinSeconds);
        if (!Number.isFinite(min) || min <= 0) return false;
        const startedAt = lastUserMessageTimeFor(id);
        if (!Number.isFinite(startedAt)) return false;
        return nowMs - startedAt < min * 1e3;
      }
      function isSubagentRow(row) {
        return row?.origin === "subagent";
      }
      function computeSessionDepth(list, id) {
        const rows = list?.byId;
        if (rows === null || rows === void 0) return null;
        const first = rows[id];
        if (first === void 0 || first === null) return null;
        const seen = /* @__PURE__ */ new Set([id]);
        let depth = 0;
        let row = first;
        while (depth < MAX_SESSION_DEPTH) {
          const parentId = row?.parentSessionId;
          if (parentId === void 0 || parentId === null || parentId === "") break;
          const parentRow = rows[parentId];
          if (seen.has(parentId) || parentRow === void 0 || parentRow === null) {
            return isSubagentRow(first) ? 1 : null;
          }
          seen.add(parentId);
          row = parentRow;
          depth += 1;
        }
        if (depth === 0 && isSubagentRow(first)) return 1;
        return depth;
      }
      function sessionDepthOf(list, id) {
        const cached = depthCache.get(id);
        if (cached !== void 0) return cached;
        const depth = computeSessionDepth(list, id);
        if (typeof depth === "number") depthCache.set(id, depth);
        return depth;
      }
      function depthTooDeep(list, id, config) {
        const maxDepth = config?.maxDepth;
        if (typeof maxDepth !== "number" || !Number.isFinite(maxDepth) || maxDepth < 0) return false;
        const depth = sessionDepthOf(list, id);
        if (typeof depth !== "number") return false;
        return depth > maxDepth;
      }
      function evaluate(statuses, list, activeJobs) {
        if (disposed) return [];
        const sessionList = list ?? EMPTY_LIST;
        lastData = { statuses, list: sessionList, activeJobs };
        let config = {};
        try {
          config = getConfig() ?? {};
        } catch (error) {
          report(error, "getConfig");
          config = {};
        }
        const enabled = config.enabled !== false;
        const nowMs = now();
        const emitted = [];
        const ids = collectSessionIds(statuses, sessionList);
        for (const id of ids) {
          const state = stateOf(id);
          const status = readFrom(statuses, id);
          const row = sessionList.byId?.[id];
          const running = (status?.running ?? row?.running) === true;
          const pendingKind = normalizePendingKind(status?.pendingInteraction?.kind);
          const errorActive = Boolean(agentErrorFor(id, status, row));
          const childCount = runningChildCount(sessionList, id, statuses);
          const jobCount = readActiveJobs(activeJobs, id);
          const activeWork = running || childCount > 0 || jobCount > 0;
          const isActiveSession = row === void 0 || (row.retainedBy?.mainView ?? 0) > 0;
          let focused = true;
          try {
            focused = isFocused() === true;
          } catch (error) {
            report(error, "isFocused");
          }
          const sound = enabled && shouldDeliver(config.attention?.sound, isActiveSession, focused);
          const wantsNotify = config.notify?.enabled === true && shouldDeliver(config.attention?.notify, isActiveSession, focused);
          const reportable = sound || wantsNotify;
          if (activeWork) state.seenActive = true;
          if (!errorActive) state.errorFired = false;
          const approvalRising = pendingKind === "approval" && state.pendingKind !== "approval";
          const questionRising = pendingKind === "question" && state.pendingKind !== "question";
          const interruptedRising = errorActive && !running && !state.errorFired;
          let completed = false;
          const blocked = activeWork || pendingKind !== void 0;
          if (approvalRising || questionRising || interruptedRising) {
            cancelArm(state);
          } else if (blocked) {
            cancelArm(state);
          } else if (state.seenActive && state.armAt === null) {
            armCompletion(id, state, nowMs);
          } else if (state.seenActive && state.armAt !== null && nowMs - state.armAt >= debounceMs) {
            completed = true;
            state.seenActive = false;
            cancelArm(state);
          }
          state.pendingKind = pendingKind;
          if (interruptedRising) state.errorFired = true;
          const kind = approvalRising ? "approval" : questionRising ? "question" : interruptedRising ? "interrupted" : completed ? "completed" : null;
          if (kind === null) continue;
          if (!reportable) continue;
          if (kind === "completed" && completionTooShort(id, nowMs, config)) continue;
          if (depthTooDeep(sessionList, id, config)) continue;
          const event = { kind, sessionId: id, urgent: kind === "approval", sound, notify: wantsNotify };
          emitted.push(event);
          try {
            onChime(event);
          } catch (error) {
            report(error, "onChime");
          }
        }
        if (sessionList.phase === "ready") {
          for (const [id, state] of states) {
            if (ids.has(id)) continue;
            cancelArm(state);
            states.delete(id);
          }
          for (const id of [...depthCache.keys()]) {
            if (sessionList.byId?.[id] === void 0) depthCache.delete(id);
          }
        }
        return emitted;
      }
      async function refreshJobCounts(ids) {
        for (const id of ids) {
          try {
            const value = await countActiveJobs(id);
            if (typeof value === "number" && Number.isFinite(value)) {
              jobCounts.set(id, Math.max(0, value));
            } else if (Array.isArray(value)) {
              jobCounts.set(id, readActiveJobs(/* @__PURE__ */ new Map([[id, value]]), id));
            }
          } catch (error) {
            report(error, "countActiveJobs");
          }
        }
        return new Map(jobCounts);
      }
      function scheduleNextPoll() {
        if (disposed || !started || pollHandle !== null) return;
        pollHandle = schedule(() => {
          pollHandle = null;
          void tick();
        }, pollMs);
      }
      async function tick() {
        if (disposed) return;
        if (ticking) {
          pendingTick = true;
          return;
        }
        ticking = true;
        try {
          const list = getSessionList() ?? EMPTY_LIST;
          const ids = collectSessionIds(getStatuses(), list);
          if (list.phase === "ready") {
            for (const id of [...jobCounts.keys()]) if (!ids.has(id)) jobCounts.delete(id);
          }
          const activeJobs = await refreshJobCounts(ids);
          if (disposed) return;
          evaluate(getStatuses(), list, activeJobs);
        } catch (error) {
          report(error, "tick");
        } finally {
          ticking = false;
          const again = pendingTick;
          pendingTick = false;
          scheduleNextPoll();
          if (again && !disposed) void tick();
        }
      }
      function poke() {
        if (disposed) return;
        void tick();
      }
      function start() {
        if (started) return dispose;
        disposed = false;
        started = true;
        void tick();
        return dispose;
      }
      function dispose() {
        if (!disposed) {
          disposed = true;
          started = false;
          if (pollHandle !== null) {
            try {
              cancel(pollHandle);
            } catch (error) {
              report(error, "clearTimeout");
            }
            pollHandle = null;
          }
          for (const state of states.values()) cancelArm(state);
          states.clear();
          jobCounts.clear();
          depthCache.clear();
          pendingTick = false;
        }
      }
      return { start, poke, evaluate, dispose };
    }

    // src/client/notify.js
    var MAX_OPEN_NOTIFICATIONS = 16;
    function defaultOnError2(error, where) {
      try {
        globalThis.console?.warn?.(`[dsh-chime] ${where}`, error);
      } catch {
      }
    }
    function createNotifier(deps) {
      const {
        getConfig = () => ({}),
        NotificationCtor = globalThis.Notification,
        buildMessage = null,
        onClick = null,
        onError = defaultOnError2
      } = deps ?? {};
      const open = /* @__PURE__ */ new Set();
      let disposed = false;
      function report(error, where) {
        try {
          onError(error, where);
        } catch {
        }
      }
      function resolveCtor() {
        return typeof NotificationCtor === "function" ? NotificationCtor : null;
      }
      function supported() {
        return resolveCtor() !== null;
      }
      function permission() {
        const Ctor = resolveCtor();
        if (Ctor === null) return "unsupported";
        const value = Ctor.permission;
        return value === "granted" || value === "denied" ? value : "default";
      }
      async function requestPermission() {
        const Ctor = resolveCtor();
        if (Ctor === null) return "unsupported";
        if (typeof Ctor.requestPermission !== "function") return permission();
        try {
          const result = await Ctor.requestPermission();
          if (result === "granted" || result === "denied") return result;
          return permission();
        } catch (error) {
          report(error, "requestPermission");
          return permission();
        }
      }
      function messageFor(event) {
        if (typeof buildMessage === "function") {
          try {
            const built = buildMessage(event);
            if (built && typeof built.title === "string" && built.title.length > 0) {
              return { title: built.title, body: typeof built.body === "string" ? built.body : "" };
            }
          } catch (error) {
            report(error, "buildMessage");
          }
        }
        return { title: "DeepSeek Harness", body: String(event.kind) };
      }
      const MAX_TAG_LENGTH = 48;
      function tagFor(kind, sessionId) {
        const prefix = `dsh-chime:${kind}:`;
        const id = typeof sessionId === "string" ? sessionId : "";
        if (prefix.length + id.length <= MAX_TAG_LENGTH) return `${prefix}${id}`;
        const keep = Math.max(0, MAX_TAG_LENGTH - prefix.length);
        return `${prefix}${id.slice(id.length - keep)}`;
      }
      function track(notification, event) {
        open.add(notification);
        const forget = () => {
          open.delete(notification);
        };
        const closeQuietly = () => {
          try {
            notification.close?.();
          } catch {
          }
        };
        try {
          notification.onclose = forget;
          notification.onerror = forget;
          notification.onclick = () => {
            forget();
            if (typeof onClick === "function") {
              try {
                onClick(event);
              } catch (error) {
                report(error, "onclick");
              }
            }
            closeQuietly();
          };
        } catch (error) {
          report(error, "track");
        }
        while (open.size > MAX_OPEN_NOTIFICATIONS) {
          const oldest = open.values().next().value;
          open.delete(oldest);
        }
      }
      function explain(event) {
        if (disposed) return { ok: false, reason: "disposed" };
        const kind = event?.kind;
        if (typeof kind !== "string" || !CHIME_KINDS.includes(kind)) {
          return { ok: false, reason: "unknown-kind" };
        }
        let config;
        try {
          config = getConfig() ?? {};
        } catch (error) {
          report(error, "getConfig");
          return { ok: false, reason: "config-error" };
        }
        const notifyConfig = config.notify;
        if (!notifyConfig || notifyConfig.enabled !== true) return { ok: false, reason: "disabled" };
        if (notifyConfig.kinds?.[kind] !== true) return { ok: false, reason: "kind-off" };
        if (resolveCtor() === null) return { ok: false, reason: "unsupported" };
        const state = permission();
        if (state !== "granted") return { ok: false, reason: `permission-${state}` };
        return { ok: true, reason: "ready" };
      }
      function notify(event) {
        if (disposed) return false;
        const check = explain(event);
        if (!check.ok) {
          report(new Error(`notification skipped (${check.reason})`), "notify");
          return false;
        }
        const Ctor = resolveCtor();
        if (Ctor === null) return false;
        const { kind } = event;
        const message = messageFor(event);
        let notification;
        try {
          notification = new Ctor(message.title, {
            body: message.body,
            // 长度受控：超过 Windows toast 的 64 字符上限会被整条静默丢弃（见 tagFor）。
            tag: tagFor(kind, event.sessionId),
            silent: true
          });
        } catch (error) {
          report(error, "show");
          return false;
        }
        track(notification, event);
        return true;
      }
      function dispose() {
        if (disposed) return;
        disposed = true;
        for (const notification of open) {
          try {
            notification.close?.();
          } catch {
          }
        }
        open.clear();
      }
      return { supported, permission, requestPermission, explain, notify, dispose };
    }

    // src/client/presence.js
    function createPresence(deps) {
      const { doc = globalThis.document } = deps ?? {};
      function focused() {
        try {
          if (doc && typeof doc.hasFocus === "function") return doc.hasFocus();
        } catch {
        }
        return true;
      }
      function visible() {
        try {
          const state = doc?.visibilityState;
          if (typeof state === "string") return state !== "hidden";
        } catch {
        }
        return true;
      }
      return { focused, visible };
    }

    // src/client/settings.jsx
    var import_react = require("react");
    var import_jsx_runtime = require("react/jsx-runtime");
    var KIND_ORDER = ["approval", "question", "interrupted", "completed"];
    var FALLBACK_KIND = { src: "", volume: 0.8, source: "url" };
    var COMPLETION_MIN_FALLBACK = 10;
    var COMPLETION_MIN_MAX = 3600;
    var MAX_DEPTH_FALLBACK = 0;
    var MAX_DEPTH_MAX2 = 16;
    var ATTENTION_POLICY_ORDER = ["current-only", "away", "away-or-other", "always", "never"];
    var FALLBACK_NOTIFY = {
      enabled: false,
      kinds: { approval: true, question: true, interrupted: true, completed: true },
      raiseWindow: false
    };
    var FALLBACK_ATTENTION = {
      sound: "current-only",
      notify: "away-or-other"
    };
    var FALLBACK_CONFIG = {
      enabled: true,
      attention: FALLBACK_ATTENTION,
      completionMinSeconds: COMPLETION_MIN_FALLBACK,
      maxDepth: MAX_DEPTH_FALLBACK,
      notify: FALLBACK_NOTIFY,
      kinds: {
        approval: { ...FALLBACK_KIND },
        question: { ...FALLBACK_KIND },
        interrupted: { ...FALLBACK_KIND },
        completed: { ...FALLBACK_KIND }
      }
    };
    var styles = {
      panel: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        padding: "2px 0",
        color: "inherit",
        fontSize: "13px",
        lineHeight: 1.55
      },
      card: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "12px 14px",
        border: "1px solid rgba(127, 127, 127, 0.28)",
        borderRadius: "10px"
      },
      cardHead: {
        display: "flex",
        flexDirection: "column",
        gap: "2px"
      },
      kindLabel: {
        fontWeight: 600
      },
      /** 「实验性」小标签：让未成熟的功能在视觉上与正式项区分开。 */
      experimental: {
        padding: "0 6px",
        borderRadius: "999px",
        border: "1px solid rgba(127, 127, 127, 0.45)",
        fontSize: "11px",
        lineHeight: "18px",
        opacity: 0.7,
        whiteSpace: "nowrap"
      },
      hint: {
        opacity: 0.62,
        fontSize: "12px"
      },
      error: {
        margin: 0,
        fontSize: "12px",
        color: "#d9534f",
        opacity: 0.95
      },
      row: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap"
      },
      toggleRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px"
      },
      checkbox: {
        width: "15px",
        height: "15px",
        margin: 0,
        accentColor: "currentColor",
        cursor: "pointer"
      },
      input: {
        flex: "1 1 260px",
        minWidth: "180px",
        padding: "5px 8px",
        borderRadius: "6px",
        border: "1px solid rgba(127, 127, 127, 0.35)",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        fontSize: "12px"
      },
      button: {
        padding: "5px 10px",
        borderRadius: "6px",
        border: "1px solid rgba(127, 127, 127, 0.35)",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        fontSize: "12px",
        cursor: "pointer",
        whiteSpace: "nowrap"
      },
      volumeLabel: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "12px",
        opacity: 0.85,
        cursor: "pointer"
      },
      slider: {
        width: "130px",
        margin: 0,
        accentColor: "currentColor",
        cursor: "pointer"
      },
      volumeValue: {
        minWidth: "38px",
        fontSize: "12px",
        opacity: 0.75,
        fontVariantNumeric: "tabular-nums"
      },
      spacer: {
        flex: "1 1 auto"
      },
      /** 「完成」卡片的最短任务时长区块（标签 + number 输入框 + 说明）。 */
      completionMin: {
        display: "flex",
        flexDirection: "column",
        gap: "4px"
      },
      select: {
        padding: "5px 8px",
        borderRadius: "6px",
        border: "1px solid rgba(127, 127, 127, 0.35)",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        fontSize: "12px",
        maxWidth: "260px",
        // 折叠态跟随 DSH 主题；展开的原生弹层由系统绘制，由下面的 option 兜底。
        colorScheme: "light dark"
      },
      /**
       * 展开后的原生下拉项。
       *
       * 这里**不能**写 `inherit`：弹出列表由系统绘制，从 `select` 继承来的浅色文字会落在
       * 系统的浅色背景上，变成「白底浅字」而看不清。`Canvas` / `CanvasText` 是系统颜色
       * 关键字，随系统深浅色联动，至少保证任何主题组合下前景与背景是配对可读的。
       */
      option: {
        background: "Canvas",
        color: "CanvasText"
      },
      numberInput: {
        width: "92px",
        padding: "5px 8px",
        borderRadius: "6px",
        border: "1px solid rgba(127, 127, 127, 0.35)",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        fontSize: "12px"
      },
      summary: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        color: "inherit",
        fontSize: "12px",
        lineHeight: 1.5
      },
      summaryMuted: {
        opacity: 0.62
      }
    };
    function normalizeSource2(value, src) {
      if (value === "local") return String(src || "").trim() ? "local" : "url";
      if (value === "file") return "file";
      return "url";
    }
    function normalizeKind2(raw) {
      const value = raw && typeof raw === "object" ? raw : {};
      const volume = typeof value.volume === "number" && Number.isFinite(value.volume) ? value.volume : FALLBACK_KIND.volume;
      const src = typeof value.src === "string" ? value.src : "";
      return {
        src,
        volume: Math.min(1, Math.max(0, volume)),
        source: normalizeSource2(value.source, src)
      };
    }
    function clampBoundedInt(raw, max) {
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value) || value < 0) return 0;
      return Math.min(max, Math.floor(value));
    }
    function readBoundedInt(raw, fallback, max) {
      if (typeof raw === "number") return Number.isFinite(raw) ? clampBoundedInt(raw, max) : fallback;
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) return fallback;
        const numeric = Number(trimmed);
        return Number.isFinite(numeric) ? clampBoundedInt(numeric, max) : fallback;
      }
      return fallback;
    }
    function clampCompletionMinSeconds(raw) {
      return clampBoundedInt(raw, COMPLETION_MIN_MAX);
    }
    function readCompletionMinSeconds(raw) {
      return readBoundedInt(raw, COMPLETION_MIN_FALLBACK, COMPLETION_MIN_MAX);
    }
    function clampMaxDepth(raw) {
      return clampBoundedInt(raw, MAX_DEPTH_MAX2);
    }
    function readMaxDepth(raw) {
      return readBoundedInt(raw, MAX_DEPTH_FALLBACK, MAX_DEPTH_MAX2);
    }
    function normalizePolicy2(value, fallback) {
      return typeof value === "string" && ATTENTION_POLICY_ORDER.includes(value) ? value : fallback;
    }
    function normalizeConfig2(raw) {
      const value = raw && typeof raw === "object" ? raw : {};
      const rawKinds = value.kinds && typeof value.kinds === "object" ? value.kinds : {};
      const kinds = {};
      for (const kind of KIND_ORDER) kinds[kind] = normalizeKind2(rawKinds[kind]);
      const rawNotify = value.notify && typeof value.notify === "object" ? value.notify : {};
      const rawNotifyKinds = rawNotify.kinds && typeof rawNotify.kinds === "object" ? rawNotify.kinds : {};
      const notifyKinds = {};
      for (const kind of KIND_ORDER) {
        notifyKinds[kind] = typeof rawNotifyKinds[kind] === "boolean" ? rawNotifyKinds[kind] : FALLBACK_NOTIFY.kinds[kind];
      }
      const rawAttention = value.attention && typeof value.attention === "object" ? value.attention : {};
      const legacySound = value.backgroundSessions === true ? "always" : FALLBACK_ATTENTION.sound;
      return {
        enabled: typeof value.enabled === "boolean" ? value.enabled : FALLBACK_CONFIG.enabled,
        attention: {
          sound: normalizePolicy2(rawAttention.sound, legacySound),
          notify: normalizePolicy2(rawAttention.notify, FALLBACK_ATTENTION.notify)
        },
        completionMinSeconds: readCompletionMinSeconds(value.completionMinSeconds),
        maxDepth: readMaxDepth(value.maxDepth),
        notify: {
          enabled: typeof rawNotify.enabled === "boolean" ? rawNotify.enabled : FALLBACK_NOTIFY.enabled,
          kinds: notifyKinds,
          raiseWindow: typeof rawNotify.raiseWindow === "boolean" ? rawNotify.raiseWindow : FALLBACK_NOTIFY.raiseWindow
        },
        kinds
      };
    }
    function readSnapshot(configStore) {
      try {
        return normalizeConfig2(configStore && configStore.getSnapshot());
      } catch {
        return normalizeConfig2(FALLBACK_CONFIG);
      }
    }
    function isHttpUrl(src) {
      return /^https?:\/\//i.test(String(src || "").trim());
    }
    function classifySource(src) {
      if (!String(src || "").trim()) return "url";
      return isHttpUrl(src) ? "url" : "file";
    }
    function messageOf2(error, fallback) {
      if (error instanceof Error && error.message) return error.message;
      if (typeof error === "string" && error) return error;
      return typeof fallback === "string" && fallback ? fallback : "error";
    }
    function previewReason(error) {
      if (error instanceof Error && typeof error.message === "string" && error.message.trim()) {
        return error.message.trim();
      }
      if (typeof error === "string" && error.trim()) return error.trim();
      return "";
    }
    function format(template, params) {
      if (!params) return template;
      return String(template).replace(
        /\{(\w+)\}/g,
        (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
      );
    }
    function translate(t, key, params) {
      const text = format(fallbackText(key), params);
      if (typeof t !== "function") return text;
      try {
        const value = t(key);
        if (typeof value === "string" && value.length > 0 && value !== key) return format(value, params);
      } catch {
      }
      return text;
    }
    function fallbackText(key) {
      const value = Object.prototype.hasOwnProperty.call(zh, key) ? zh[key] : void 0;
      return typeof value === "string" && value.length > 0 ? value : key;
    }
    function useTranslator(t) {
      return (0, import_react.useCallback)((key, params) => translate(t, key, params), [t]);
    }
    function useConfigSnapshot(configStore) {
      const usable = !!configStore && typeof configStore.getSnapshot === "function" && typeof configStore.subscribe === "function";
      const [config, setConfig] = (0, import_react.useState)(() => usable ? readSnapshot(configStore) : normalizeConfig2(FALLBACK_CONFIG));
      (0, import_react.useEffect)(() => {
        if (!usable) {
          setConfig(normalizeConfig2(FALLBACK_CONFIG));
          return void 0;
        }
        setConfig(readSnapshot(configStore));
        let unsubscribe;
        try {
          unsubscribe = configStore.subscribe(() => setConfig(readSnapshot(configStore)));
        } catch {
          unsubscribe = void 0;
        }
        return typeof unsubscribe === "function" ? unsubscribe : void 0;
      }, [usable, configStore]);
      return config;
    }
    var PERMISSION_TEXT_KEYS = {
      default: "notifyPermissionDefault",
      granted: "notifyPermissionGranted",
      denied: "notifyPermissionDenied",
      unsupported: "notifyPermissionUnsupported"
    };
    var TEST_REASON_KEYS = {
      ready: "notifyTestReady",
      disabled: "notifyTestDisabled",
      "kind-off": "notifyTestKindOff",
      unsupported: "notifyTestUnsupported",
      "config-error": "notifyTestConfigError",
      "unknown-kind": "notifyTestUnknownKind",
      disposed: "notifyTestDisposed"
    };
    function testReasonText(tt, reason) {
      if (Object.prototype.hasOwnProperty.call(TEST_REASON_KEYS, reason)) {
        return tt(TEST_REASON_KEYS[reason]);
      }
      if (typeof reason === "string" && reason.startsWith("permission-")) {
        return tt("notifyTestPermission", { state: reason.slice("permission-".length) });
      }
      return tt("notifyTestConfigError");
    }
    function readPermission(notifier) {
      try {
        if (notifier && typeof notifier.permission === "function") {
          const value = notifier.permission();
          if (typeof value === "string") return value;
        }
      } catch {
      }
      return "unsupported";
    }
    function ChimeSettings(props) {
      const { t, configStore, audioEngine, notifier } = props || {};
      const tt = useTranslator(t);
      const config = useConfigSnapshot(configStore);
      const [drafts, setDrafts] = (0, import_react.useState)({});
      const [errors, setErrors] = (0, import_react.useState)({});
      const [completionDraft, setCompletionDraft] = (0, import_react.useState)(void 0);
      const [maxDepthDraft, setMaxDepthDraft] = (0, import_react.useState)(void 0);
      const maxDepthDisplay = maxDepthDraft !== void 0 ? maxDepthDraft : String(config.maxDepth);
      const completionDisplay = completionDraft !== void 0 ? completionDraft : String(config.completionMinSeconds);
      const [permission, setPermission] = (0, import_react.useState)(() => readPermission(notifier));
      const [requesting, setRequesting] = (0, import_react.useState)(false);
      const [testResults, setTestResults] = (0, import_react.useState)({});
      (0, import_react.useEffect)(() => {
        setPermission(readPermission(notifier));
      }, [notifier]);
      (0, import_react.useEffect)(() => {
        setDrafts((previous) => {
          const next = {};
          let changed = false;
          for (const kind of KIND_ORDER) {
            const draft = previous[kind];
            if (draft === void 0) continue;
            if (draft === config.kinds[kind].src) changed = true;
            else next[kind] = draft;
          }
          return changed ? next : previous;
        });
      }, [config]);
      const setKindError = (kind, message) => {
        setErrors((previous) => {
          const next = { ...previous };
          if (message) next[kind] = message;
          else delete next[kind];
          return next;
        });
      };
      const writeKind = (0, import_react.useCallback)(
        (kind, patch) => {
          if (!configStore || typeof configStore.setKind !== "function") return;
          try {
            configStore.setKind(kind, patch);
          } catch (error) {
            setKindError(kind, messageOf2(error, tt("actionFailed")));
          }
        },
        [configStore, tt]
      );
      const updateConfig = (0, import_react.useCallback)(
        (patch) => {
          if (!configStore || typeof configStore.update !== "function") return;
          try {
            configStore.update(patch);
          } catch {
          }
        },
        [configStore]
      );
      const onSrcChange = (kind, value) => {
        setDrafts((previous) => ({ ...previous, [kind]: value }));
        setKindError(kind, "");
        writeKind(kind, { src: value, source: classifySource(value) });
      };
      const onVolumeChange = (kind, percentText) => {
        const percent = Number(percentText);
        if (!Number.isFinite(percent)) return;
        const volume = Math.min(1, Math.max(0, percent / 100));
        writeKind(kind, { volume });
        if (audioEngine && typeof audioEngine.setVolume === "function") {
          try {
            audioEngine.setVolume(kind, volume);
          } catch {
          }
        }
      };
      const onCompletionMinChange = (text) => {
        setCompletionDraft(String(text));
        updateConfig({ completionMinSeconds: clampCompletionMinSeconds(text) });
      };
      const onCompletionMinBlur = () => setCompletionDraft(void 0);
      const onMaxDepthChange = (text) => {
        setMaxDepthDraft(String(text));
        updateConfig({ maxDepth: clampMaxDepth(text) });
      };
      const onMaxDepthBlur = () => setMaxDepthDraft(void 0);
      const updateAttention = (0, import_react.useCallback)(
        (channel, policy) => {
          updateConfig({ attention: { ...config.attention, [channel]: policy } });
        },
        [config.attention, updateConfig]
      );
      const updateNotify = (0, import_react.useCallback)(
        (patch) => {
          updateConfig({ notify: { ...config.notify, ...patch } });
        },
        [config.notify, updateConfig]
      );
      const updateNotifyKind = (kind, enabled) => {
        updateNotify({ kinds: { ...config.notify.kinds, [kind]: enabled } });
      };
      const onRequestPermission = async () => {
        if (!notifier || typeof notifier.requestPermission !== "function") {
          setPermission("unsupported");
          return;
        }
        setRequesting(true);
        try {
          await notifier.requestPermission();
        } catch {
        } finally {
          setRequesting(false);
          setPermission(readPermission(notifier));
        }
      };
      const onTestNotification = (kind) => {
        const event = { kind, sessionId: "__dsh-chime-test__" };
        let reason = "ready";
        try {
          if (notifier && typeof notifier.explain === "function") {
            const check = notifier.explain(event);
            if (check && typeof check.reason === "string") reason = check.reason;
          } else if (!notifier || typeof notifier.notify !== "function") {
            reason = "unsupported";
          }
          if (reason === "ready" && notifier && typeof notifier.notify === "function") {
            notifier.notify(event);
          }
        } catch {
          reason = "config-error";
        }
        setTestResults((previous) => ({ ...previous, [kind]: testReasonText(tt, reason) }));
      };
      const dropDraft = (kind) => {
        setDrafts((previous) => {
          if (previous[kind] === void 0) return previous;
          const next = { ...previous };
          delete next[kind];
          return next;
        });
      };
      const onPreview = async (kind) => {
        const current = config.kinds[kind];
        setKindError(kind, "");
        if (!current.src.trim()) {
          setKindError(kind, tt("previewEmpty"));
          return;
        }
        if (!audioEngine || typeof audioEngine.preview !== "function") {
          setKindError(kind, tt("previewUnsupported"));
          return;
        }
        try {
          const played = await audioEngine.preview(kind, {
            src: current.src,
            source: current.source,
            volume: current.volume
          });
          if (played === false) {
            setKindError(kind, tt("previewFailed"));
          }
        } catch (error) {
          const reason = previewReason(error);
          setKindError(
            kind,
            reason ? tt("previewFailedReason", { message: reason }) : tt("previewFailed")
          );
        }
      };
      const onClear = (kind) => {
        dropDraft(kind);
        setKindError(kind, "");
        writeKind(kind, { src: "", source: "url" });
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.panel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("formatHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.toggleRow, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                type: "checkbox",
                style: styles.checkbox,
                checked: config.enabled,
                onChange: (event) => updateConfig({ enabled: event.target.checked })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.kindLabel, children: tt("enabled") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.completionMin, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.volumeLabel, htmlFor: "dsh-chime-attention-sound", children: tt("attentionSoundLabel") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "select",
                {
                  id: "dsh-chime-attention-sound",
                  style: styles.select,
                  value: config.attention.sound,
                  "aria-label": tt("attentionSoundLabel"),
                  onChange: (event) => updateAttention("sound", event.target.value),
                  children: ATTENTION_POLICY_ORDER.map((policy) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: policy, style: styles.option, children: tt("policy_" + policy.replace(/-/g, "_")) }, policy))
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("policy_" + config.attention.sound.replace(/-/g, "_") + "_hint") })
          ] }),
          config.enabled ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("enabledHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.cardHead, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.kindLabel, children: tt("notifyTitle") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.toggleRow, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                type: "checkbox",
                style: styles.checkbox,
                checked: config.notify.enabled,
                onChange: (event) => updateNotify({ enabled: event.target.checked })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: tt("notifyEnable") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("notifyHint") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.completionMin, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.volumeLabel, htmlFor: "dsh-chime-attention-notify", children: tt("attentionNotifyLabel") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "select",
                {
                  id: "dsh-chime-attention-notify",
                  style: styles.select,
                  value: config.attention.notify,
                  "aria-label": tt("attentionNotifyLabel"),
                  onChange: (event) => updateAttention("notify", event.target.value),
                  children: ATTENTION_POLICY_ORDER.map((policy) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: policy, style: styles.option, children: tt("policy_" + policy.replace(/-/g, "_")) }, policy))
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("policy_" + config.attention.notify.replace(/-/g, "_") + "_hint") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: tt(PERMISSION_TEXT_KEYS[permission] ?? PERMISSION_TEXT_KEYS.unsupported) }),
            permission === "default" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                style: styles.button,
                disabled: requesting,
                onClick: onRequestPermission,
                children: requesting ? tt("notifyRequesting") : tt("notifyRequest")
              }
            ) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.toggleRow, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                type: "checkbox",
                style: styles.checkbox,
                checked: config.notify.raiseWindow === true,
                onChange: (event) => updateNotify({ raiseWindow: event.target.checked })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: tt("notifyRaiseWindow") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.experimental, children: tt("experimentalTag") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("notifyRaiseWindowHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.cardHead, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.kindLabel, children: tt("configSectionTitle") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.completionMin, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.volumeLabel, htmlFor: "dsh-chime-max-depth", children: tt("maxDepthLabel") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  id: "dsh-chime-max-depth",
                  type: "number",
                  style: styles.numberInput,
                  min: "0",
                  max: "16",
                  step: "1",
                  inputMode: "numeric",
                  value: maxDepthDisplay,
                  "aria-label": tt("maxDepthLabel"),
                  onChange: (event) => onMaxDepthChange(event.target.value),
                  onBlur: onMaxDepthBlur
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: tt("maxDepthUnit") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("maxDepthHint") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.completionMin, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.volumeLabel, htmlFor: "dsh-chime-completion-min", children: tt("completionMinLabel") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  id: "dsh-chime-completion-min",
                  type: "number",
                  style: styles.numberInput,
                  min: "0",
                  max: "3600",
                  step: "1",
                  inputMode: "numeric",
                  value: completionDisplay,
                  "aria-label": tt("completionMinLabel"),
                  onChange: (event) => onCompletionMinChange(event.target.value),
                  onBlur: onCompletionMinBlur
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: tt("completionMinUnit") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("completionMinHint") })
          ] })
        ] }),
        KIND_ORDER.map((kind) => {
          const current = config.kinds[kind];
          const display = drafts[kind] !== void 0 ? drafts[kind] : current.src;
          const configured = current.src.trim().length > 0;
          const error = errors[kind] || "";
          const percent = Math.round(current.volume * 100);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: styles.card, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.cardHead, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.kindLabel, children: tt(`kind_${kind}_label`) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.hint, children: tt(`kind_${kind}_hint`) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.row, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                type: "text",
                style: styles.input,
                value: display,
                spellCheck: false,
                placeholder: tt("srcPlaceholder"),
                "aria-label": tt(`kind_${kind}_label`),
                onChange: (event) => onSrcChange(kind, event.target.value)
              }
            ) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.volumeLabel, children: [
                tt("volume"),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "range",
                    style: styles.slider,
                    min: "0",
                    max: "100",
                    step: "1",
                    value: percent,
                    onChange: (event) => onVolumeChange(kind, event.target.value)
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.volumeValue, children: [
                percent,
                "%"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.spacer }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.button, disabled: !configured, onClick: () => onPreview(kind), children: tt("preview") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.button, disabled: !configured, onClick: () => onClear(kind), children: tt("clear") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: styles.volumeLabel, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "checkbox",
                    style: styles.checkbox,
                    checked: config.notify.kinds[kind],
                    onChange: (event) => updateNotifyKind(kind, event.target.checked)
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: tt("notifyPerKind") })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.spacer }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.button, onClick: () => onTestNotification(kind), children: tt("notifyTest") })
            ] }),
            config.notify.enabled ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("notifyPerKindOff") }),
            testResults[kind] ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: testResults[kind] }) : null,
            error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.error, children: error }) : null
          ] }, kind);
        }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.hint, children: tt("storageHint") })
      ] });
    }
    function ChimeSummary(props) {
      const { t, configStore } = props || {};
      const tt = useTranslator(t);
      const config = useConfigSnapshot(configStore);
      const total = KIND_ORDER.length;
      const configured = KIND_ORDER.filter((kind) => config.kinds[kind].src.trim().length > 0).length;
      const countText = tt("summaryCount", { total, configured });
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.summary, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          config.enabled ? tt("summaryEnabled") : tt("summaryDisabled"),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: styles.summaryMuted, children: [
            " \xB7 ",
            tt("policy_short_" + config.attention.sound.replace(/-/g, "_")),
            config.notify.enabled ? ` \xB7 ${tt("summaryNotifyOn")}` : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.summaryMuted, children: countText })
      ] });
    }

    // src/client/index.js
    var inject = ["slots", "locale", "sessions", "remote", "uiSession", "uiWorkspace"];
    var PACKAGE_NAME = "dsh-chime";
    function createJobCounter(ctx) {
      const watches = /* @__PURE__ */ new Map();
      let disposed = false;
      function jobsService() {
        try {
          if (ctx.jobs && typeof ctx.jobs === "object") return ctx.jobs;
        } catch {
        }
        try {
          const service = ctx.get("jobs");
          return service && typeof service === "object" ? service : void 0;
        } catch {
          return void 0;
        }
      }
      function watch(sessionId) {
        if (disposed || sessionId === void 0 || watches.has(sessionId)) return;
        const jobs = jobsService();
        if (typeof jobs?.watchRows !== "function") return;
        try {
          watches.set(sessionId, jobs.watchRows(sessionId));
        } catch {
        }
      }
      function activeCount(sessionId) {
        const jobs = jobsService();
        const rows = jobs?.state?.getSnapshot?.()?.rowsBySession?.get?.(String(sessionId));
        if (!Array.isArray(rows)) return 0;
        return rows.filter((row) => row?.status === "running" || row?.status === "stopping").length;
      }
      return {
        /** Current active-job count; opens the roster subscription on first use. */
        count(sessionId) {
          watch(sessionId);
          return activeCount(sessionId);
        },
        /** Release every roster subscription. */
        dispose() {
          disposed = true;
          for (const release of watches.values()) {
            try {
              if (typeof release === "function") release();
              else if (typeof release?.release === "function") release.release();
            } catch {
            }
          }
          watches.clear();
        }
      };
    }
    function createTranslator(locale) {
      let bound = null;
      try {
        if (typeof locale?.bind === "function") bound = locale.bind(NS);
      } catch {
        bound = null;
      }
      return (key) => {
        try {
          if (typeof bound === "function") {
            const value = bound(key);
            if (typeof value === "string" && value.length > 0 && value !== key) return value;
          }
        } catch {
        }
        const fallback = zh[key];
        return typeof fallback === "string" && fallback.length > 0 ? fallback : key;
      };
    }
    function sessionTitleOf(ctx, sessionId) {
      try {
        const row = ctx.get("sessions")?.list?.getSnapshot?.()?.byId?.[sessionId];
        const title = row?.title ?? row?.name;
        return typeof title === "string" ? title.trim() : "";
      } catch {
        return "";
      }
    }
    function revealSession(ctx, sessionId) {
      if (typeof sessionId !== "string" || sessionId.length === 0) return;
      let list;
      try {
        list = ctx.get("sessions")?.list?.getSnapshot?.();
      } catch {
        list = void 0;
      }
      if (!list || list.phase !== "ready") return;
      if (list.byId?.[sessionId] === void 0) return;
      try {
        const archived = ctx.get("workspaces")?.list?.getSnapshot?.()?.archivedSessionIds;
        if (Array.isArray(archived) && archived.includes(sessionId)) return;
      } catch {
      }
      try {
        const workspace = ctx.get("uiWorkspace");
        if (typeof workspace?.openSession !== "function") return;
        if (workspace.mainReference?.sessionId === sessionId) return;
        workspace.openSession(sessionId);
      } catch (error) {
        try {
          globalThis.console?.warn?.("[dsh-chime] session reveal skipped", error);
        } catch {
        }
      }
    }
    function raiseDesktopWindow(config) {
      if (config?.notify?.raiseWindow !== true) return;
      const location = globalThis.location;
      if (location?.protocol !== "dsh-app:" || location?.hostname !== "app") return;
      if (globalThis.dshDesktop === void 0) return;
      try {
        void globalThis.fetch?.("/dsh-chime/raise", {
          method: "POST",
          headers: { "x-dsh-chime": "raise" },
          keepalive: true
        })?.then?.(async (response) => {
          const result = await response.json();
          if (!response.ok || result.requested === false || result.activated === false) {
            globalThis.console?.warn?.("[dsh-chime] window activation was not confirmed", result);
          }
        })?.catch?.((error) => {
          globalThis.console?.warn?.("[dsh-chime] window activation request failed", error);
        });
      } catch {
      }
    }
    function fillTemplate(template, params) {
      return String(template).replace(
        /\{(\w+)\}/g,
        (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
      );
    }
    function apply(ctx) {
      const locale = ctx.locale;
      if (typeof locale?.register === "function") {
        ctx.effect(
          () => locale.register(NS, { zh, en }),
          "dsh-chime: dictionaries"
        );
      }
      const configStore = createConfigStore();
      const fileBrowser = createFileBrowser(ctx);
      const jobs = createJobCounter(ctx);
      const audio = createAudioEngine({
        // Three sources resolve to a playable URL here:
        //   'url'   the pasted link itself
        //   'file'  a same-origin URL served by this package's host half
        //   'local' an object URL for a file the user picked (stored in IndexedDB)
        resolveSource: (src, source, kind) => toPlayableUrl(src, source, kind)
      });
      const text = createTranslator(locale);
      const presence = createPresence();
      const notifier = createNotifier({
        getConfig: () => configStore.getSnapshot(),
        buildMessage: (event) => {
          const title = text(`notify_kind_${event.kind}_title`);
          const sessionTitle = sessionTitleOf(ctx, event.sessionId);
          const body = sessionTitle ? fillTemplate(text("notifyBodyFromSession"), { session: sessionTitle }) : text(`notify_kind_${event.kind}_body`);
          return { title, body };
        },
        onClick: (event) => {
          try {
            globalThis.focus?.();
          } catch {
          }
          revealSession(ctx, event?.sessionId);
          raiseDesktopWindow(configStore.getSnapshot());
        }
      });
      const detector = createDetector({
        getConfig: () => configStore.getSnapshot(),
        isFocused: () => presence.focused(),
        getStatuses: () => {
          const uiSession = ctx.get("uiSession");
          return uiSession?.sessionStatus?.getSnapshot?.() ?? /* @__PURE__ */ new Map();
        },
        getSessionList: () => ctx.get("sessions")?.list?.getSnapshot?.(),
        getAgentError: (sessionId) => {
          try {
            const borrowed = ctx.get("sessions")?.binding?.(sessionId);
            return borrowed?.session?.getSnapshot?.()?.lastAgentError ?? null;
          } catch {
            return null;
          }
        },
        getLastUserMessageTime: (sessionId) => {
          try {
            const entries = ctx.get("sessions")?.binding?.(sessionId)?.eventSource?.getSnapshot?.()?.entries;
            if (!Array.isArray(entries)) return null;
            for (let index = entries.length - 1; index >= 0; index -= 1) {
              const event = entries[index]?.event;
              if (event?.type === "user/message" && Number.isFinite(event.time)) return event.time;
            }
            return null;
          } catch {
            return null;
          }
        },
        countActiveJobs: async (sessionId) => jobs.count(sessionId),
        onChime: (event) => {
          const { kind } = event;
          const config = configStore.getSnapshot();
          if (event.notify === true) notifier.notify(event);
          if (event.sound === false || !config.enabled) return;
          const entry = config.kinds?.[kind];
          if (entry === void 0 || entry.src === "") return;
          void audio.play(kind, entry);
        }
      });
      ctx.effect(() => {
        const stop = detector.start();
        const releases = [];
        const follow = (resolve) => {
          try {
            const release = resolve()?.subscribe?.(() => detector.poke());
            if (typeof release === "function") releases.push(release);
          } catch {
          }
        };
        follow(() => ctx.get("uiSession")?.sessionStatus);
        follow(() => ctx.get("sessions")?.list);
        const onVisibilityChange = () => {
          detector.poke();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
          document.removeEventListener("visibilitychange", onVisibilityChange);
          for (const release of releases) {
            try {
              release();
            } catch {
            }
          }
          if (typeof stop === "function") stop();
          detector.dispose();
          notifier.dispose();
          jobs.dispose();
          audio.dispose();
          releaseAll();
        };
      }, "dsh-chime: lifecycle");
      ctx.effect(() => {
        const unlock = () => audio.unlock?.();
        unlock();
        const events = ["pointerdown", "keydown"];
        for (const type of events) {
          document.addEventListener(type, unlock, { capture: true, once: true });
        }
        return () => {
          for (const type of events) {
            document.removeEventListener(type, unlock, { capture: true });
          }
        };
      }, "dsh-chime: audio unlock");
      function renderSeat(props) {
        const shared = { t: props.t, configStore };
        if (props.view === "summary") return (0, import_react2.createElement)(ChimeSummary, shared);
        return (0, import_react2.createElement)(ChimeSettings, {
          ...shared,
          audioEngine: audio,
          notifier,
          fileBrowser,
          localAudioStore: localAudioStore_exports
        });
      }
      ctx.slots.inject(
        "plugins.bundle.config",
        () => ctx.slots.register(
          { name: "plugins.bundle.config", key: PACKAGE_NAME, locale: NS },
          renderSeat
        )
      );
    }

    return module.exports;
  }
});
