/**
 * Browser half of dsh-chime.
 *
 * Assembles the configuration store, the audio engine, the local-file bridge
 * and the event detector, then exposes the configuration form on the DSH
 * plugin page.
 *
 * Seat choice (see CONTRACT §2.4): `plugins.bundle.config`, keyed by the bundle
 * package name, renders the form directly on the plugin's own page — between
 * its description and its component rows — so no drilling into a row is needed.
 *
 * @module dsh-chime/client
 */
import { createElement } from 'react';
import { createConfigStore } from './config.js';
import { createAudioEngine } from './audio.js';
import { createFileBrowser, toPlayableUrl } from './assets.js';
import * as localAudioStore from './localAudioStore.js';
import { NS as LOCALE_NS, zh as localeZh, en as localeEn } from './locale.js';
import { createDetector } from './detect.js';
import { ChimeSettings, ChimeSummary } from './settings.jsx';

/** Hard dependencies resolved before `apply` runs. */
export const inject = ['slots', 'locale', 'sessions', 'remote', 'uiSession', 'uiWorkspace'];

/** Package name; also the browser module id used by the bundle wrapper. */
const PACKAGE_NAME = 'dsh-chime';

/**
 * Track how many background jobs each Session still owns.
 *
 * `running === false` alone never means "finished": background bash jobs and
 * background subagents keep running while the agent loop is idle (see
 * CONTRACT §3.5). This mirrors `ctx.remote.job.list`, which streams the
 * session's visible job roster as whole-set frames.
 *
 * @param {object} ctx - Client root context.
 * @returns {{count: (sessionId: string) => number, dispose: () => void}} counter.
 */
function createJobCounter(ctx) {
  /** @type {Map<string, number>} latest active-job count per Session. */
  const counts = new Map();
  /** @type {Map<string, AbortController>} one watch per Session. */
  const watches = new Map();
  let disposed = false;

  /** Open the roster stream for one Session, once. */
  function watch(sessionId) {
    if (disposed || sessionId === undefined || watches.has(sessionId)) return;
    const remote = ctx.get('remote');
    if (remote?.job?.list === undefined) return;
    const controller = new AbortController();
    watches.set(sessionId, controller);
    const consume = async () => {
      try {
        const frames = remote.job.list({ sessionId }, controller.signal);
        for await (const frame of frames) {
          if (frame?.type !== 'rows') continue;
          counts.set(
            sessionId,
            (frame.jobs ?? []).filter(
              (job) => job.status === 'running' || job.status === 'stopping',
            ).length,
          );
        }
      } catch {
        // A failing roster stream must never break sound playback.
      }
    };
    void consume();
  }

  return {
    /** Current active-job count; opens the watch on first use. */
    count(sessionId) {
      watch(sessionId);
      return counts.get(sessionId) ?? 0;
    },
    /** Stop every roster stream. */
    dispose() {
      disposed = true;
      for (const controller of watches.values()) controller.abort();
      watches.clear();
      counts.clear();
    },
  };
}

/**
 * Install the chime feature on one Client context.
 *
 * @param {object} ctx - Client root context.
 */
export function apply(ctx) {
  // Register both dictionaries and let DSH bind `t`, so the settings form
  // follows the active locale (CONTRACT §2.6).
  const locale = ctx.locale;
  if (typeof locale?.register === 'function') {
    ctx.effect(
      () => locale.register(LOCALE_NS, { zh: localeZh, en: localeEn }),
      'dsh-chime: dictionaries',
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
    resolveSource: (src, source, kind) => toPlayableUrl(src, source, kind),
  });

  const detector = createDetector({
    getConfig: () => configStore.getSnapshot(),
    getStatuses: () => {
      const uiSession = ctx.get('uiSession');
      return uiSession?.sessionStatus?.getSnapshot?.() ?? new Map();
    },
    getSessionList: () => ctx.get('sessions')?.list?.getSnapshot?.(),
    getAgentError: (sessionId) => {
      // `SessionStatus` carries no error text (CONTRACT §2.2), so borrow the
      // Session's own snapshot instead. `binding()` does not extend a
      // reference's lifetime, so a Session the UI never retained reads null.
      try {
        const borrowed = ctx.get('sessions')?.binding?.(sessionId);
        return borrowed?.session?.getSnapshot?.()?.lastAgentError ?? null;
      } catch {
        return null;
      }
    },
    getLastUserMessageTime: (sessionId) => {
      // The completion gate measures how long the task has run. Its start is
      // the newest `user/message` in the session log: approvals and answers do
      // not produce that event, so waiting for a human never resets the timer.
      // `null` means "unknown", which the detector treats as "ring anyway".
      try {
        const entries = ctx.get('sessions')?.binding?.(sessionId)?.eventSource
          ?.getSnapshot?.()?.entries;
        if (!Array.isArray(entries)) return null;
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const event = entries[index]?.event;
          if (event?.type === 'user/message' && Number.isFinite(event.time)) return event.time;
        }
        return null;
      } catch {
        return null;
      }
    },
    countActiveJobs: async (sessionId) => jobs.count(sessionId),
    onChime: ({ kind }) => {
      const config = configStore.getSnapshot();
      if (!config.enabled) return;
      const entry = config.kinds?.[kind];
      // Unset sound means silence — never fall back to a built-in tone.
      if (entry === undefined || entry.src === '') return;
      void audio.play(kind, entry);
    },
  });

  ctx.effect(() => {
    const stop = detector.start();
    return () => {
      if (typeof stop === 'function') stop();
      detector.dispose();
      jobs.dispose();
      audio.dispose();
      localAudioStore.releaseAll();
    };
  }, 'dsh-chime: lifecycle');

  // Browsers only allow an AudioContext to start inside a user gesture. Unlock
  // on the first interaction so later automatic chimes (turn completion,
  // approvals) — which have no gesture of their own — are still allowed to
  // make sound.
  ctx.effect(() => {
    const unlock = () => audio.unlock?.();
    // Try once immediately as well: when the page already carries user
    // activation (or the plugin loads after a gesture), this starts the
    // context without waiting for the next interaction.
    unlock();
    const events = ['pointerdown', 'keydown'];
    for (const type of events) {
      document.addEventListener(type, unlock, { capture: true, once: true });
    }
    return () => {
      for (const type of events) {
        document.removeEventListener(type, unlock, { capture: true });
      }
    };
  }, 'dsh-chime: audio unlock');

  /**
   * Render either the summary or the full form for a plugin-page seat.
   *
   * @param {object} props - slot props (`t`, `view`, ...).
   * @returns {import('react').ReactElement} the seat content.
   */
  function renderSeat(props) {
    const shared = { t: props.t, configStore };
    if (props.view === 'summary') return createElement(ChimeSummary, shared);
    return createElement(ChimeSettings, {
      ...shared,
      audioEngine: audio,
      fileBrowser,
      localAudioStore,
    });
  }

  // The bundle's own page renders this between its description and its rows,
  // so the form is visible without drilling into the row.
  ctx.slots.inject('plugins.bundle.config', () =>
    ctx.slots.register(
      { name: 'plugins.bundle.config', key: PACKAGE_NAME, locale: LOCALE_NS },
      renderSeat,
    ),
  );
}
