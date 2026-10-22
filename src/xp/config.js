/** Independent XP preferences; never reads or writes notification configuration. */
export const STORAGE_KEY = 'dsh.chime.xp.config.v1';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  sound: Object.freeze({ src: '', source: 'url', volume: 0.1 }),
  durationMinSeconds: 1,
  durationMaxSeconds: 3,
  orbsPerSecond: 6,
  playInBackground: false,
});

const object = (value) => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const clamp = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(max, Math.max(min, value)) : fallback;

/** New, independent object; reversed duration endpoints are sorted after clamping. */
export function normalizeConfig(raw) {
  const value = object(raw) ? raw : {};
  const sound = object(value.sound) ? value.sound : {};
  const min = clamp(value.durationMinSeconds, 0.1, 30, DEFAULT_CONFIG.durationMinSeconds);
  const max = clamp(value.durationMaxSeconds, 0.1, 30, DEFAULT_CONFIG.durationMaxSeconds);
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_CONFIG.enabled,
    sound: {
      src: typeof sound.src === 'string' ? sound.src.trim() : '',
      source: ['url', 'file', 'local'].includes(sound.source) ? sound.source : 'url',
      volume: clamp(sound.volume, 0, 1, DEFAULT_CONFIG.sound.volume),
    },
    durationMinSeconds: Math.min(min, max),
    durationMaxSeconds: Math.max(min, max),
    orbsPerSecond: clamp(value.orbsPerSecond, 0.1, 10, DEFAULT_CONFIG.orbsPerSecond),
    playInBackground: typeof value.playInBackground === 'boolean'
      ? value.playInBackground : DEFAULT_CONFIG.playInBackground,
  };
}

function freeze(config) {
  Object.freeze(config.sound);
  return Object.freeze(config);
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function parse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

/**
 * Observable snapshot store. Unlike the notification store: set(partial) merges
 * sound fields, storage events synchronize other tabs, and dispose releases them.
 * Optional storage/eventTarget injection makes storage failures and sync testable.
 * Snapshots are deeply frozen; unchanged writes keep their original identity.
 */
export function createConfigStore({ storage = browserStorage(), eventTarget = globalThis.window } = {}) {
  const listeners = new Set();
  let disposed = false;
  let persisted;
  try { persisted = parse(storage?.getItem(STORAGE_KEY)); } catch { /* memory-only */ }
  let snapshot = freeze(normalizeConfig(persisted));

  function commit(raw, persist) {
    if (disposed) return snapshot;
    const next = freeze(normalizeConfig(raw));
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return snapshot;
    snapshot = next;
    if (persist) {
      try { storage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* memory-only */ }
    }
    for (const listener of [...listeners]) {
      try { Promise.resolve(listener(next)).catch(() => {}); } catch { /* isolate listeners */ }
    }
    return snapshot;
  }

  function onStorage(event) {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== storage) return;
    commit(event.key === null ? undefined : parse(event.newValue), false);
  }
  try { eventTarget?.addEventListener('storage', onStorage); } catch { /* no browser events */ }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed || typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(partial) {
      if (!object(partial)) return snapshot;
      return commit({ ...snapshot, ...partial,
        sound: object(partial.sound) ? { ...snapshot.sound, ...partial.sound } : snapshot.sound,
      }, true);
    },
    reset: () => commit(DEFAULT_CONFIG, true),
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      try { eventTarget?.removeEventListener('storage', onStorage); } catch { /* unavailable */ }
    },
  };
}
