/**
 * Observe only newly appended tool/result events in the currently viewed Session.
 * replace/prepend are history (including reconnect baselines), never XP triggers.
 * Uses borrowed bindings: does not retain sessions, read logs, or wrap tools.
 */
export function createToolResultWatcher({ sessions, uiSession, onToolResult, onStop = () => {}, canTrigger = () => true }) {
  let disposed = false;
  let currentId;
  let source;
  let releaseSource;
  let lastSnapshot;
  let highWater = -1;
  const releases = [];

  function safely(fn) {
    try { return fn(); } catch { return undefined; }
  }

  function stop() { safely(onStop); }

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
    if (change?.kind !== 'append') {
      // Baseline replacement is also a sound boundary; no reconnect catch-up.
      if (change?.kind === 'replace') stop();
      mark(change?.kind === 'prepend' ? change.entries : snapshot.entries);
      return;
    }
    for (const entry of change.entries ?? []) {
      const event = entry?.event;
      if (!Number.isFinite(event?.seq) || event.seq <= highWater) continue;
      highWater = event.seq;
      if (event.type !== 'tool/result' || !safely(permitsResult)) continue;
      // Any tool, successful or failed; no tool-name allowlist or special case.
      safely(() => onToolResult({ sessionId: currentId, event }));
    }
  }

  function reconcile() {
    if (disposed) return;
    const id = safely(selectedId);
    const next = id == null ? undefined : safely(() => sessions?.binding?.(id)?.eventSource);
    if (id !== currentId || next !== source) {
      safely(() => releaseSource?.());
      releaseSource = undefined;
      source = next;
      currentId = id;
      highWater = -1;
      lastSnapshot = undefined;
      stop();
      if (source) {
        // Snapshot before subscribe: subscribe itself may synchronously notify.
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
    if (typeof release === 'function') releases.push(release);
  }

  reconcile();
  follow(uiSession?.adapter?.current);
  follow(sessions?.list);
  follow(uiSession?.sessionStatus);
  // Close the read/subscribe gap without replaying the already observed baseline.
  reconcile();

  return {
    currentSessionId: () => currentId,
    dispose() {
      if (disposed) return;
      disposed = true;
      safely(() => releaseSource?.());
      for (const release of releases.reverse()) safely(release);
      source = undefined;
      stop();
    },
  };
}
