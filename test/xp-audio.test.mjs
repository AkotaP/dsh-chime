import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioEngine, AUDIO_FAILURES } from '../src/client/audio.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

/** Isolated browser fakes; no actual audio, network, or build artifacts. */
function fixture(t, options = {}) {
  const contexts = [], nodes = [], gains = [], elements = [], requests = [];
  let decodeCount = 0;
  class FakeContext {
    constructor() {
      this.state = options.suspended ? 'suspended' : 'running';
      this.currentTime = 7;
      this.destination = {};
      this.closed = 0;
      contexts.push(this);
    }
    resume() {
      if (options.resume) return options.resume.promise.then(() => { this.state = 'running'; });
      return Promise.resolve();
    }
    decodeAudioData(bytes) {
      decodeCount++;
      if (options.decode) return options.decode(bytes, decodeCount);
      return Promise.resolve({ duration: 2 });
    }
    createBufferSource() {
      const node = {
        playbackRate: { value: 1 }, starts: 0, stops: 0, disconnects: 0,
        connect(target) { this.target = target; },
        start() { this.starts++; },
        stop() { this.stops++; this.onended?.(); },
        disconnect() { this.disconnects++; },
        end() { this.onended?.(); },
      };
      nodes.push(node);
      return node;
    }
    createGain() {
      const gain = {
        gain: { value: 1, setValueAtTime(value, time) { this.value = value; this.time = time; } },
        disconnects: 0,
        connect(target) { this.target = target; },
        disconnect() { this.disconnects++; },
      };
      gains.push(gain);
      return gain;
    }
    close() { this.closed++; this.state = 'closed'; return Promise.resolve(); }
  }
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.preservesPitch = this.mozPreservesPitch = this.webkitPreservesPitch = true;
      this.playbackRate = 1;
      this.paused = true;
      this.pauses = 0;
      this.loads = 0;
      elements.push(this);
    }
    play() {
      if (options.elementError) return Promise.reject(options.elementError);
      if (options.elementPlay) return options.elementPlay.promise.then(() => { this.paused = false; });
      this.paused = false;
      return Promise.resolve();
    }
    pause() { this.paused = true; this.pauses++; }
    load() { this.loads++; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    end() { this.onended?.(); }
  }
  const replacements = {
    AudioContext: options.webAudio === false ? undefined : FakeContext,
    webkitAudioContext: undefined,
    Audio: options.audio === false ? undefined : FakeAudio,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return options.fetch ? options.fetch(url, init, requests.length) : response();
    },
  };
  const originals = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const engine = createAudioEngine(options.deps);
  t.after(() => {
    engine.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { engine, contexts, nodes, gains, elements, requests, get decodeCount() { return decodeCount; } };
}
const sound = (extra = {}) => ({ src: '/orb.wav', source: 'url', ...extra });

test('BufferSource receives default/explicit pitch on play and preview; invalid rates default and finite rates clamp', async t => {
  const f = fixture(t);
  for (const [method, rate, expected] of [
    ['play', undefined, 1], ['play', 0.55, 0.55], ['preview', 1.25, 1.25],
    ['play', NaN, 1], ['preview', Infinity, 1], ['play', '0.8', 1],
    ['play', -1, 0.25], ['play', 9, 4], ['preview', undefined, 1],
  ]) {
    assert.equal(await f.engine[method]('xp', sound({ playbackRate: rate })), true);
    assert.equal(f.nodes.at(-1).playbackRate.value, expected);
  }
  assert.equal(f.requests.length, 1);
  assert.equal(f.decodeCount, 1);
  assert.equal(f.gains.at(-1).gain.value, 0.8);
});

test('default notification mode interrupts only the same kind, including preview', async t => {
  const f = fixture(t);
  await f.engine.play('completed', sound());
  await f.engine.play('approval', sound());
  await f.engine.preview('completed', sound());
  assert.equal(f.nodes[0].stops, 1);
  assert.equal(f.nodes[0].disconnects, 1);
  assert.equal(f.gains[0].disconnects, 1);
  assert.equal(f.nodes[1].stops, 0);
  assert.equal(f.nodes[2].stops, 0);
});

test('overlap retains independent tails, setVolume updates all, and natural end disconnects exactly its own nodes', async t => {
  const f = fixture(t, { deps: { allowOverlap: true } });
  await f.engine.play('xp', sound({ playbackRate: 0.7 }));
  await f.engine.preview('xp', sound({ playbackRate: 1.1 }));
  assert.equal(f.nodes[0].stops, 0);
  assert.equal(f.engine.setVolume('xp', 0.3), 0.3);
  assert.deepEqual(f.gains.map(gain => gain.gain.value), [0.3, 0.3]);
  f.nodes[0].end();
  assert.equal(f.nodes[0].disconnects, 1);
  assert.equal(f.gains[0].disconnects, 1);
  assert.equal(f.nodes[1].disconnects, 0);
  f.nodes[1].end();
  f.engine.dispose();
  assert.deepEqual(f.nodes.map(node => node.stops), [0, 0]);
  assert.deepEqual(f.gains.map(gain => gain.disconnects), [1, 1]);
});

test('overlap is bounded to 32 voices globally and evicts the oldest source and gain', async t => {
  const f = fixture(t, { deps: { allowOverlap: true } });
  for (let i = 0; i < 35; i++) await f.engine.play(i % 2 ? 'xp' : 'other', sound());
  assert.equal(f.nodes.filter(node => !node.stops).length, 32);
  assert.deepEqual(f.nodes.slice(0, 3).map(node => node.disconnects), [1, 1, 1]);
  assert.deepEqual(f.gains.slice(0, 3).map(gain => gain.disconnects), [1, 1, 1]);
  f.engine.stop();
  assert.ok(f.nodes.every(node => node.stops === 1 && node.disconnects === 1));
});

test('stop(kind) releases every overlapping voice of that kind; stop() releases all and engine remains usable', async t => {
  const f = fixture(t, { deps: { allowOverlap: true } });
  for (const kind of ['xp', 'xp', 'other']) await f.engine.play(kind, sound());
  assert.equal(f.engine.stop('xp'), undefined);
  assert.deepEqual(f.nodes.map(node => node.stops), [1, 1, 0]);
  f.engine.stop('xp');
  assert.equal(f.nodes[0].stops, 1);
  await f.engine.play('xp', sound());
  f.engine.stop();
  assert.ok(f.nodes.every(node => node.stops === 1));
});

test('stop during shared fetch cancels all pending calls of one kind without cancelling another kind or future calls', async t => {
  const gate = deferred();
  const f = fixture(t, { fetch: () => gate.promise, deps: { allowOverlap: true } });
  const pending = [f.engine.play('xp', sound()), f.engine.preview('xp', sound()), f.engine.play('other', sound())];
  f.engine.stop('xp');
  gate.resolve(response());
  assert.deepEqual(await Promise.all(pending), [false, false, true]);
  assert.equal(f.nodes.length, 1);
  assert.equal(f.engine.lastFailure('xp'), null);
  assert.equal(await f.engine.play('xp', sound()), true);
  assert.equal(f.requests.length, 1);
});

test('stop() during fetch failure prevents HTML fallback from suddenly starting', async t => {
  const gate = deferred();
  const f = fixture(t, { fetch: () => gate.promise });
  const pending = f.engine.play('xp', sound());
  f.engine.stop();
  gate.reject(new Error('offline'));
  assert.equal(await pending, false);
  assert.equal(f.elements.length, 0);
  assert.equal(f.engine.lastFailure('xp'), null);
});

test('stop during decode prevents delayed BufferSource creation', async t => {
  const gate = deferred();
  const f = fixture(t, { decode: () => gate.promise });
  const pending = f.engine.preview('xp', sound());
  await flush();
  assert.equal(f.decodeCount, 1);
  f.engine.stop('xp');
  gate.resolve({ duration: 2 });
  assert.equal(await pending, false);
  assert.equal(f.nodes.length, 0);
});

for (const action of ['stop', 'dispose']) {
  test(action + ' during resume prevents delayed start even after context becomes running', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const resume = deferred();
    const f = fixture(t, { suspended: true, resume });
    const pending = f.engine.play('xp', sound());
    await flush();
    f.engine[action]();
    resume.resolve();
    await flush();
    t.mock.timers.tick(200);
    assert.equal(await pending, false);
    assert.equal(f.nodes.length, 0);
    assert.equal(f.elements.length, 0);
    assert.equal(f.engine.lastFailure('xp')?.code ?? null, action === 'dispose' ? AUDIO_FAILURES.DISPOSED : null);
  });
}

test('dispose aborts shared fetch, cannot re-create context or fall back, and pending prepare reports false', async t => {
  const gate = deferred();
  const f = fixture(t, { fetch: () => gate.promise });
  const play = f.engine.play('xp', sound());
  const preview = f.engine.preview('other', sound());
  const prepared = f.engine.prepare('xp', '/orb.wav', 'url');
  const rejectedPreview = assert.rejects(preview, { code: AUDIO_FAILURES.DISPOSED });
  assert.equal(f.requests.length, 1);
  f.engine.dispose();
  assert.equal(f.requests[0].init.signal.aborted, true);
  gate.resolve(response()); // Deliberately ignore abort, like a slow custom transport.
  assert.equal(await play, false);
  await rejectedPreview;
  assert.equal(await prepared, false);
  assert.equal(f.decodeCount, 0);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.contexts[0].closed, 1);
  assert.equal(f.nodes.length + f.elements.length, 0);
  assert.equal(f.engine.unlock(), false);
  assert.equal(await f.engine.play('xp', sound()), false);
  assert.equal(await f.engine.prepare('xp', '/orb.wav'), false);
});

test('dispose during decode does not revive cached buffers or deferred playback', async t => {
  const gate = deferred();
  const f = fixture(t, { decode: () => gate.promise });
  const pending = f.engine.play('xp', sound());
  await flush();
  f.engine.dispose();
  gate.resolve({ duration: 2 });
  assert.equal(await pending, false);
  assert.equal(f.nodes.length + f.elements.length, 0);
  assert.equal(f.contexts[0].closed, 1);
});

test('prepare/play/preview share one in-flight fetch and decode per resolved URL', async t => {
  const fetchGate = deferred(), decodeGate = deferred();
  const f = fixture(t, {
    fetch: () => fetchGate.promise, decode: () => decodeGate.promise,
    deps: { resolveSource: () => '/shared.wav', allowOverlap: true },
  });
  const pending = [f.engine.prepare('xp', 'local-name', 'local'), f.engine.play('xp', sound()), f.engine.preview('other', sound())];
  assert.equal(f.requests.length, 1);
  fetchGate.resolve(response());
  await flush();
  assert.equal(f.decodeCount, 1);
  const another = f.engine.prepare('other', 'anything');
  decodeGate.resolve({ duration: 3 });
  assert.deepEqual(await Promise.all([...pending, another]), [true, true, true, true]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.decodeCount, 1);
  assert.equal(f.nodes.length, 2);
});

for (const failure of ['fetch', 'decode']) {
  test('failed shared ' + failure + ' is not permanently cached and prepare can retry', async t => {
    const f = fixture(t, {
      fetch: (_url, _init, attempt) => failure === 'fetch' && attempt === 1
        ? Promise.reject(new Error('offline')) : response(),
      decode: (_bytes, attempt) => failure === 'decode' && attempt === 1
        ? Promise.reject(new Error('bad format')) : Promise.resolve({ duration: 2 }),
    });
    assert.deepEqual(await Promise.all([f.engine.prepare('xp', '/orb.wav'), f.engine.prepare('other', '/orb.wav')]), [false, false]);
    assert.equal(await f.engine.prepare('xp', '/orb.wav'), true);
    assert.equal(await f.engine.prepare('other', '/orb.wav'), true);
    assert.equal(f.requests.length, 2);
    assert.equal(f.decodeCount, failure === 'fetch' ? 1 : 2);
  });
}

test('HTML fallback sets actual rate and disables all available pitch preservation flags, including default rate', async t => {
  const f = fixture(t, { webAudio: false });
  await f.engine.play('xp', sound({ playbackRate: 0.65 }));
  await f.engine.preview('xp', sound());
  assert.deepEqual(f.elements.map(audio => audio.playbackRate), [0.65, 1]);
  for (const audio of f.elements) {
    assert.equal(audio.preservesPitch, false);
    assert.equal(audio.mozPreservesPitch, false);
    assert.equal(audio.webkitPreservesPitch, false);
  }
  assert.equal(f.elements[0].paused, true);
  assert.equal(f.elements[0].src, '');
  assert.equal(f.elements[1].paused, false);
});

test('decode failure fallback also receives pitch options', async t => {
  const f = fixture(t, { decode: () => Promise.reject(new Error('unsupported codec')) });
  assert.equal(await f.engine.play('xp', sound({ playbackRate: 0.8 })), true);
  assert.equal(f.elements[0].playbackRate, 0.8);
  assert.equal(f.elements[0].preservesPitch, false);
  assert.equal(f.engine.lastFailure('xp'), null);
});

test('overlapping HTML elements all update volume, release natural tails, stop, and enforce global cap', async t => {
  const f = fixture(t, { webAudio: false, deps: { allowOverlap: true } });
  await f.engine.play('xp', sound());
  await f.engine.play('xp', sound());
  assert.ok(f.elements.every(audio => !audio.paused));
  assert.equal(f.engine.setVolume('xp', 0.2), 0.2);
  assert.ok(f.elements.every(audio => audio.volume === 0.2));
  f.elements[0].end();
  assert.equal(f.elements[0].src, '');
  assert.equal(f.elements[1].paused, false);
  for (let i = 0; i < 33; i++) await f.engine.play('xp', sound());
  assert.equal(f.elements.filter(audio => !audio.paused).length, 32);
  f.engine.stop('xp');
  assert.ok(f.elements.every(audio => audio.paused && audio.src === '' && audio.onended === null));
});

for (const action of ['stop', 'dispose']) {
  test(action + ' during pending HTML play tears down again when late play resolves', async t => {
    const gate = deferred();
    const f = fixture(t, { webAudio: false, elementPlay: gate });
    const pending = f.engine.play('xp', sound());
    f.engine[action]();
    assert.equal(f.elements[0].paused, true);
    gate.resolve();
    assert.equal(await pending, false);
    assert.equal(f.elements[0].paused, true);
    assert.equal(f.elements[0].src, '');
  });
}

test('shouldStart predicate is checked after fetch; returning false cancels quietly and does not fall back', async t => {
  const gate = deferred();
  let allowed = true;
  const calls = [];
  const f = fixture(t, {
    fetch: () => gate.promise,
    deps: { shouldStart: (kind, opts) => { calls.push([kind, opts.playbackRate]); return allowed; } },
  });
  const pending = f.engine.preview('xp', sound({ playbackRate: 0.75 }));
  allowed = false;
  gate.resolve(response());
  assert.equal(await pending, false);
  assert.equal(f.nodes.length + f.elements.length, 0);
  assert.equal(f.engine.lastFailure('xp'), null);
  assert.ok(calls.length >= 2);
  assert.ok(calls.every(([kind, rate]) => kind === 'xp' && rate === 0.75));
});

test('aborted options.signal prevents initial or delayed starts without affecting shared prepare', async t => {
  const gate = deferred();
  const f = fixture(t, { fetch: () => gate.promise });
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal(await f.engine.play('xp', sound({ signal: cancelled.signal })), false);
  assert.equal(f.requests.length, 0);
  const controller = new AbortController();
  const pending = f.engine.play('xp', sound({ signal: controller.signal }));
  const prepare = f.engine.prepare('other', '/orb.wav');
  controller.abort();
  gate.resolve(response());
  assert.equal(await pending, false);
  assert.equal(await prepare, true);
  assert.equal(f.nodes.length, 0);
});

test('empty src, volume, unlock and visible/silent failure return contracts remain intact', async t => {
  const f = fixture(t, { webAudio: false, audio: false });
  assert.equal(await f.engine.play('completed', { src: ' ' }), false);
  assert.equal(await f.engine.preview('completed', {}), false);
  assert.equal(await f.engine.prepare('completed', ''), false);
  assert.equal(f.contexts.length + f.elements.length + f.requests.length, 0);
  assert.equal(f.engine.setVolume('completed', -1), 0);
  assert.equal(f.engine.setVolume('completed', 5), 1);
  assert.equal(f.engine.setVolume('completed', NaN), 0.8);
  assert.equal(f.engine.unlock(), false);
  assert.equal(await f.engine.play('completed', sound()), false);
  assert.equal(f.engine.lastFailure('completed').code, AUDIO_FAILURES.NO_BACKEND);
  await assert.rejects(f.engine.preview('completed', sound()), { code: AUDIO_FAILURES.NO_BACKEND });
  assert.equal(f.engine.lastFailure('completed').kind, 'completed');
  assert.equal(typeof f.engine.lastFailure('completed').at, 'number');
  await f.engine.play('completed', {});
  assert.equal(f.engine.lastFailure('completed'), null);
});

test('HTTP root failures stay inspectable, preview rejects, and stop does not erase the last failure', async t => {
  const f = fixture(t, { audio: false, fetch: () => ({ ok: false, status: 404 }) });
  assert.equal(await f.engine.play('xp', sound()), false);
  const failure = f.engine.lastFailure('xp');
  assert.equal(failure.code, AUDIO_FAILURES.ASSET_HTTP_ERROR);
  assert.equal(failure.status, 404);
  f.engine.stop('xp');
  assert.equal(f.engine.lastFailure('xp'), failure);
  await assert.rejects(f.engine.preview('xp', sound()), { code: AUDIO_FAILURES.ASSET_HTTP_ERROR });
});

test('HTML autoplay rejection remains visible to preview and silent to play', async t => {
  const blocked = Object.assign(new Error('gesture required'), { name: 'NotAllowedError' });
  const f = fixture(t, { webAudio: false, elementError: blocked });
  assert.equal(await f.engine.play('xp', sound()), false);
  assert.equal(f.engine.lastFailure('xp').code, AUDIO_FAILURES.AUTOPLAY_BLOCKED);
  await assert.rejects(f.engine.preview('xp', sound()), { code: AUDIO_FAILURES.AUTOPLAY_BLOCKED });
  assert.ok(f.elements.every(audio => audio.paused && audio.src === ''));
});
