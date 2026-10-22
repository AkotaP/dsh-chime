/** Independent components-row UI. The entry point owns registration and locale binding. */
import * as React from 'react';
import { isLocalPath } from '../client/assets.js';
import { zh } from './locale.js';

const DEFAULT = {
  enabled: false,
  sound: { src: '', source: 'url', volume: 0.1 },
  durationMinSeconds: 1,
  durationMaxSeconds: 3,
  orbsPerSecond: 6,
  playInBackground: false,
};
const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

function readConfig(store) {
  const value = store?.getSnapshot?.() || DEFAULT;
  const min = clamp(value.durationMinSeconds, 0.1, 30, 1);
  return {
    enabled: value.enabled === true,
    sound: {
      src: typeof value.sound?.src === 'string' ? value.sound.src : '',
      source: value.sound?.source === 'file' ? 'file' : 'url',
      volume: clamp(value.sound?.volume, 0, 1, 0.1),
    },
    durationMinSeconds: min,
    durationMaxSeconds: Math.max(min, clamp(value.durationMaxSeconds, 0.1, 30, 3)),
    orbsPerSecond: clamp(value.orbsPerSecond, 0.1, 10, 6),
    playInBackground: value.playInBackground === true,
  };
}

function useConfig(store) {
  const [config, setConfig] = React.useState(() => readConfig(store));
  React.useEffect(() => {
    const sync = () => setConfig(readConfig(store));
    const unsubscribe = store?.subscribe?.(sync);
    sync(); // Close the render/subscribe gap without requiring referentially stable snapshots.
    return () => unsubscribe?.();
  }, [store]);
  return config;
}

function translate(t, key, params = {}) {
  const translated = t?.(key, params);
  const text = typeof translated === 'string' && translated && translated !== key ? translated : zh[key] || key;
  return text.replace(/\{(\w+)\}/g, (match, name) => params[name] === undefined ? match : String(params[name]));
}

// stopPreview is an optional atomic guard when a live tool event takes over a UI preview.
function stopOwned(preview) {
  const controller = preview.controller;
  if (typeof controller.stopPreview === 'function') return controller.stopPreview();
  if (typeof controller.isPreview === 'function' && !controller.isPreview()) return;
  return controller.stop();
}

function sourceIsValid(src) {
  if (!src || isLocalPath(src)) return true;
  try { return /^https?:$/.test(new URL(src).protocol); } catch { return false; }
}

// Keep drafts separate from persisted values: clearing a field or entering "0." must not save/reset it.
function useDraft(value, resetVersion) {
  const [draft, setDraft] = React.useState(String(value));
  const editing = React.useRef(false);
  React.useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  React.useEffect(() => { editing.current = false; setDraft(String(value)); }, [resetVersion]);
  return {
    value: draft,
    onFocus: () => { editing.current = true; },
    onChange: event => { editing.current = true; setDraft(event.target.value); },
    finish: next => { editing.current = false; if (next !== undefined) setDraft(String(next)); },
    set: next => { editing.current = false; setDraft(String(next)); },
  };
}

const CSS =
  '.xp-settings{display:flex;flex-direction:column;gap:14px;color:inherit;font-size:13px;line-height:1.55;padding:2px 0}' +
  '.xp-settings .xp-card{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid rgba(127,127,127,.28);border-radius:10px;min-width:0}' +
  '.xp-settings .xp-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}' +
  '.xp-settings .xp-field{display:flex;flex-direction:column;gap:4px;min-width:0}' +
  '.xp-settings .xp-label{font-weight:600}.xp-settings .xp-hint{font-size:12px;opacity:.68;margin:0}' +
  '.xp-settings .xp-input,.xp-settings .xp-button{font:inherit;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.35);border-radius:6px;padding:5px 8px}' +
  '.xp-settings .xp-source{width:100%;box-sizing:border-box}.xp-settings .xp-number{width:100px}' +
  '.xp-settings .xp-button{cursor:pointer}.xp-settings .xp-button:disabled{opacity:.45;cursor:default}' +
  '.xp-settings .xp-toggle{display:flex;align-items:center;gap:8px}.xp-settings .xp-toggle input{margin:0;accent-color:currentColor}' +
  '.xp-settings .xp-slider{width:160px;max-width:100%;accent-color:currentColor}' +
  '.xp-settings .xp-error{color:var(--color-danger,#d9534f);margin:0;overflow-wrap:anywhere}' +
  '.xp-settings .xp-path{overflow-wrap:anywhere;font-size:12px;opacity:.75}' +
  '.xp-settings .xp-list{display:flex;flex-direction:column;gap:5px;max-height:240px;overflow:auto}' +
  '.xp-settings .xp-entry{text-align:start;overflow-wrap:anywhere}.xp-settings .xp-list .xp-button{white-space:normal}' +
  '.xp-settings .xp-browser{display:flex;flex-direction:column;gap:8px}.xp-settings .xp-browser summary{cursor:pointer}';

/**
 * XP settings for the components row only; writes only the injected XP store.
 * @param {{configStore: {getSnapshot: Function, subscribe: Function, set: Function, reset: Function},
 * audio: {unlock?: Function, preview: Function}, controller: {preview: Function, stop: Function, isPlaying?: Function|boolean, isPreview?: Function, stopPreview?: Function},
 * fileBrowser?: {pickDirectory: Function, listAudioFiles: Function}, t?: Function}} props
 * @returns {import('react').ReactElement}
 */
export function XpSettings({ configStore, audio, controller, fileBrowser, t }) {
  const config = useConfig(configStore);
  const id = 'xp-' + React.useId();
  const tt = (key, params) => translate(t, key, params);
  const [error, setError] = React.useState('');
  const [resetVersion, setResetVersion] = React.useState(0);
  const source = useDraft(config.sound.src, resetVersion);
  const min = useDraft(config.durationMinSeconds, resetVersion);
  const max = useDraft(config.durationMaxSeconds, resetVersion);
  const rate = useDraft(config.orbsPerSecond, resetVersion);
  const [directory, setDirectory] = React.useState('');
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

  const report = reason => {
    if (mounted.current) setError(tt('actionFailed', { message: reason?.message || String(reason || tt('unknownError')) }));
  };

  React.useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => {
      try {
        const active = typeof controller?.isPlaying === 'function' ? controller.isPlaying() : controller?.isPlaying;
        setPlaying(Boolean(active));
        const preview = owned.current;
        if (preview && !preview.pending) {
          const failure = preview.audio?.lastFailure?.('xp');
          if (failure && failure !== preview.previousFailure) {
            preview.previousFailure = failure;
            report(failure);
          }
          const takenOver = typeof controller?.isPreview === 'function' && active && !controller.isPreview();
          if (active === false || takenOver || Date.now() >= preview.until) {
            owned.current = null;
            setOwnPreview(false);
          }
        }
      } catch (reason) { report(reason); }
    }, 200);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      browserRequest.current?.abort();
      previewRequest.current++;
      // Never stop automatic playback merely because its settings page was closed.
      const preview = owned.current;
      owned.current = null;
      if (preview && (preview.pending || Date.now() < preview.until)) {
        try { Promise.resolve(stopOwned(preview)).catch(() => {}); } catch { /* No mounted UI for errors. */ }
      }
    };
  }, [controller]);

  async function save(partial) {
    setError('');
    try {
      if (!configStore?.set) throw new Error(tt('writeUnavailable'));
      if (await configStore.set(partial) === false) throw new Error(tt('writeFailed'));
      return true;
    } catch (reason) { report(reason); return false; }
  }

  async function saveSource(raw = source.value) {
    const src = raw.trim();
    if (!sourceIsValid(src)) { source.finish(); setError(tt('sourceInvalid')); return false; }
    const sound = { ...readConfig(configStore).sound, src, source: isLocalPath(src) ? 'file' : 'url' };
    source.finish(src);
    return save({ sound });
  }

  async function saveNumber(field, draft, upper) {
    if (!draft.value.trim() || !Number.isFinite(Number(draft.value))) {
      draft.finish();
      setError(tt('numberInvalid'));
      return;
    }
    const value = clamp(Number(draft.value), 0.1, upper, 0.1);
    const current = readConfig(configStore);
    const partial = { [field]: value };
    if (field === 'durationMinSeconds') partial.durationMaxSeconds = Math.max(value, current.durationMaxSeconds);
    if (field === 'durationMaxSeconds') partial.durationMinSeconds = Math.min(value, current.durationMinSeconds);
    draft.finish(value);
    await save(partial);
  }

  function numberInput(field, draft, label, upper, hint) {
    const commit = () => saveNumber(field, draft, upper);
    return <div className="xp-field">
      <label className="xp-label" htmlFor={id + field}>{tt(label)}</label>
      <input id={id + field} className="xp-input xp-number" type="number" min="0.1" max={upper} step="0.1"
        value={draft.value} onChange={draft.onChange} onFocus={draft.onFocus} onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        aria-describedby={id + hint} />
    </div>;
  }

  async function preview(rhythm) {
    setError('');
    if (!source.value.trim()) { setError(tt('previewEmpty')); return; }
    setPreviewBusy(true);
    const request = ++previewRequest.current;
    try {
      if (rhythm ? !controller?.preview : !audio?.preview) throw new Error(tt(rhythm ? 'rhythmUnavailable' : 'previewUnavailable'));
      await audio?.unlock?.();
      if (!mounted.current || previewRequest.current !== request || !await saveSource()) return;
      if (!mounted.current || previewRequest.current !== request) return;
      let result;
      if (rhythm) {
        owned.current = { controller, audio, request, previousFailure: audio?.lastFailure?.('xp'), pending: true, until: Date.now() + 10000 };
        setOwnPreview(true);
        result = await controller.preview(10);
        if (owned.current?.request === request) {
          owned.current.pending = false;
          owned.current.until = Date.now() + 10000;
        }
      } else {
        // The entry-point facade applies the same MC pitch distribution to single-note previews.
        result = await audio.preview('xp', readConfig(configStore).sound);
      }
      if (request !== previewRequest.current) return;
      if (result === false) throw new Error(tt('previewFailed'));
    } catch (reason) {
      if (request !== previewRequest.current) return;
      if (rhythm) { owned.current = null; if (mounted.current) setOwnPreview(false); }
      report(reason);
    } finally {
      if (mounted.current && request === previewRequest.current) setPreviewBusy(false);
    }
  }

  async function stopPreview() {
    const preview = owned.current;
    if (!preview) return;
    previewRequest.current++;
    owned.current = null;
    setOwnPreview(false);
    setPreviewBusy(false);
    setError('');
    try { await stopOwned(preview); setPlaying(false); } catch (reason) { report(reason); }
  }

  async function browse(path, nextHistory = []) {
    if (!isLocalPath(path)) { setError(tt('directoryInvalid')); return; }
    if (!fileBrowser?.listAudioFiles) { setError(tt('browseUnavailable')); return; }
    browserRequest.current?.abort();
    const request = new AbortController();
    browserRequest.current = request;
    setBrowsing(true);
    setListing(null);
    setError('');
    try {
      const result = await fileBrowser.listAudioFiles(path.trim(), request.signal);
      if (!mounted.current || request.signal.aborted) return;
      if (!Array.isArray(result?.files) || !Array.isArray(result?.directories) || result.enumerable === false) throw new Error(tt('browseUnavailable'));
      setDirectory(path.trim());
      setHistory(nextHistory);
      setListing(result);
    } catch (reason) { if (!request.signal.aborted) report(reason); }
    finally { if (mounted.current && browserRequest.current === request) setBrowsing(false); }
  }

  async function pickDirectory() {
    if (!fileBrowser?.pickDirectory) { setError(tt('browseUnavailable')); return; }
    browserRequest.current?.abort();
    const request = new AbortController();
    browserRequest.current = request;
    setBrowsing(true);
    setError('');
    try {
      const path = await fileBrowser.pickDirectory(request.signal);
      if (!mounted.current || request.signal.aborted) return;
      if (path !== null) await browse(path);
    } catch (reason) { if (!request.signal.aborted) report(reason); }
    finally { if (mounted.current && browserRequest.current === request) setBrowsing(false); }
  }

  async function reset() {
    setError('');
    try {
      if (!configStore?.reset) throw new Error(tt('writeUnavailable'));
      if (await configStore.reset() === false) throw new Error(tt('writeFailed'));
      if (mounted.current) setResetVersion(value => value + 1);
    } catch (reason) { report(reason); }
  }

  const configured = Boolean(source.value.trim());
  return <div className="xp-settings">
    <style>{CSS}</style>
    <p className="xp-hint">{tt('description')}</p>
    <label className="xp-toggle" htmlFor={id + 'enabled'}>
      <input id={id + 'enabled'} type="checkbox" checked={config.enabled} onChange={event => save({ enabled: event.target.checked })} />
      <span className="xp-label">{tt('enabled')}</span>
    </label>
    {!config.enabled && <p className="xp-hint">{tt('disabledHint')}</p>}
    <section className="xp-card" aria-labelledby={id + 'sound'}>
      <div className="xp-label" id={id + 'sound'}>{tt('sound')}</div>
      <div className="xp-field">
        <label htmlFor={id + 'source'}>{tt('source')}</label>
        <input id={id + 'source'} className="xp-input xp-source" type="text" value={source.value}
          placeholder={tt('sourcePlaceholder')} onChange={source.onChange} onFocus={source.onFocus}
          onBlur={() => saveSource()} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          aria-describedby={id + 'sourceHint'} spellCheck={false} />
        <p className="xp-hint" id={id + 'sourceHint'}>{tt('sourceHint')}</p>
      </div>
      <div className="xp-row">
        <label htmlFor={id + 'volume'}>{tt('volume')}</label>
        <input id={id + 'volume'} className="xp-slider" type="range" min="0" max="1" step="0.01" value={config.sound.volume}
          onChange={event => save({ sound: { ...readConfig(configStore).sound, volume: Number(event.target.value) } })}
          aria-describedby={id + 'volumeHint'} />
        <output htmlFor={id + 'volume'}>{tt('percent', { value: Math.round(config.sound.volume * 100) })}</output>
      </div>
      <p className="xp-hint" id={id + 'volumeHint'}>{tt('volumeHint')}</p>
      <div className="xp-row">
        <button className="xp-button" type="button" disabled={!configured || previewBusy} onClick={() => preview(false)}>{tt('previewSound')}</button>
        <button className="xp-button" type="button" disabled={!configured || previewBusy || ownPreview} onClick={() => preview(true)}>{tt('previewRhythm')}</button>
        <button className="xp-button" type="button" disabled={!ownPreview} onClick={stopPreview}>{tt('stopPreview')}</button>
        <button className="xp-button" type="button" disabled={!configured} onClick={() => { source.set(''); saveSource(''); }}>{tt('clear')}</button>
      </div>
      <p className="xp-hint">{tt('previewHint')}</p>
      {playing && <p className="xp-hint" role="status">{tt('playing')}</p>}
      <details className="xp-browser">
        <summary>{tt('browse')}</summary>
        <label htmlFor={id + 'directory'}>{tt('directory')}</label>
        <input id={id + 'directory'} className="xp-input xp-source" type="text" value={directory} onChange={event => setDirectory(event.target.value)} />
        <div className="xp-row">
          <button className="xp-button" type="button" disabled={browsing} onClick={pickDirectory}>{tt('chooseDirectory')}</button>
          <button className="xp-button" type="button" disabled={browsing || !directory.trim()} onClick={() => browse(directory)}>{tt('loadDirectory')}</button>
          <button className="xp-button" type="button" disabled={browsing || !history.length} onClick={() => browse(history[history.length - 1], history.slice(0, -1))}>{tt('parentDirectory')}</button>
          {listing && <button className="xp-button" type="button" onClick={() => setListing(null)}>{tt('closeBrowser')}</button>}
        </div>
        {browsing && <p className="xp-hint" role="status">{tt('loading')}</p>}
        {listing && <div className="xp-list">
          <div className="xp-path">{directory}</div>
          {listing.directories.map(entry => <button className="xp-button xp-entry" type="button" key={entry.path}
            onClick={() => browse(entry.path, [...history, directory])}>{tt('openDirectory', { name: entry.name })}</button>)}
          {listing.files.map(entry => <button className="xp-button xp-entry" type="button" key={entry.path}
            onClick={() => { source.set(entry.path); saveSource(entry.path); }}>{tt('selectFile', { name: entry.name })}</button>)}
          {!listing.files.length && <p className="xp-hint">{tt('emptyDirectory')}</p>}
          {listing.truncated && <p className="xp-hint">{tt('truncated')}</p>}
        </div>}
      </details>
    </section>
    <section className="xp-card" aria-labelledby={id + 'timing'}>
      <div className="xp-label" id={id + 'timing'}>{tt('timing')}</div>
      <div className="xp-row">
        {numberInput('durationMinSeconds', min, 'durationMin', 30, 'durationHint')}
        {numberInput('durationMaxSeconds', max, 'durationMax', 30, 'durationHint')}
      </div>
      <p className="xp-hint" id={id + 'durationHint'}>{tt('durationHint')}</p>
      {numberInput('orbsPerSecond', rate, 'rate', 10, 'rateHint')}
      <p className="xp-hint" id={id + 'rateHint'}>{tt('rateHint')}</p>
      <label className="xp-toggle" htmlFor={id + 'background'}>
        <input id={id + 'background'} type="checkbox" checked={config.playInBackground} onChange={event => save({ playInBackground: event.target.checked })} />
        <span>{tt('background')}</span>
      </label>
      <p className="xp-hint">{tt('scopeHint')}</p>
    </section>
    {error && <p className="xp-error" role="alert">{error}</p>}
    <div className="xp-row">
      <button className="xp-button" type="button" onClick={reset}>{tt('reset')}</button>
      <span className="xp-hint">{tt('savedHint')}</span>
    </div>
  </div>;
}

/** @param {{configStore: object, t?: Function}} props @returns {import('react').ReactElement} */
export function XpSummary({ configStore, t }) {
  const config = useConfig(configStore);
  const tt = (key, params) => translate(t, key, params);
  return <span className="xp-summary">{tt('summary', {
    status: tt(config.enabled ? 'summaryEnabled' : 'summaryDisabled'),
    sound: tt(config.sound.src.trim() ? 'summaryConfigured' : 'summaryEmpty'),
    volume: Math.round(config.sound.volume * 100),
    min: config.durationMinSeconds,
    max: config.durationMaxSeconds,
    rate: config.orbsPerSecond,
  })}</span>;
}
