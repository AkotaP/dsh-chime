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
import { createNotifier } from './notify.js';
import { createPresence } from './presence.js';
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
 * CONTRACT §3.5). The roster is reached through the client `jobs` service —
 * `ctx.jobs.state` carries `rowsBySession`, which `ctx.jobs.watchRows()`
 * populates per Session. (`ctx.remote.job` is **not** reachable from a plugin:
 * Typert rejects `remote.<namespace>` without an explicit inject, and the
 * `jobs` service already wraps that namespace.)
 *
 * The service is looked up optionally and every access is guarded: when it is
 * unavailable the count simply stays 0, which degrades to "the completion
 * chime may ring a little early" instead of breaking playback.
 *
 * @param {object} ctx - Client root context.
 * @returns {{count: (sessionId: string) => number, dispose: () => void}} counter.
 */
function createJobCounter(ctx) {
  /** @type {Map<string, unknown>} one roster subscription per Session. */
  const watches = new Map();
  let disposed = false;

  /** @returns {object|undefined} the optional `jobs` client service. */
  function jobsService() {
    try {
      if (ctx.jobs && typeof ctx.jobs === 'object') return ctx.jobs;
    } catch {
      // fall through to the lookup form
    }
    try {
      const service = ctx.get('jobs');
      return service && typeof service === 'object' ? service : undefined;
    } catch {
      return undefined;
    }
  }

  /** Subscribe once so the shared model starts tracking this Session's roster. */
  function watch(sessionId) {
    if (disposed || sessionId === undefined || watches.has(sessionId)) return;
    const jobs = jobsService();
    if (typeof jobs?.watchRows !== 'function') return;
    try {
      watches.set(sessionId, jobs.watchRows(sessionId));
    } catch {
      // An unavailable roster must never break sound playback.
    }
  }

  /** Read the current count out of the shared model snapshot. */
  function activeCount(sessionId) {
    const jobs = jobsService();
    const rows = jobs?.state?.getSnapshot?.()?.rowsBySession?.get?.(String(sessionId));
    if (!Array.isArray(rows)) return 0;
    return rows.filter((row) => row?.status === 'running' || row?.status === 'stopping').length;
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
          if (typeof release === 'function') release();
          else if (typeof release?.release === 'function') release.release();
        } catch {
          // best effort
        }
      }
      watches.clear();
    },
  };
}

/**
 * 生成通知文案用的翻译函数。
 *
 * 与 `settings.jsx` 的 `translate` 同一策略：优先 `locale.bind(NS)`；`t` 缺失 /
 * 抛错 / 返回空串 / 原样返回 key 时回落到 `locale.js` 的 `zh` 字典，最后才原样
 * 显示 key —— 任何路径都不会渲染出空白。
 *
 * @param {object|undefined} locale `ctx.locale`（可能不可用）。
 * @returns {(key: string) => string} 取文案。
 */
function createTranslator(locale) {
  /** @type {((key: string) => string)|null} */
  let bound = null;
  try {
    if (typeof locale?.bind === 'function') bound = locale.bind(LOCALE_NS);
  } catch {
    bound = null;
  }
  return (key) => {
    try {
      if (typeof bound === 'function') {
        const value = bound(key);
        if (typeof value === 'string' && value.length > 0 && value !== key) return value;
      }
    } catch {
      // 绑定失效：回落字典。
    }
    const fallback = localeZh[key];
    return typeof fallback === 'string' && fallback.length > 0 ? fallback : key;
  };
}

/**
 * 取某个会话的标题，用作通知正文；拿不到时返回空串，由调用方改用通用文案。
 *
 * @param {object} ctx Client 根 Context。
 * @param {unknown} sessionId 会话 id。
 * @returns {string} 标题（可能为空串）。
 */
function sessionTitleOf(ctx, sessionId) {
  try {
    const row = ctx.get('sessions')?.list?.getSnapshot?.()?.byId?.[sessionId];
    const title = row?.title ?? row?.name;
    return typeof title === 'string' ? title.trim() : '';
  } catch {
    return '';
  }
}

/**
 * 把 DSH 主区域切到事件所属会话（CONTRACT §4.7）。
 *
 * `ctx.uiWorkspace.openSession(id)` 是 ui-workspace 文档化的客户端 API：它同步替换
 * mainView 引用，并把主区域收回 Conversation（内部 `layout.selectPanel(null)`），
 * 所以即使人正停在插件页或设置页，点通知也能直接落到那条对话上。
 *
 * 只对**已知会话**执行：设置页的「测试通知」用合成 id（`__dsh-chime-test__`），
 * 会话列表里查不到，点它不该把界面切到空处。服务缺失、目标已归档/已删除、
 * 或该 API 在宿主升级后改名，一律静默降级 —— 通知已经弹出来了，跳转失败不能
 * 反过来报错，更不能影响通知的关闭。
 *
 * @param {object} ctx Client 根 Context。
 * @param {unknown} sessionId 事件所属会话 id。
 */
function revealSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return;
  let list;
  try {
    list = ctx.get('sessions')?.list?.getSnapshot?.();
  } catch {
    list = undefined;
  }
  // 列表没就绪（启动初期、断线重连、旧宿主）就不猜：通知可能来自上一个进程，
  // 目标会话未必还存活，宁可不动界面，也不要把空 id 交给 openSession。
  if (!list || list.phase !== 'ready') return;
  if (list.byId?.[sessionId] === undefined) return;
  // 归档会话不跳：用户已经把它收起来了，点一条旧通知不该把它翻出来。读不到就不拦。
  try {
    const archived = ctx.get('workspaces')?.list?.getSnapshot?.()?.archivedSessionIds;
    if (Array.isArray(archived) && archived.includes(sessionId)) return;
  } catch {
    // 归档列表不可读：按未归档处理。
  }
  try {
    const workspace = ctx.get('uiWorkspace');
    if (typeof workspace?.openSession !== 'function') return;
    // 已经停在目标会话：只保留上面的聚焦，避免重开一次（会闪一下加载态）。
    // `mainReference` 是 ui-workspace 的内部字段，读不到就照常走 openSession。
    if (workspace.mainReference?.sessionId === sessionId) return;
    workspace.openSession(sessionId);
  } catch (error) {
    // 跳转是锦上添花：没有该能力时安静放弃。
    try {
      globalThis.console?.warn?.('[dsh-chime] session reveal skipped', error);
    } catch {
      // 控制台不可用时忽略。
    }
  }
}

/**
 * 实验性：让 Desktop 外壳把主窗口带到前台（CONTRACT §4.7）。
 *
 * 页面 focus 不能保证原生窗口激活，所以额外请求 host 半恢复并验证前台窗口；
 * 隐藏窗口交给 Desktop 外壳显示，避免 Win32 与 Electron 的可见状态不一致。
 *
 * 三重护栏：配置开关默认关闭；只在桌面版主页面（`dsh-app://app` 且存在
 * `dshDesktop` 注入）里尝试；请求是 fire-and-forget，失败绝不影响通知关闭。
 *
 * @param {object} config 当前配置快照（读 `notify.raiseWindow`）。
 */
function raiseDesktopWindow(config) {
  if (config?.notify?.raiseWindow !== true) return;
  const location = globalThis.location;
  if (location?.protocol !== 'dsh-app:' || location?.hostname !== 'app') return;
  if (globalThis.dshDesktop === undefined) return;
  try {
    // 自定义头同时充当防跨站凭据：跨站请求带它会触发 CORS 预检，预检不通过就不会真正发出。
    void globalThis
      .fetch?.('/dsh-chime/raise', {
        method: 'POST',
        headers: { 'x-dsh-chime': 'raise' },
        keepalive: true,
      })
      ?.then?.(async (response) => {
        const result = await response.json();
        if (!response.ok || result.requested === false || result.activated === false) {
          globalThis.console?.warn?.('[dsh-chime] window activation was not confirmed', result);
        }
      })
      ?.catch?.((error) => {
        globalThis.console?.warn?.('[dsh-chime] window activation request failed', error);
      });
  } catch {
    // 实验性增强：安静失败。
  }
}

/**
 * 把 `{name}` 占位替换为参数。
 *
 * 与 `settings.jsx` 的 `format()` 同一策略：`locale` 的 `t` 只按 key 取值、不带参数，
 * 占位统一在这里填；缺参数时保留原样，不会渲染出 `undefined`。
 *
 * @param {string} template 文案模板。
 * @param {Record<string, unknown>} params 占位参数。
 * @returns {string} 填充后的文案。
 */
function fillTemplate(template, params) {
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
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

  /** 通知文案用的翻译函数（bind → zh 字典 → key 本身）。 */
  const text = createTranslator(locale);

  // 在场感（CONTRACT §3.7）：音效与通知共用同一份「窗口在不在焦点」信号，
  // 避免 Codex 桌面端那种「通知关了、声音还在响」的错位。
  const presence = createPresence();

  // 系统通知：与音效**独立**的第二条通道（CONTRACT §4.7）。它只认 config.notify，
  // 所以音效总开关关着、音源留空，通知照样弹。
  const notifier = createNotifier({
    getConfig: () => configStore.getSnapshot(),
    buildMessage: (event) => {
      const title = text(`notify_kind_${event.kind}_title`);
      // 有会话标题时，正文明确写成「来自会话 ——「xxx」」：多会话并行时一眼看出是哪条对话，
      // 也避免一串裸文本看着像乱入。拿不到标题才退回该类事件的通用说明。
      const sessionTitle = sessionTitleOf(ctx, event.sessionId);
      const body = sessionTitle
        ? fillTemplate(text('notifyBodyFromSession'), { session: sessionTitle })
        : text(`notify_kind_${event.kind}_body`);
      return { title, body };
    },
    onClick: (event) => {
      // 点了通知就把 DSH 窗口拉到前台（浏览器可能忽略，静默失败即可），
      // 再把主区域切到事件所属的对话（CONTRACT §4.7）。
      try {
        globalThis.focus?.();
      } catch {
        // best effort
      }
      revealSession(ctx, event?.sessionId);
      raiseDesktopWindow(configStore.getSnapshot());
    },
  });

  const detector = createDetector({
    getConfig: () => configStore.getSnapshot(),
    isFocused: () => presence.focused(),
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
    onChime: (event) => {
      const { kind } = event;
      const config = configStore.getSnapshot();
      // 通知：detect 已按 notify 通道自己的策略（总开关 + 逐类开关 + 提醒时机）算好
      // `event.notify`，这里不再重复判定，也不受音效开关与音源配置影响。
      if (event.notify === true) notifier.notify(event);
      // 音效：`event.sound` 同理是 detect 的结论；`config.enabled` 只作兜底。
      if (event.sound === false || !config.enabled) return;
      const entry = config.kinds?.[kind];
      // Unset sound means silence — never fall back to a built-in tone.
      if (entry === undefined || entry.src === '') return;
      void audio.play(kind, entry);
    },
  });

  ctx.effect(() => {
    const stop = detector.start();

    // Event-driven nudge (CONTRACT §4.4 `poke`). DSH pushes status and list
    // changes over its remote channel; those callbacks are not timers, so they
    // keep firing in a background tab where the poll above is throttled down to
    // seconds — or stops entirely once the browser freezes the tab.
    /** @type {Array<() => void>} */
    const releases = [];
    /** @param {() => any} resolve 取得可订阅数据源。 */
    const follow = (resolve) => {
      try {
        const release = resolve()?.subscribe?.(() => detector.poke());
        if (typeof release === 'function') releases.push(release);
      } catch {
        // A missing or unserializable source must never break activation.
      }
    };
    follow(() => ctx.get('uiSession')?.sessionStatus);
    follow(() => ctx.get('sessions')?.list);

    // Returning to the foreground settles whatever happened while hidden,
    // without waiting for the next poll tick.
    const onVisibilityChange = () => {
      detector.poke();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      for (const release of releases) {
        try {
          release();
        } catch {
          // best effort
        }
      }
      if (typeof stop === 'function') stop();
      detector.dispose();
      notifier.dispose();
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
      notifier,
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
