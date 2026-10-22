import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolResultWatcher } from '../src/xp/tools.js';

function store(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(next) { value = next; for (const fn of [...listeners]) fn(); }, size: () => listeners.size };
}
const entry = (seq, type = 'tool/result', data = {}) => ({ type: 'durable', event: { seq, type, data } });
function feed(initial = []) {
  let entries = initial;
  let revision = 1;
  const s = store({ entries, revision, change: { kind: 'replace', entries } });
  return Object.assign(s, {
    append(e) { entries = [...entries, e]; s.set({ entries, revision: ++revision, change: { kind: 'append', entries: [e] } }); },
    replace(next) { entries = next; s.set({ entries, revision: ++revision, change: { kind: 'replace', entries } }); },
    prepend(older) { entries = [...older, ...entries]; s.set({ entries, revision: ++revision, change: { kind: 'prepend', entries: older } }); },
  });
}
function harness(initial = [entry(1)]) {
  const a = feed(initial), b = feed([entry(99)]);
  const current = store({ key: 'a' });
  const statuses = store(new Map([['a', { running: true }], ['b', { running: true }]]));
  const list = store({ ids: ['a', 'b'], byId: { a: { retainedBy: { mainView: 1 } } } });
  const bindings = { a: { eventSource: a }, b: { eventSource: b } };
  const results = []; let stops = 0; let allowed = true;
  const watcher = createToolResultWatcher({ sessions: { list, binding: (id) => bindings[id] },
    uiSession: { adapter: { current }, sessionStatus: statuses },
    onToolResult: (event) => results.push(event), onStop: () => stops++, canTrigger: () => allowed });
  return { a, b, current, statuses, list, bindings, results, watcher, stops: () => stops, allow: (v) => { allowed = v; } };
}

test('initial history, replacement, prepended pages, transient rows never produce XP', () => {
  const h = harness();
  h.a.prepend([entry(0)]);
  h.a.replace([entry(1), entry(2)]);
  h.a.append(entry(2.5, 'assistant/live-chunk'));
  assert.equal(h.results.length, 0);
  h.a.append(entry(3));
  assert.equal(h.results.length, 1);
  h.watcher.dispose();
});

test('all live tool results trigger, including errors; calls and duplicate sequences do not', () => {
  const h = harness();
  h.a.append(entry(2, 'tool/call', { name: 'any_tool' }));
  h.a.append(entry(3, 'tool/result', { message: { isError: true } }));
  h.a.append(entry(3));
  h.a.append(entry(4));
  assert.deepEqual(h.results.map((x) => x.event.seq), [3, 4]);
  h.watcher.dispose();
});

test('only current session, switch releases old feed and seeds new history', () => {
  const h = harness();
  h.b.append(entry(100));
  h.a.append(entry(2));
  h.current.set({ key: 'b' });
  assert.equal(h.a.size(), 0);
  h.a.append(entry(3));
  h.b.append(entry(101));
  assert.deepEqual(h.results.map((x) => [x.sessionId, x.event.seq]), [['a', 2], ['b', 101]]);
  h.watcher.dispose();
});

test('pending interaction, stopped agent and focus/config gates drop events without replay', () => {
  const h = harness();
  h.statuses.set(new Map([['a', { running: true, pendingInteraction: { kind: 'approval' } }]]));
  const stops = h.stops();
  h.a.append(entry(2));
  h.statuses.set(new Map([['a', { running: false }]]));
  assert.ok(h.stops() > stops);
  h.a.append(entry(3));
  h.statuses.set(new Map([['a', { running: true }]]));
  h.allow(false); h.a.append(entry(4));
  h.allow(true); h.a.append(entry(5));
  assert.deepEqual(h.results.map((x) => x.event.seq), [5]);
  h.watcher.dispose();
});

test('empty initial source later receives replace baseline without replay; live append follows', () => {
  const h = harness([]);
  h.a.replace([entry(10), entry(11)]);
  h.a.append(entry(12));
  assert.deepEqual(h.results.map((x) => x.event.seq), [12]);
  h.watcher.dispose();
});

test('same-id binding replacement and dispose release all subscriptions', () => {
  const h = harness();
  const next = feed([entry(50)]);
  h.bindings.a = { eventSource: next };
  h.list.set({ ids: ['a'], byId: {} });
  assert.equal(h.a.size(), 0);
  next.append(entry(51));
  assert.equal(h.results.length, 1);
  h.watcher.dispose(); h.watcher.dispose();
  next.append(entry(52));
  assert.equal(h.results.length, 1);
  for (const s of [next, h.current, h.statuses, h.list]) assert.equal(s.size(), 0);
});

test('fallback to mainView binding works without adapter.current; exceptions cannot break feeds', () => {
  const a = feed([]); const list = store({ ids: ['a'], byId: { a: { retainedBy: { mainView: 1 } } } });
  const watcher = createToolResultWatcher({ sessions: { list, binding: () => ({ eventSource: a }) },
    onToolResult() { throw new Error('consumer failure'); } });
  assert.equal(watcher.currentSessionId(), 'a');
  assert.doesNotThrow(() => a.append(entry(1)));
  watcher.dispose();
});
