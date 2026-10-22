/** Browser entry owned only by the optional chime-xp Loader row. */
import { createElement } from 'react';
import { createAudioEngine } from '../client/audio.js';
import { createFileBrowser, toPlayableUrl } from '../client/assets.js';
import { createPresence } from '../client/presence.js';
import { createConfigStore } from './config.js';
import { createBurstController, samplePitch } from './burst.js';
import { createToolResultWatcher } from './tools.js';
import { XpSettings, XpSummary } from './settings.jsx';
import { NS, zh, en } from './locale.js';

export const inject = ['slots', 'locale', 'sessions', 'uiSession', 'uiWorkspace'];
const ROUTE = '/dsh-chime-xp';

export function apply(ctx) {
  const configStore = createConfigStore();
  const presence = createPresence();
  const fileBrowser = createFileBrowser(ctx, { routePrefix: ROUTE });
  const allowed = () => {
    const config = configStore.getSnapshot();
    return config.playInBackground || (presence.focused() && presence.visible());
  };
  const audio = createAudioEngine({
    allowOverlap: true,
    resolveSource: (src, source, kind) => toPlayableUrl(src, source, kind, ROUTE),
    shouldStart: () => allowed(),
  });
  let burstAbort;
  const controller = createBurstController({
    getConfig: () => configStore.getSnapshot(),
    canPlay: allowed,
    onStateChange(playing) {
      if (playing) burstAbort = new AbortController();
      else burstAbort?.abort(); // Discard pending starts, let decoded tails finish naturally.
    },
    onOrb({ pitch }) {
      const signal = burstAbort?.signal;
      return audio.play('xp', { ...configStore.getSnapshot().sound,
        playbackRate: pitch, signal }).then((started) => {
        // A cancelled old request must never stop a newer burst.
        if (!started && !signal?.aborted && audio.lastFailure('xp')) controller.stop();
      });
    },
  });
  const stop = () => {
    controller.stop();
    audio.stop('xp');
  };
  const watcher = createToolResultWatcher({
    sessions: ctx.get('sessions'), uiSession: ctx.get('uiSession'),
    canTrigger: () => configStore.getSnapshot().enabled && allowed(),
    onToolResult: () => controller.trigger(),
    onStop: stop,
  });

  ctx.effect(() => {
    let previous = configStore.getSnapshot();
    const prepare = () => {
      const sound = configStore.getSnapshot().sound;
      if (sound.src) void audio.prepare('xp', sound.src, sound.source);
    };
    const release = configStore.subscribe(() => {
      const config = configStore.getSnapshot();
      const changedSource = config.sound.src !== previous.sound.src || config.sound.source !== previous.sound.source;
      if ((previous.enabled && !config.enabled) || !config.sound.src || changedSource || !allowed()) stop();
      audio.setVolume('xp', config.sound.volume);
      previous = config;
      if (changedSource) prepare();
    });
    const onPresence = () => { if (!allowed()) stop(); };
    const unlock = () => {
      if (!configStore.getSnapshot().sound.src) return;
      audio.unlock();
      prepare();
    };
    const doc = globalThis.document;
    const win = globalThis.window;
    doc?.addEventListener('visibilitychange', onPresence);
    win?.addEventListener('blur', onPresence);
    doc?.addEventListener('pointerdown', unlock, { capture: true });
    doc?.addEventListener('keydown', unlock, { capture: true });
    prepare();
    return () => {
      release();
      doc?.removeEventListener('visibilitychange', onPresence);
      win?.removeEventListener('blur', onPresence);
      doc?.removeEventListener('pointerdown', unlock, { capture: true });
      doc?.removeEventListener('keydown', unlock, { capture: true });
      watcher.dispose();
      controller.dispose();
      audio.dispose();
      configStore.dispose();
    };
  }, 'dsh-chime-xp: lifecycle');

  ctx.effect(() => ctx.get('locale').register(NS, { zh, en }), 'dsh-chime-xp: dictionaries');

  // A single-note preview uses the same MC distribution as automatic orbs.
  const previewAudio = {
    ...audio,
    preview: (kind, sound) => audio.preview(kind, { ...sound, playbackRate: samplePitch() }),
  };
  const controls = {
    ...controller, stop,
    stopPreview() {
      if (!controller.isPreview()) return;
      controller.stopPreview();
      audio.stop('xp');
    },
  };
  const render = (props) => props.view === 'summary'
    ? createElement(XpSummary, { t: props.t, configStore })
    : createElement(XpSettings, { t: props.t, configStore, audio: previewAudio, controller: controls, fileBrowser });
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config', key: 'dsh-chime#chime-xp', locale: NS,
  }, render));
}
