import { normalizeConfig } from './config.js';

/** Difference of two uniforms: triangular Minecraft-style pitch distribution. */
export function samplePitch(random = Math.random) {
  return 0.9 + (random() - random()) * 0.35;
}

/**
 * One half-open [start, end) burst, one timeout, no queued orbs or sessions.
 * onOrb({pitch}) and onStateChange(boolean) may return promises; failures are
 * contained. Pending onOrb calls never overlap; missed opportunities are dropped.
 *
 * getConfig/canPlay are synchronous getters. For immediate external changes,
 * call stop() from the owner's config/focus listeners, or attach subscribe(fn)
 * to either getter. Otherwise gates are checked on each callback/public read.
 * Preview bypasses enabled only, never source, canPlay or the shared rate limit.
 * All clock and timeout values are milliseconds; duration arguments are seconds.
 */
export function createBurstController({
  getConfig = () => ({}),
  onOrb = () => {},
  canPlay = () => true,
  now = () => globalThis.performance?.now() ?? Date.now(),
  setTimeout: scheduleTimeout = globalThis.setTimeout.bind(globalThis),
  clearTimeout: cancelTimeout = globalThis.clearTimeout.bind(globalThis),
  random = Math.random,
  onStateChange = () => {},
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
    try { Promise.resolve(onStateChange(value)).catch(() => {}); } catch { /* isolate UI */ }
  }

  function clearTimer() {
    timerVersion++;
    if (timer === null) return;
    const handle = timer;
    timer = null;
    try { cancelTimeout(handle); } catch { /* stale callbacks are version guarded */ }
  }

  function stop() {
    clearTimer();
    previewing = false;
    end = 0;
    if (!playing) return;
    playing = false;
    notify(false);
  }

  // Getters must be synchronous, but contain an accidental async rejection too.
  function sync(value) {
    if (value && typeof value.then === 'function') {
      Promise.resolve(value).catch(() => {});
      throw new TypeError('Burst getters must be synchronous');
    }
    return value;
  }

  function read(allowDisabled = previewing) {
    const config = normalizeConfig(sync(getConfig()));
    if (!config.sound.src || (!allowDisabled && !config.enabled) || !sync(canPlay(config))) return null;
    return config;
  }

  function time() {
    const value = sync(now());
    if (!Number.isFinite(value)) throw new TypeError('Invalid burst clock');
    return value;
  }

  const interval = (config) => Math.max(100, 1000 / config.orbsPerSecond);

  function emit(at) {
    if (inFlight) return;
    const pitch = samplePitch(random);
    if (!Number.isFinite(pitch)) throw new TypeError('Invalid pitch sample');
    lastOrb = at;
    inFlight = true;
    try {
      const result = onOrb({ pitch });
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).then(
          () => { inFlight = false; },
          () => { inFlight = false; },
        );
      } else {
        inFlight = false;
      }
    } catch { inFlight = false; }
  }

  function schedule(config, at) {
    if (!playing || disposed || timer !== null) return;
    const period = interval(config);
    const next = lastOrb + period;
    // A pending async orb must not create a zero-delay spin or a backlog.
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
      if (!config || at >= end) { stop(); return; }
      if (at >= lastOrb + interval(config)) emit(at);
      // onOrb may synchronously stop, dispose or extend the burst.
      if (playing && !disposed) schedule(config, time());
    } catch { stop(); }
  }

  function start(seconds, preview) {
    if (disposed) return false;
    try {
      const at = time();
      if (playing && (at >= end || !read())) stop();
      const config = read(preview);
      if (!config) {
        // A disabled tool trigger cannot extend an explicitly running preview.
        if (!previewing) stop();
        return false;
      }
      const duration = preview
        ? Math.min(30, Math.max(0.1, typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : 10))
        : config.durationMinSeconds + random() * (config.durationMaxSeconds - config.durationMinSeconds);
      if (!Number.isFinite(duration)) throw new TypeError('Invalid duration sample');
      const until = at + duration * 1000;
      if (playing) {
        end = Math.max(end, until);
        // A live tool result takes ownership from a preview; closing the UI must not stop it.
        previewing = preview;
        // Keep the existing timer; it rechecks the new deadline when it fires.
        return true;
      }
      previewing = preview;
      end = until;
      playing = true;
      notify(true);
      if (!playing || disposed) return false;
      // Keep the rate limit across stop/restart and repeated previews too.
      if (at >= lastOrb + interval(config)) emit(at);
      if (playing && !disposed) schedule(config, time());
      return playing;
    } catch { stop(); return false; }
  }

  function isPlaying() {
    if (!playing || disposed) return false;
    try { if (!read() || time() >= end) stop(); } catch { stop(); }
    return playing;
  }

  // Optional observability without imposing a store type on the public API.
  for (const getter of [getConfig, canPlay]) {
    if (typeof getter.subscribe !== 'function') continue;
    try {
      const unsubscribe = getter.subscribe(() => { isPlaying(); });
      if (typeof unsubscribe === 'function') unsubscribers.push(unsubscribe);
    } catch { /* caller can still stop explicitly */ }
  }

  return {
    trigger: () => start(undefined, false),
    preview: (seconds = 10) => start(seconds, true),
    stop,
    stopPreview: () => { if (previewing) stop(); },
    isPreview: () => isPlaying() && previewing,
    isPlaying,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { Promise.resolve(unsubscribe()).catch(() => {}); } catch { /* isolate teardown */ }
      }
    },
  };
}
