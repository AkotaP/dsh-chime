window.__ModuleLoader__.load({
  id: "dsh-chime-xp",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
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
    var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/xp/index.js
    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);
    var import_react = require("react");

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
    var LOCAL_AUDIO_DB_NAME = "dsh-chime-audio";
    var LOCAL_AUDIO_STORE_NAME = "files";
    var DB_VERSION = 1;
    var ERROR_NAME = "ChimeLocalAudioError";
    var READ_FAILED = "\u8BFB\u53D6\u672C\u5730\u97F3\u9891\u5931\u8D25";
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
    var SCHEME_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
    var WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
    function isLocalPath(src) {
      if (typeof src !== "string") return false;
      const value = src.trim();
      if (value === "") return false;
      if (SCHEME_URL_RE.test(value)) return false;
      if (WINDOWS_DRIVE_RE.test(value)) return true;
      if (value.startsWith("\\\\")) return true;
      if (value.startsWith("/")) return true;
      return false;
    }
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

    // src/xp/config.js
    var STORAGE_KEY = "dsh.chime.xp.config.v1";
    var DEFAULT_CONFIG = Object.freeze({
      enabled: false,
      sound: Object.freeze({ src: "", source: "url", volume: 0.1 }),
      durationMinSeconds: 1,
      durationMaxSeconds: 3,
      orbsPerSecond: 6,
      playInBackground: false
    });
    var object = (value) => value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    var clamp = (value, min, max, fallback) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    function normalizeConfig(raw) {
      const value = object(raw) ? raw : {};
      const sound = object(value.sound) ? value.sound : {};
      const min = clamp(value.durationMinSeconds, 0.1, 30, DEFAULT_CONFIG.durationMinSeconds);
      const max = clamp(value.durationMaxSeconds, 0.1, 30, DEFAULT_CONFIG.durationMaxSeconds);
      return {
        enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_CONFIG.enabled,
        sound: {
          src: typeof sound.src === "string" ? sound.src.trim() : "",
          source: ["url", "file", "local"].includes(sound.source) ? sound.source : "url",
          volume: clamp(sound.volume, 0, 1, DEFAULT_CONFIG.sound.volume)
        },
        durationMinSeconds: Math.min(min, max),
        durationMaxSeconds: Math.max(min, max),
        orbsPerSecond: clamp(value.orbsPerSecond, 0.1, 10, DEFAULT_CONFIG.orbsPerSecond),
        playInBackground: typeof value.playInBackground === "boolean" ? value.playInBackground : DEFAULT_CONFIG.playInBackground
      };
    }
    function freeze(config) {
      Object.freeze(config.sound);
      return Object.freeze(config);
    }
    function browserStorage() {
      try {
        return globalThis.localStorage;
      } catch {
        return void 0;
      }
    }
    function parse(text) {
      try {
        return JSON.parse(text);
      } catch {
        return void 0;
      }
    }
    function createConfigStore({ storage = browserStorage(), eventTarget = globalThis.window } = {}) {
      const listeners = /* @__PURE__ */ new Set();
      let disposed = false;
      let persisted;
      try {
        persisted = parse(storage?.getItem(STORAGE_KEY));
      } catch {
      }
      let snapshot = freeze(normalizeConfig(persisted));
      function commit(raw, persist) {
        if (disposed) return snapshot;
        const next = freeze(normalizeConfig(raw));
        if (JSON.stringify(next) === JSON.stringify(snapshot)) return snapshot;
        snapshot = next;
        if (persist) {
          try {
            storage?.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
          }
        }
        for (const listener of [...listeners]) {
          try {
            Promise.resolve(listener(next)).catch(() => {
            });
          } catch {
          }
        }
        return snapshot;
      }
      function onStorage(event) {
        if (event.key !== STORAGE_KEY && event.key !== null) return;
        if (event.storageArea && event.storageArea !== storage) return;
        commit(event.key === null ? void 0 : parse(event.newValue), false);
      }
      try {
        eventTarget?.addEventListener("storage", onStorage);
      } catch {
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          if (disposed || typeof listener !== "function") return () => {
          };
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set(partial) {
          if (!object(partial)) return snapshot;
          return commit({
            ...snapshot,
            ...partial,
            sound: object(partial.sound) ? { ...snapshot.sound, ...partial.sound } : snapshot.sound
          }, true);
        },
        reset: () => commit(DEFAULT_CONFIG, true),
        dispose() {
          if (disposed) return;
          disposed = true;
          listeners.clear();
          try {
            eventTarget?.removeEventListener("storage", onStorage);
          } catch {
          }
        }
      };
    }

    // src/xp/burst.js
    function samplePitch(random = Math.random) {
      return 0.9 + (random() - random()) * 0.35;
    }
    function createBurstController({
      getConfig = () => ({}),
      onOrb = () => {
      },
      canPlay = () => true,
      now = () => globalThis.performance?.now() ?? Date.now(),
      setTimeout: scheduleTimeout = globalThis.setTimeout.bind(globalThis),
      clearTimeout: cancelTimeout = globalThis.clearTimeout.bind(globalThis),
      random = Math.random,
      onStateChange = () => {
      }
    } = {}) {
      let disposed = false;
      let playing = false;
      let previewing = false;
      let end = 0;
      let lastOrb = -Infinity;
      let inFlight = false;
      let timer = null;
      let timerVersion = 0;
      const unsubscribers = [];
      function notify(value) {
        try {
          Promise.resolve(onStateChange(value)).catch(() => {
          });
        } catch {
        }
      }
      function clearTimer() {
        timerVersion++;
        if (timer === null) return;
        const handle = timer;
        timer = null;
        try {
          cancelTimeout(handle);
        } catch {
        }
      }
      function stop() {
        clearTimer();
        previewing = false;
        end = 0;
        if (!playing) return;
        playing = false;
        notify(false);
      }
      function sync(value) {
        if (value && typeof value.then === "function") {
          Promise.resolve(value).catch(() => {
          });
          throw new TypeError("Burst getters must be synchronous");
        }
        return value;
      }
      function read(allowDisabled = previewing) {
        const config = normalizeConfig(sync(getConfig()));
        if (!config.sound.src || !allowDisabled && !config.enabled || !sync(canPlay(config))) return null;
        return config;
      }
      function time() {
        const value = sync(now());
        if (!Number.isFinite(value)) throw new TypeError("Invalid burst clock");
        return value;
      }
      const interval = (config) => Math.max(100, 1e3 / config.orbsPerSecond);
      function emit(at) {
        if (inFlight) return;
        const pitch = samplePitch(random);
        if (!Number.isFinite(pitch)) throw new TypeError("Invalid pitch sample");
        lastOrb = at;
        inFlight = true;
        try {
          const result = onOrb({ pitch });
          if (result && typeof result.then === "function") {
            Promise.resolve(result).then(
              () => {
                inFlight = false;
              },
              () => {
                inFlight = false;
              }
            );
          } else {
            inFlight = false;
          }
        } catch {
          inFlight = false;
        }
      }
      function schedule(config, at) {
        if (!playing || disposed || timer !== null) return;
        const period = interval(config);
        const next = lastOrb + period;
        const due = Math.min(end, next > at ? next : at + period);
        const version = ++timerVersion;
        timer = scheduleTimeout(() => {
          if (version !== timerVersion || disposed) return;
          timer = null;
          tick();
        }, Math.max(0, due - at));
      }
      function tick() {
        try {
          if (!playing || disposed) return;
          const config = read();
          const at = time();
          if (!config || at >= end) {
            stop();
            return;
          }
          if (at >= lastOrb + interval(config)) emit(at);
          if (playing && !disposed) schedule(config, time());
        } catch {
          stop();
        }
      }
      function start(seconds, preview) {
        if (disposed) return false;
        try {
          const at = time();
          if (playing && (at >= end || !read())) stop();
          const config = read(preview);
          if (!config) {
            if (!previewing) stop();
            return false;
          }
          const duration = preview ? Math.min(30, Math.max(0.1, typeof seconds === "number" && Number.isFinite(seconds) ? seconds : 10)) : config.durationMinSeconds + random() * (config.durationMaxSeconds - config.durationMinSeconds);
          if (!Number.isFinite(duration)) throw new TypeError("Invalid duration sample");
          const until = at + duration * 1e3;
          if (playing) {
            end = Math.max(end, until);
            previewing = preview;
            return true;
          }
          previewing = preview;
          end = until;
          playing = true;
          notify(true);
          if (!playing || disposed) return false;
          if (at >= lastOrb + interval(config)) emit(at);
          if (playing && !disposed) schedule(config, time());
          return playing;
        } catch {
          stop();
          return false;
        }
      }
      function isPlaying() {
        if (!playing || disposed) return false;
        try {
          if (!read() || time() >= end) stop();
        } catch {
          stop();
        }
        return playing;
      }
      for (const getter of [getConfig, canPlay]) {
        if (typeof getter.subscribe !== "function") continue;
        try {
          const unsubscribe = getter.subscribe(() => {
            isPlaying();
          });
          if (typeof unsubscribe === "function") unsubscribers.push(unsubscribe);
        } catch {
        }
      }
      return {
        trigger: () => start(void 0, false),
        preview: (seconds = 10) => start(seconds, true),
        stop,
        stopPreview: () => {
          if (previewing) stop();
        },
        isPreview: () => isPlaying() && previewing,
        isPlaying,
        dispose() {
          if (disposed) return;
          disposed = true;
          stop();
          for (const unsubscribe of unsubscribers.splice(0)) {
            try {
              Promise.resolve(unsubscribe()).catch(() => {
              });
            } catch {
            }
          }
        }
      };
    }

    // src/xp/tools.js
    function createToolResultWatcher({ sessions, uiSession, onToolResult, onStop = () => {
    }, canTrigger = () => true }) {
      let disposed = false;
      let currentId;
      let source;
      let releaseSource;
      let lastSnapshot;
      let highWater = -1;
      const releases = [];
      function safely(fn) {
        try {
          return fn();
        } catch {
          return void 0;
        }
      }
      function stop() {
        safely(onStop);
      }
      function selectedId() {
        const current = uiSession?.adapter?.current;
        if (current?.getSnapshot) return current.getSnapshot()?.key;
        const list = sessions?.list?.getSnapshot?.();
        return list?.ids?.find((id) => (list.byId?.[id]?.retainedBy?.mainView ?? 0) > 0);
      }
      function sessionStatus() {
        return uiSession?.sessionStatus?.getSnapshot?.()?.get?.(currentId);
      }
      function permitsResult() {
        const status = sessionStatus();
        return !status?.pendingInteraction && status?.running !== false && canTrigger();
      }
      function mark(entries) {
        for (const entry of entries ?? []) {
          const seq = entry?.event?.seq;
          if (Number.isFinite(seq)) highWater = Math.max(highWater, seq);
        }
      }
      function observe() {
        if (disposed || !source) return;
        const snapshot = safely(() => source.getSnapshot());
        if (!snapshot || snapshot === lastSnapshot) return;
        lastSnapshot = snapshot;
        const change = snapshot.change;
        if (change?.kind !== "append") {
          if (change?.kind === "replace") stop();
          mark(change?.kind === "prepend" ? change.entries : snapshot.entries);
          return;
        }
        for (const entry of change.entries ?? []) {
          const event = entry?.event;
          if (!Number.isFinite(event?.seq) || event.seq <= highWater) continue;
          highWater = event.seq;
          if (event.type !== "tool/result" || !safely(permitsResult)) continue;
          safely(() => onToolResult({ sessionId: currentId, event }));
        }
      }
      function reconcile() {
        if (disposed) return;
        const id = safely(selectedId);
        const next = id == null ? void 0 : safely(() => sessions?.binding?.(id)?.eventSource);
        if (id !== currentId || next !== source) {
          safely(() => releaseSource?.());
          releaseSource = void 0;
          source = next;
          currentId = id;
          highWater = -1;
          lastSnapshot = void 0;
          stop();
          if (source) {
            lastSnapshot = safely(() => source.getSnapshot());
            mark(lastSnapshot?.entries);
            releaseSource = safely(() => source.subscribe(observe));
            observe();
          }
        }
        const status = safely(sessionStatus);
        if (currentId == null || status?.pendingInteraction || status?.running === false) stop();
      }
      function follow(observable) {
        const release = safely(() => observable?.subscribe?.(reconcile));
        if (typeof release === "function") releases.push(release);
      }
      reconcile();
      follow(uiSession?.adapter?.current);
      follow(sessions?.list);
      follow(uiSession?.sessionStatus);
      reconcile();
      return {
        currentSessionId: () => currentId,
        dispose() {
          if (disposed) return;
          disposed = true;
          safely(() => releaseSource?.());
          for (const release of releases.reverse()) safely(release);
          source = void 0;
          stop();
        }
      };
    }

    // src/xp/settings.jsx
    var React = __toESM(require("react"), 1);

    // src/xp/locale.js
    var NS = "dshChimeXp";
    var zh = {
      title: "\u7ECF\u9A8C\u7403\u97F3\u6548",
      description: "\u5F53\u524D\u4F1A\u8BDD\u6BCF\u6B21\u5DE5\u5177\u5B8C\u6210\u65F6\u89E6\u53D1\u4E00\u9635\u7ECF\u9A8C\u97F3\uFF1B\u540C\u4E00\u65F6\u95F4\u5408\u5E76\u64AD\u653E\uFF0C\u4E0D\u53E0\u52A0\u591A\u4E2A\u8282\u594F\u3002",
      enabled: "\u542F\u7528\u81EA\u52A8\u7ECF\u9A8C\u97F3",
      disabledHint: "\u81EA\u52A8\u7ECF\u9A8C\u97F3\u9ED8\u8BA4\u5173\u95ED\uFF1B\u5173\u95ED\u65F6\u4ECD\u53EF\u624B\u52A8\u8BD5\u542C\u3002\u7EC4\u4EF6\u7684\u5BBF\u4E3B\u5F00\u5173\u9700\u53E6\u5916\u542F\u7528\u3002",
      sound: "\u97F3\u6E90",
      source: "\u97F3\u9891 URL \u6216\u7EDD\u5BF9\u8DEF\u5F84",
      sourcePlaceholder: "https://example.com/orb.ogg \u6216 E:\\Sounds\\orb.ogg",
      sourceHint: "\u4EC5\u94FE\u63A5\u4F60\u63D0\u4F9B\u7684\u97F3\u9891\uFF0C\u4E0D\u590D\u5236\u6587\u4EF6\uFF0C\u4E5F\u4E0D\u63D0\u4F9B\u5185\u7F6E\u97F3\u9891\u3002\u7F51\u7EDC\u97F3\u9891\u9700\u5141\u8BB8\u8DE8\u57DF\u8BBF\u95EE\u3002",
      sourceInvalid: "\u8BF7\u8F93\u5165 http(s) \u97F3\u9891 URL \u6216\u672C\u5730\u6587\u4EF6\u7684\u7EDD\u5BF9\u8DEF\u5F84\u3002",
      clear: "\u6E05\u7A7A\u97F3\u6E90",
      volume: "\u72EC\u7ACB\u97F3\u91CF",
      percent: "{value}%",
      volumeHint: "\u9ED8\u8BA4 10%\uFF0C\u4E0E\u539F\u63D0\u793A\u97F3\u7684\u97F3\u91CF\u4E92\u4E0D\u5F71\u54CD\u3002",
      previewSound: "\u5355\u58F0\u8BD5\u542C",
      previewRhythm: "\u8BD5\u542C 10 \u79D2\u8282\u594F",
      stopPreview: "\u505C\u6B62\u8BD5\u542C",
      playing: "\u6B63\u5728\u64AD\u653E\u7ECF\u9A8C\u97F3\u2026",
      previewHint: "\u7ECF\u9A8C\u97F3\u91C7\u7528 MC \u539F\u7248\u968F\u673A\u53D8\u8C03 0.55\u20131.25\uFF1B\u8282\u594F\u8BD5\u542C\u6700\u9AD8 10 \u58F0/\u79D2\u3002",
      previewEmpty: "\u8BF7\u5148\u8BBE\u7F6E\u97F3\u6E90\u3002",
      previewUnavailable: "\u5F53\u524D\u73AF\u5883\u65E0\u6CD5\u8BD5\u542C\u97F3\u9891\u3002",
      rhythmUnavailable: "\u5F53\u524D\u73AF\u5883\u65E0\u6CD5\u8BD5\u542C\u7ECF\u9A8C\u97F3\u8282\u594F\u3002",
      previewFailed: "\u8BD5\u542C\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u97F3\u6E90\u548C\u6D4F\u89C8\u5668\u97F3\u9891\u6743\u9650\u3002",
      actionFailed: "\u64CD\u4F5C\u5931\u8D25\uFF1A{message}",
      unknownError: "\u672A\u77E5\u9519\u8BEF",
      writeUnavailable: "\u5F53\u524D\u73AF\u5883\u65E0\u6CD5\u4FDD\u5B58\u7ECF\u9A8C\u97F3\u8BBE\u7F6E\u3002",
      writeFailed: "\u8BBE\u7F6E\u672A\u80FD\u4FDD\u5B58\uFF0C\u8BF7\u91CD\u8BD5\u3002",
      reset: "\u91CD\u7F6E\u7ECF\u9A8C\u97F3\u8BBE\u7F6E",
      savedHint: "\u97F3\u6E90\u4E0E\u6570\u5B57\u5728\u79BB\u5F00\u8F93\u5165\u6846\u540E\u4FDD\u5B58\uFF0C\u5176\u4F59\u4FEE\u6539\u5373\u65F6\u751F\u6548\uFF1B\u4EC5\u5F71\u54CD\u7ECF\u9A8C\u97F3\u3002",
      timing: "\u64AD\u653E\u8282\u594F",
      durationMin: "\u6700\u77ED\u65F6\u957F\uFF08\u79D2\uFF09",
      durationMax: "\u6700\u957F\u65F6\u957F\uFF08\u79D2\uFF09",
      durationHint: "\u6BCF\u9635\u968F\u673A\u6301\u7EED 0.1\u201330 \u79D2\uFF1B\u4FEE\u6539\u8FB9\u754C\u65F6\u81EA\u52A8\u4FDD\u6301\u6700\u77ED\u65F6\u957F\u4E0D\u5927\u4E8E\u6700\u957F\u65F6\u957F\u3002",
      rate: "\u6BCF\u79D2\u7ECF\u9A8C\u7403\u6570\u91CF",
      rateHint: "\u5141\u8BB8 0.1\u201310 \u58F0/\u79D2\uFF0C\u9ED8\u8BA4 6 \u58F0/\u79D2\u3002",
      numberInvalid: "\u8BF7\u8F93\u5165\u6709\u6548\u6570\u5B57\u3002",
      background: "\u7A97\u53E3\u5931\u7126\u65F6\u7EE7\u7EED\u64AD\u653E",
      scopeHint: "\u53EA\u54CD\u5E94\u5F53\u524D\u4F1A\u8BDD\uFF0C\u9ED8\u8BA4\u7A97\u53E3\u5931\u7126\u65F6\u6682\u505C\uFF1B\u4E0D\u4F1A\u8865\u64AD\u5386\u53F2\u5DE5\u5177\u4E8B\u4EF6\u3002",
      browse: "\u4ECE\u76EE\u5F55\u9009\u62E9\u97F3\u9891",
      directory: "\u97F3\u9891\u76EE\u5F55\u7EDD\u5BF9\u8DEF\u5F84",
      chooseDirectory: "\u9009\u62E9\u76EE\u5F55",
      loadDirectory: "\u5217\u51FA\u97F3\u9891",
      parentDirectory: "\u8FD4\u56DE\u4E0A\u5C42",
      openDirectory: "\u6253\u5F00\u76EE\u5F55\uFF1A{name}",
      selectFile: "\u9009\u62E9\u97F3\u9891\uFF1A{name}",
      loading: "\u8BFB\u53D6\u4E2D\u2026",
      emptyDirectory: "\u6B64\u76EE\u5F55\u4E2D\u6CA1\u6709\u53D7\u652F\u6301\u7684\u97F3\u9891\u6587\u4EF6\u3002",
      truncated: "\u76EE\u5F55\u6761\u76EE\u8FC7\u591A\uFF0C\u4EC5\u663E\u793A\u90E8\u5206\u7ED3\u679C\uFF1B\u53EF\u8FDB\u5165\u66F4\u5177\u4F53\u7684\u5B50\u76EE\u5F55\u3002",
      directoryInvalid: "\u8BF7\u8F93\u5165\u672C\u5730\u76EE\u5F55\u7684\u7EDD\u5BF9\u8DEF\u5F84\u3002",
      browseUnavailable: "\u5F53\u524D\u73AF\u5883\u65E0\u6CD5\u6D4F\u89C8\u97F3\u9891\u76EE\u5F55\uFF0C\u8BF7\u76F4\u63A5\u586B\u5199\u7EDD\u5BF9\u8DEF\u5F84\u3002",
      closeBrowser: "\u6536\u8D77\u76EE\u5F55\u5217\u8868",
      summaryEnabled: "\u81EA\u52A8\u64AD\u653E\u5DF2\u542F\u7528",
      summaryDisabled: "\u81EA\u52A8\u64AD\u653E\u5DF2\u5173\u95ED",
      summaryEmpty: "\u672A\u8BBE\u7F6E\u97F3\u6E90",
      summaryConfigured: "\u5DF2\u8BBE\u7F6E\u97F3\u6E90",
      summary: "{status} \xB7 {sound} \xB7 {volume}% \xB7 {min}\u2013{max} \u79D2 \xB7 {rate} \u58F0/\u79D2"
    };
    var en = {
      title: "Experience orb sound",
      description: "Each completed tool in the current session triggers an XP burst. Simultaneous bursts merge into one rhythm, never stack.",
      enabled: "Enable automatic XP sound",
      disabledHint: "Automatic XP sound is off by default; manual previews still work. Enable the component\u2019s host switch separately.",
      sound: "Sound source",
      source: "Audio URL or absolute path",
      sourcePlaceholder: "https://example.com/orb.ogg or E:\\Sounds\\orb.ogg",
      sourceHint: "Links only to audio you supply: no file copies or built-in sounds. Remote audio must allow cross-origin requests.",
      sourceInvalid: "Enter an http(s) audio URL or an absolute local file path.",
      clear: "Clear source",
      volume: "Independent volume",
      percent: "{value}%",
      volumeHint: "Defaults to 10%, independent of the original chime volume.",
      previewSound: "Preview one sound",
      previewRhythm: "Preview 10-second rhythm",
      stopPreview: "Stop preview",
      playing: "Playing XP sound\u2026",
      previewHint: "XP sound uses vanilla MC random pitch 0.55\u20131.25. Rhythm preview plays at most 10 sounds/second.",
      previewEmpty: "Set a sound source first.",
      previewUnavailable: "Audio preview is unavailable in this environment.",
      rhythmUnavailable: "XP rhythm preview is unavailable in this environment.",
      previewFailed: "Preview failed. Check the source and browser audio permissions.",
      actionFailed: "Operation failed: {message}",
      unknownError: "Unknown error",
      writeUnavailable: "XP settings cannot be saved in this environment.",
      writeFailed: "Settings could not be saved. Please try again.",
      reset: "Reset XP settings",
      savedHint: "Source and numbers save on blur; other changes save immediately. XP settings only.",
      timing: "Playback rhythm",
      durationMin: "Minimum duration (seconds)",
      durationMax: "Maximum duration (seconds)",
      durationHint: "Each burst lasts a random 0.1\u201330 seconds. Editing a bound also keeps the minimum at or below the maximum.",
      rate: "Experience orbs per second",
      rateHint: "Allows 0.1\u201310 sounds/second; defaults to 6.",
      numberInvalid: "Enter a valid number.",
      background: "Keep playing when the window loses focus",
      scopeHint: "Current session only. Pauses on window blur by default; historical tool events are never replayed.",
      browse: "Choose audio from a directory",
      directory: "Absolute audio directory path",
      chooseDirectory: "Choose directory",
      loadDirectory: "List audio",
      parentDirectory: "Go back up",
      openDirectory: "Open directory: {name}",
      selectFile: "Select audio: {name}",
      loading: "Loading\u2026",
      emptyDirectory: "No supported audio files in this directory.",
      truncated: "Too many directory entries; only some are shown. Try a more specific subdirectory.",
      directoryInvalid: "Enter an absolute local directory path.",
      browseUnavailable: "Directory browsing is unavailable. Enter an absolute file path directly.",
      closeBrowser: "Close directory list",
      summaryEnabled: "Automatic playback on",
      summaryDisabled: "Automatic playback off",
      summaryEmpty: "No source",
      summaryConfigured: "Source configured",
      summary: "{status} \xB7 {sound} \xB7 {volume}% \xB7 {min}\u2013{max} s \xB7 {rate} sounds/s"
    };

    // src/xp/settings.jsx
    var import_jsx_runtime = require("react/jsx-runtime");
    var DEFAULT = {
      enabled: false,
      sound: { src: "", source: "url", volume: 0.1 },
      durationMinSeconds: 1,
      durationMaxSeconds: 3,
      orbsPerSecond: 6,
      playInBackground: false
    };
    var clamp2 = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    function readConfig(store) {
      const value = store?.getSnapshot?.() || DEFAULT;
      const min = clamp2(value.durationMinSeconds, 0.1, 30, 1);
      return {
        enabled: value.enabled === true,
        sound: {
          src: typeof value.sound?.src === "string" ? value.sound.src : "",
          source: value.sound?.source === "file" ? "file" : "url",
          volume: clamp2(value.sound?.volume, 0, 1, 0.1)
        },
        durationMinSeconds: min,
        durationMaxSeconds: Math.max(min, clamp2(value.durationMaxSeconds, 0.1, 30, 3)),
        orbsPerSecond: clamp2(value.orbsPerSecond, 0.1, 10, 6),
        playInBackground: value.playInBackground === true
      };
    }
    function useConfig(store) {
      const [config, setConfig] = React.useState(() => readConfig(store));
      React.useEffect(() => {
        const sync = () => setConfig(readConfig(store));
        const unsubscribe = store?.subscribe?.(sync);
        sync();
        return () => unsubscribe?.();
      }, [store]);
      return config;
    }
    function translate(t, key, params = {}) {
      const translated = t?.(key, params);
      const text = typeof translated === "string" && translated && translated !== key ? translated : zh[key] || key;
      return text.replace(/\{(\w+)\}/g, (match, name) => params[name] === void 0 ? match : String(params[name]));
    }
    function stopOwned(preview) {
      const controller = preview.controller;
      if (typeof controller.stopPreview === "function") return controller.stopPreview();
      if (typeof controller.isPreview === "function" && !controller.isPreview()) return;
      return controller.stop();
    }
    function sourceIsValid(src) {
      if (!src || isLocalPath(src)) return true;
      try {
        return /^https?:$/.test(new URL(src).protocol);
      } catch {
        return false;
      }
    }
    function useDraft(value, resetVersion) {
      const [draft, setDraft] = React.useState(String(value));
      const editing = React.useRef(false);
      React.useEffect(() => {
        if (!editing.current) setDraft(String(value));
      }, [value]);
      React.useEffect(() => {
        editing.current = false;
        setDraft(String(value));
      }, [resetVersion]);
      return {
        value: draft,
        onFocus: () => {
          editing.current = true;
        },
        onChange: (event) => {
          editing.current = true;
          setDraft(event.target.value);
        },
        finish: (next) => {
          editing.current = false;
          if (next !== void 0) setDraft(String(next));
        },
        set: (next) => {
          editing.current = false;
          setDraft(String(next));
        }
      };
    }
    var CSS = ".xp-settings{display:flex;flex-direction:column;gap:14px;color:inherit;font-size:13px;line-height:1.55;padding:2px 0}.xp-settings .xp-card{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid rgba(127,127,127,.28);border-radius:10px;min-width:0}.xp-settings .xp-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.xp-settings .xp-field{display:flex;flex-direction:column;gap:4px;min-width:0}.xp-settings .xp-label{font-weight:600}.xp-settings .xp-hint{font-size:12px;opacity:.68;margin:0}.xp-settings .xp-input,.xp-settings .xp-button{font:inherit;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.35);border-radius:6px;padding:5px 8px}.xp-settings .xp-source{width:100%;box-sizing:border-box}.xp-settings .xp-number{width:100px}.xp-settings .xp-button{cursor:pointer}.xp-settings .xp-button:disabled{opacity:.45;cursor:default}.xp-settings .xp-toggle{display:flex;align-items:center;gap:8px}.xp-settings .xp-toggle input{margin:0;accent-color:currentColor}.xp-settings .xp-slider{width:160px;max-width:100%;accent-color:currentColor}.xp-settings .xp-error{color:var(--color-danger,#d9534f);margin:0;overflow-wrap:anywhere}.xp-settings .xp-path{overflow-wrap:anywhere;font-size:12px;opacity:.75}.xp-settings .xp-list{display:flex;flex-direction:column;gap:5px;max-height:240px;overflow:auto}.xp-settings .xp-entry{text-align:start;overflow-wrap:anywhere}.xp-settings .xp-list .xp-button{white-space:normal}.xp-settings .xp-browser{display:flex;flex-direction:column;gap:8px}.xp-settings .xp-browser summary{cursor:pointer}";
    function XpSettings({ configStore, audio, controller, fileBrowser, t }) {
      const config = useConfig(configStore);
      const id = "xp-" + React.useId();
      const tt = (key, params) => translate(t, key, params);
      const [error, setError] = React.useState("");
      const [resetVersion, setResetVersion] = React.useState(0);
      const source = useDraft(config.sound.src, resetVersion);
      const min = useDraft(config.durationMinSeconds, resetVersion);
      const max = useDraft(config.durationMaxSeconds, resetVersion);
      const rate = useDraft(config.orbsPerSecond, resetVersion);
      const [directory, setDirectory] = React.useState("");
      const [listing, setListing] = React.useState(null);
      const [history, setHistory] = React.useState([]);
      const [browsing, setBrowsing] = React.useState(false);
      const [previewBusy, setPreviewBusy] = React.useState(false);
      const [playing, setPlaying] = React.useState(false);
      const [ownPreview, setOwnPreview] = React.useState(false);
      const mounted = React.useRef(false);
      const browserRequest = React.useRef(null);
      const previewRequest = React.useRef(0);
      const owned = React.useRef(null);
      const report = (reason) => {
        if (mounted.current) setError(tt("actionFailed", { message: reason?.message || String(reason || tt("unknownError")) }));
      };
      React.useEffect(() => {
        mounted.current = true;
        const timer = setInterval(() => {
          try {
            const active = typeof controller?.isPlaying === "function" ? controller.isPlaying() : controller?.isPlaying;
            setPlaying(Boolean(active));
            const preview2 = owned.current;
            if (preview2 && !preview2.pending) {
              const failure = preview2.audio?.lastFailure?.("xp");
              if (failure && failure !== preview2.previousFailure) {
                preview2.previousFailure = failure;
                report(failure);
              }
              const takenOver = typeof controller?.isPreview === "function" && active && !controller.isPreview();
              if (active === false || takenOver || Date.now() >= preview2.until) {
                owned.current = null;
                setOwnPreview(false);
              }
            }
          } catch (reason) {
            report(reason);
          }
        }, 200);
        return () => {
          mounted.current = false;
          clearInterval(timer);
          browserRequest.current?.abort();
          previewRequest.current++;
          const preview2 = owned.current;
          owned.current = null;
          if (preview2 && (preview2.pending || Date.now() < preview2.until)) {
            try {
              Promise.resolve(stopOwned(preview2)).catch(() => {
              });
            } catch {
            }
          }
        };
      }, [controller]);
      async function save(partial) {
        setError("");
        try {
          if (!configStore?.set) throw new Error(tt("writeUnavailable"));
          if (await configStore.set(partial) === false) throw new Error(tt("writeFailed"));
          return true;
        } catch (reason) {
          report(reason);
          return false;
        }
      }
      async function saveSource(raw = source.value) {
        const src = raw.trim();
        if (!sourceIsValid(src)) {
          source.finish();
          setError(tt("sourceInvalid"));
          return false;
        }
        const sound = { ...readConfig(configStore).sound, src, source: isLocalPath(src) ? "file" : "url" };
        source.finish(src);
        return save({ sound });
      }
      async function saveNumber(field, draft, upper) {
        if (!draft.value.trim() || !Number.isFinite(Number(draft.value))) {
          draft.finish();
          setError(tt("numberInvalid"));
          return;
        }
        const value = clamp2(Number(draft.value), 0.1, upper, 0.1);
        const current = readConfig(configStore);
        const partial = { [field]: value };
        if (field === "durationMinSeconds") partial.durationMaxSeconds = Math.max(value, current.durationMaxSeconds);
        if (field === "durationMaxSeconds") partial.durationMinSeconds = Math.min(value, current.durationMinSeconds);
        draft.finish(value);
        await save(partial);
      }
      function numberInput(field, draft, label, upper, hint) {
        const commit = () => saveNumber(field, draft, upper);
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xp-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "xp-label", htmlFor: id + field, children: tt(label) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: id + field,
              className: "xp-input xp-number",
              type: "number",
              min: "0.1",
              max: upper,
              step: "0.1",
              value: draft.value,
              onChange: draft.onChange,
              onFocus: draft.onFocus,
              onBlur: commit,
              onKeyDown: (event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              },
              "aria-describedby": id + hint
            }
          )
        ] });
      }
      async function preview(rhythm) {
        setError("");
        if (!source.value.trim()) {
          setError(tt("previewEmpty"));
          return;
        }
        setPreviewBusy(true);
        const request = ++previewRequest.current;
        try {
          if (rhythm ? !controller?.preview : !audio?.preview) throw new Error(tt(rhythm ? "rhythmUnavailable" : "previewUnavailable"));
          await audio?.unlock?.();
          if (!mounted.current || previewRequest.current !== request || !await saveSource()) return;
          if (!mounted.current || previewRequest.current !== request) return;
          let result;
          if (rhythm) {
            owned.current = { controller, audio, request, previousFailure: audio?.lastFailure?.("xp"), pending: true, until: Date.now() + 1e4 };
            setOwnPreview(true);
            result = await controller.preview(10);
            if (owned.current?.request === request) {
              owned.current.pending = false;
              owned.current.until = Date.now() + 1e4;
            }
          } else {
            result = await audio.preview("xp", readConfig(configStore).sound);
          }
          if (request !== previewRequest.current) return;
          if (result === false) throw new Error(tt("previewFailed"));
        } catch (reason) {
          if (request !== previewRequest.current) return;
          if (rhythm) {
            owned.current = null;
            if (mounted.current) setOwnPreview(false);
          }
          report(reason);
        } finally {
          if (mounted.current && request === previewRequest.current) setPreviewBusy(false);
        }
      }
      async function stopPreview() {
        const preview2 = owned.current;
        if (!preview2) return;
        previewRequest.current++;
        owned.current = null;
        setOwnPreview(false);
        setPreviewBusy(false);
        setError("");
        try {
          await stopOwned(preview2);
          setPlaying(false);
        } catch (reason) {
          report(reason);
        }
      }
      async function browse(path, nextHistory = []) {
        if (!isLocalPath(path)) {
          setError(tt("directoryInvalid"));
          return;
        }
        if (!fileBrowser?.listAudioFiles) {
          setError(tt("browseUnavailable"));
          return;
        }
        browserRequest.current?.abort();
        const request = new AbortController();
        browserRequest.current = request;
        setBrowsing(true);
        setListing(null);
        setError("");
        try {
          const result = await fileBrowser.listAudioFiles(path.trim(), request.signal);
          if (!mounted.current || request.signal.aborted) return;
          if (!Array.isArray(result?.files) || !Array.isArray(result?.directories) || result.enumerable === false) throw new Error(tt("browseUnavailable"));
          setDirectory(path.trim());
          setHistory(nextHistory);
          setListing(result);
        } catch (reason) {
          if (!request.signal.aborted) report(reason);
        } finally {
          if (mounted.current && browserRequest.current === request) setBrowsing(false);
        }
      }
      async function pickDirectory() {
        if (!fileBrowser?.pickDirectory) {
          setError(tt("browseUnavailable"));
          return;
        }
        browserRequest.current?.abort();
        const request = new AbortController();
        browserRequest.current = request;
        setBrowsing(true);
        setError("");
        try {
          const path = await fileBrowser.pickDirectory(request.signal);
          if (!mounted.current || request.signal.aborted) return;
          if (path !== null) await browse(path);
        } catch (reason) {
          if (!request.signal.aborted) report(reason);
        } finally {
          if (mounted.current && browserRequest.current === request) setBrowsing(false);
        }
      }
      async function reset() {
        setError("");
        try {
          if (!configStore?.reset) throw new Error(tt("writeUnavailable"));
          if (await configStore.reset() === false) throw new Error(tt("writeFailed"));
          if (mounted.current) setResetVersion((value) => value + 1);
        } catch (reason) {
          report(reason);
        }
      }
      const configured = Boolean(source.value.trim());
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xp-settings", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", children: tt("description") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "xp-toggle", htmlFor: id + "enabled", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: id + "enabled", type: "checkbox", checked: config.enabled, onChange: (event) => save({ enabled: event.target.checked }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xp-label", children: tt("enabled") })
        ] }),
        !config.enabled && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", children: tt("disabledHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "xp-card", "aria-labelledby": id + "sound", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xp-label", id: id + "sound", children: tt("sound") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xp-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: id + "source", children: tt("source") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                id: id + "source",
                className: "xp-input xp-source",
                type: "text",
                value: source.value,
                placeholder: tt("sourcePlaceholder"),
                onChange: source.onChange,
                onFocus: source.onFocus,
                onBlur: () => saveSource(),
                onKeyDown: (event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                },
                "aria-describedby": id + "sourceHint",
                spellCheck: false
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", id: id + "sourceHint", children: tt("sourceHint") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xp-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: id + "volume", children: tt("volume") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                id: id + "volume",
                className: "xp-slider",
                type: "range",
                min: "0",
                max: "1",
                step: "0.01",
                value: config.sound.volume,
                onChange: (event) => save({ sound: { ...readConfig(configStore).sound, volume: Number(event.target.value) } }),
                "aria-describedby": id + "volumeHint"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("output", { htmlFor: id + "volume", children: tt("percent", { value: Math.round(config.sound.volume * 100) }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", id: id + "volumeHint", children: tt("volumeHint") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xp-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "xp-button", type: "button", disabled: !configured || previewBusy, onClick: () => preview(false), children: tt("previewSound") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "xp-button", type: "button", disabled: !configured || previewBusy || ownPreview, onClick: () => preview(true), children: tt("previewRhythm") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "xp-button", type: "button", disabled: !ownPreview, onClick: stopPreview, children: tt("stopPreview") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "xp-button", type: "button", disabled: !configured, onClick: () => {
              source.set("");
              saveSource("");
            }, children: tt("clear") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", children: tt("previewHint") }),
          playing && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", role: "status", children: tt("playing") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "xp-browser", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: tt("browse") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: id + "directory", children: tt("directory") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: id + "directory", className: "xp-input xp-source", type: "text", value: directory, onChange: (event) => setDirectory(event.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xp-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "xp-button", type: "button", disabled: browsing, onClick: pickDirectory, children: tt("chooseDirectory") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "xp-button", type: "button", disabled: browsing || !directory.trim(), onClick: () => browse(directory), children: tt("loadDirectory") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "xp-button", type: "button", disabled: browsing || !history.length, onClick: () => browse(history[history.length - 1], history.slice(0, -1)), children: tt("parentDirectory") }),
              listing && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "xp-button", type: "button", onClick: () => setListing(null), children: tt("closeBrowser") })
            ] }),
            browsing && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", role: "status", children: tt("loading") }),
            listing && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xp-list", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xp-path", children: directory }),
              listing.directories.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  className: "xp-button xp-entry",
                  type: "button",
                  onClick: () => browse(entry.path, [...history, directory]),
                  children: tt("openDirectory", { name: entry.name })
                },
                entry.path
              )),
              listing.files.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  className: "xp-button xp-entry",
                  type: "button",
                  onClick: () => {
                    source.set(entry.path);
                    saveSource(entry.path);
                  },
                  children: tt("selectFile", { name: entry.name })
                },
                entry.path
              )),
              !listing.files.length && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", children: tt("emptyDirectory") }),
              listing.truncated && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", children: tt("truncated") })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "xp-card", "aria-labelledby": id + "timing", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xp-label", id: id + "timing", children: tt("timing") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xp-row", children: [
            numberInput("durationMinSeconds", min, "durationMin", 30, "durationHint"),
            numberInput("durationMaxSeconds", max, "durationMax", 30, "durationHint")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", id: id + "durationHint", children: tt("durationHint") }),
          numberInput("orbsPerSecond", rate, "rate", 10, "rateHint"),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", id: id + "rateHint", children: tt("rateHint") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "xp-toggle", htmlFor: id + "background", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: id + "background", type: "checkbox", checked: config.playInBackground, onChange: (event) => save({ playInBackground: event.target.checked }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: tt("background") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-hint", children: tt("scopeHint") })
        ] }),
        error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "xp-error", role: "alert", children: error }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "xp-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "xp-button", type: "button", onClick: reset, children: tt("reset") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xp-hint", children: tt("savedHint") })
        ] })
      ] });
    }
    function XpSummary({ configStore, t }) {
      const config = useConfig(configStore);
      const tt = (key, params) => translate(t, key, params);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "xp-summary", children: tt("summary", {
        status: tt(config.enabled ? "summaryEnabled" : "summaryDisabled"),
        sound: tt(config.sound.src.trim() ? "summaryConfigured" : "summaryEmpty"),
        volume: Math.round(config.sound.volume * 100),
        min: config.durationMinSeconds,
        max: config.durationMaxSeconds,
        rate: config.orbsPerSecond
      }) });
    }

    // src/xp/index.js
    var inject = ["slots", "locale", "sessions", "uiSession", "uiWorkspace"];
    var ROUTE = "/dsh-chime-xp";
    function apply(ctx) {
      const configStore = createConfigStore();
      const presence = createPresence();
      const fileBrowser = createFileBrowser(ctx, { routePrefix: ROUTE });
      const allowed = () => {
        const config = configStore.getSnapshot();
        return config.playInBackground || presence.focused() && presence.visible();
      };
      const audio = createAudioEngine({
        allowOverlap: true,
        resolveSource: (src, source, kind) => toPlayableUrl(src, source, kind, ROUTE),
        shouldStart: () => allowed()
      });
      let burstAbort;
      const controller = createBurstController({
        getConfig: () => configStore.getSnapshot(),
        canPlay: allowed,
        onStateChange(playing) {
          if (playing) burstAbort = new AbortController();
          else burstAbort?.abort();
        },
        onOrb({ pitch }) {
          const signal = burstAbort?.signal;
          return audio.play("xp", {
            ...configStore.getSnapshot().sound,
            playbackRate: pitch,
            signal
          }).then((started) => {
            if (!started && !signal?.aborted && audio.lastFailure("xp")) controller.stop();
          });
        }
      });
      const stop = () => {
        controller.stop();
        audio.stop("xp");
      };
      const watcher = createToolResultWatcher({
        sessions: ctx.get("sessions"),
        uiSession: ctx.get("uiSession"),
        canTrigger: () => configStore.getSnapshot().enabled && allowed(),
        onToolResult: () => controller.trigger(),
        onStop: stop
      });
      ctx.effect(() => {
        let previous = configStore.getSnapshot();
        const prepare = () => {
          const sound = configStore.getSnapshot().sound;
          if (sound.src) void audio.prepare("xp", sound.src, sound.source);
        };
        const release = configStore.subscribe(() => {
          const config = configStore.getSnapshot();
          const changedSource = config.sound.src !== previous.sound.src || config.sound.source !== previous.sound.source;
          if (previous.enabled && !config.enabled || !config.sound.src || changedSource || !allowed()) stop();
          audio.setVolume("xp", config.sound.volume);
          previous = config;
          if (changedSource) prepare();
        });
        const onPresence = () => {
          if (!allowed()) stop();
        };
        const unlock = () => {
          if (!configStore.getSnapshot().sound.src) return;
          audio.unlock();
          prepare();
        };
        const doc = globalThis.document;
        const win = globalThis.window;
        doc?.addEventListener("visibilitychange", onPresence);
        win?.addEventListener("blur", onPresence);
        doc?.addEventListener("pointerdown", unlock, { capture: true });
        doc?.addEventListener("keydown", unlock, { capture: true });
        prepare();
        return () => {
          release();
          doc?.removeEventListener("visibilitychange", onPresence);
          win?.removeEventListener("blur", onPresence);
          doc?.removeEventListener("pointerdown", unlock, { capture: true });
          doc?.removeEventListener("keydown", unlock, { capture: true });
          watcher.dispose();
          controller.dispose();
          audio.dispose();
          configStore.dispose();
        };
      }, "dsh-chime-xp: lifecycle");
      ctx.effect(() => ctx.get("locale").register(NS, { zh, en }), "dsh-chime-xp: dictionaries");
      const previewAudio = {
        ...audio,
        preview: (kind, sound) => audio.preview(kind, { ...sound, playbackRate: samplePitch() })
      };
      const controls = {
        ...controller,
        stop,
        stopPreview() {
          if (!controller.isPreview()) return;
          controller.stopPreview();
          audio.stop("xp");
        }
      };
      const render = (props) => props.view === "summary" ? (0, import_react.createElement)(XpSummary, { t: props.t, configStore }) : (0, import_react.createElement)(XpSettings, { t: props.t, configStore, audio: previewAudio, controller: controls, fileBrowser });
      ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
        name: "plugins.row.config",
        key: "dsh-chime#chime-xp",
        locale: NS
      }, render));
    }

    return module.exports;
  }
});
