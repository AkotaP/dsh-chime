/**
 * dsh-chime 系统通知模块（纯 client half）。
 *
 * 规格来源：`CONTRACT.md` §4.7。通知与音效是**两条独立通道**：
 * 音效总开关关着、音源留空，都不影响通知；通知只认自己那份配置
 * （`config.notify.enabled` + `config.notify.kinds[kind]`）。
 *
 * 设计要点：
 * - **构造器可注入**（`deps.NotificationCtor`），模块本身不直接碰全局对象，
 *   因此不启动浏览器也能单测全部判定分支。
 * - 环境不支持时 `supported() === false`，`notify()` 恒返回 false，绝不抛错。
 * - 每条通知固定 `silent: true`：声音归音效通道管，避免系统提示音与自定义音效
 *   叠成「双响」。想让它响，去把那一类的音效配上。
 * - `tag` 形如 `dsh-chime:<kind>:<sessionId>`：同一会话的同类事件互相替换，
 *   通知中心里不会堆成一串。
 * - 权限三态（`default` / `granted` / `denied`）由浏览器/Electron 决定；
 *   `requestPermission()` 必须在用户手势里调用（设置页的「启用系统通知」按钮）。
 *
 * @module dsh-chime/notify
 */
import { CHIME_KINDS } from './config.js';

/** 同时保留的最多通知条数；超出后丢弃最早的一条，避免长跑进程里 Set 无界增长。 */
const MAX_OPEN_NOTIFICATIONS = 16;

/** 默认错误上报（只写控制台，绝不打断通知）。 */
function defaultOnError(error, where) {
  try {
    globalThis.console?.warn?.(`[dsh-chime] ${where}`, error);
  } catch {
    // 控制台不可用时忽略。
  }
}

/**
 * 建一个通知器（CONTRACT §4.7）。
 *
 * @param {object} [deps] 依赖。
 * @param {() => any} [deps.getConfig] 取配置快照（读 `notify.enabled` / `notify.kinds`）。
 * @param {typeof Notification} [deps.NotificationCtor] 通知构造器；默认取全局 `Notification`。
 * @param {(event: object) => { title: string, body?: string }} [deps.buildMessage] 生成本地化文案。
 * @param {() => void} [deps.onClick] 点击通知时的回调（`index.js` 用来把窗口拉到前台）。
 * @param {(error: unknown, where: string) => void} [deps.onError] 错误上报（默认写控制台）。
 * @returns {{
 *   supported: () => boolean,
 *   permission: () => 'unsupported' | 'default' | 'granted' | 'denied',
 *   requestPermission: () => Promise<'unsupported' | 'default' | 'granted' | 'denied'>,
 *   explain: (event: { kind: string, sessionId?: string }) => { ok: boolean, reason: string },
 *   notify: (event: { kind: string, sessionId?: string }) => boolean,
 *   dispose: () => void,
 * }} 通知器。
 */
export function createNotifier(deps) {
  const {
    getConfig = () => ({}),
    NotificationCtor = globalThis.Notification,
    buildMessage = null,
    onClick = null,
    onError = defaultOnError,
  } = deps ?? {};

  /** @type {Set<any>} 仍然活着、等待关闭的通知。 */
  const open = new Set();
  let disposed = false;

  /** @param {unknown} error 错误。 @param {string} where 位置。 */
  function report(error, where) {
    try {
      onError(error, where);
    } catch {
      // 上报本身出错也要吞掉。
    }
  }

  /** @returns {typeof Notification | null} 可用的通知构造器；不可用时为 null。 */
  function resolveCtor() {
    return typeof NotificationCtor === 'function' ? NotificationCtor : null;
  }

  /** @returns {boolean} 当前环境是否支持系统通知。 */
  function supported() {
    return resolveCtor() !== null;
  }

  /** @returns {'unsupported' | 'default' | 'granted' | 'denied'} 权限三态。 */
  function permission() {
    const Ctor = resolveCtor();
    if (Ctor === null) return 'unsupported';
    const value = Ctor.permission;
    return value === 'granted' || value === 'denied' ? value : 'default';
  }

  /**
   * 请求通知权限。**必须在用户手势（点击）里调用**，否则浏览器会直接拒绝。
   *
   * @returns {Promise<'unsupported' | 'default' | 'granted' | 'denied'>} 请求后的权限。
   */
  async function requestPermission() {
    const Ctor = resolveCtor();
    if (Ctor === null) return 'unsupported';
    if (typeof Ctor.requestPermission !== 'function') return permission();
    try {
      const result = await Ctor.requestPermission();
      if (result === 'granted' || result === 'denied') return result;
      return permission();
    } catch (error) {
      report(error, 'requestPermission');
      return permission();
    }
  }

  /**
   * 取本地化文案；`buildMessage` 缺失或抛错时回落到通用文案。
   *
   * @param {{ kind: string, sessionId?: string }} event 事件。
   * @returns {{ title: string, body: string }} 文案。
   */
  function messageFor(event) {
    if (typeof buildMessage === 'function') {
      try {
        const built = buildMessage(event);
        if (built && typeof built.title === 'string' && built.title.length > 0) {
          return { title: built.title, body: typeof built.body === 'string' ? built.body : '' };
        }
      } catch (error) {
        report(error, 'buildMessage');
      }
    }
    return { title: 'DeepSeek Harness', body: String(event.kind) };
  }

  /**
   * 通知 `tag` 的最大长度。
   *
   * **这是踩过坑的**：Windows toast 的 `Tag` 属性上限是 **64 字符**，超长之后
   * Chromium 会**静默丢弃整条通知** —— 不弹横幅、不进通知中心、连 `error` 事件
   * 都没有，构造函数却照样成功。DSH 的会话 id 形如 `session-<uuid>`（44 字符），
   * 拼上前缀就正好压线，于是表现为「真实事件永远不响，手动测试一测就响」。
   * 这里留足余量。
   */
  const MAX_TAG_LENGTH = 48;

  /**
   * 拼一条通知 tag：`dsh-chime:<kind>:<会话 id>`，并保证不超过 {@link MAX_TAG_LENGTH}。
   *
   * 同一会话的同类事件共享 tag（通知中心里互相替换，不堆成一串）；id 太长时截掉
   * 头部 —— UUID 尾部随机性足够，不会把两个会话混成一条。
   *
   * @param {string} kind 事件种类。
   * @param {unknown} sessionId 会话 id。
   * @returns {string} 合法且长度受控的 tag。
   */
  function tagFor(kind, sessionId) {
    const prefix = `dsh-chime:${kind}:`;
    const id = typeof sessionId === 'string' ? sessionId : '';
    if (prefix.length + id.length <= MAX_TAG_LENGTH) return `${prefix}${id}`;
    const keep = Math.max(0, MAX_TAG_LENGTH - prefix.length);
    return `${prefix}${id.slice(id.length - keep)}`;
  }

  /**
   * 记住一条已弹出的通知，并在它关闭/点击时清理引用。
   *
   * @param {any} notification 通知实例。
   */
  function track(notification) {
    open.add(notification);
    const forget = () => {
      open.delete(notification);
    };
    const closeQuietly = () => {
      try {
        notification.close?.();
      } catch {
        // 通知已被系统关闭：忽略。
      }
    };
    try {
      notification.onclose = forget;
      notification.onerror = forget;
      notification.onclick = () => {
        forget();
        if (typeof onClick === 'function') {
          try {
            onClick();
          } catch (error) {
            report(error, 'onclick');
          }
        }
        closeQuietly();
      };
    } catch (error) {
      // 某些实现把 on* 设成只读：绑定失败不影响是否弹出的结论。
      report(error, 'track');
    }
    while (open.size > MAX_OPEN_NOTIFICATIONS) {
      const oldest = open.values().next().value;
      open.delete(oldest);
    }
  }

  /**
   * 预检：**不真的弹**，只报告当前会不会弹、以及会卡在哪一步。
   *
   * 设置页的「测试通知」按钮用它把「为什么没响」直接摆在界面上，省得去翻 DevTools。
   * `notify()` 走的是同一条判定链，所以两者的结论永远一致。
   *
   * 原因码：`ready` / `disabled` / `kind-off` / `unsupported` /
   * `permission-default` / `permission-denied` / `config-error` / `unknown-kind` / `disposed`。
   *
   * @param {{ kind: string, sessionId?: string }} event 事件（`detect.js` 的 ChimeEvent）。
   * @returns {{ ok: boolean, reason: string }} 结论与原因码。
   */
  function explain(event) {
    if (disposed) return { ok: false, reason: 'disposed' };
    const kind = event?.kind;
    if (typeof kind !== 'string' || !CHIME_KINDS.includes(kind)) {
      return { ok: false, reason: 'unknown-kind' };
    }

    let config;
    try {
      config = getConfig() ?? {};
    } catch (error) {
      report(error, 'getConfig');
      return { ok: false, reason: 'config-error' };
    }
    const notifyConfig = config.notify;
    if (!notifyConfig || notifyConfig.enabled !== true) return { ok: false, reason: 'disabled' };
    if (notifyConfig.kinds?.[kind] !== true) return { ok: false, reason: 'kind-off' };

    if (resolveCtor() === null) return { ok: false, reason: 'unsupported' };
    const state = permission();
    if (state !== 'granted') return { ok: false, reason: `permission-${state}` };

    return { ok: true, reason: 'ready' };
  }

  /**
   * 弹一条系统通知。
   *
   * 判定顺序（任何一步不满足都返回 `false`，且**绝不抛错**）：
   * 通知总开关 → 该类的逐类开关 → 环境支持 → 权限已授予 → 构造函数成功。
   *
   * @param {{ kind: string, sessionId?: string }} event 事件（`detect.js` 的 ChimeEvent）。
   * @returns {boolean} 是否真的弹出了通知。
   */
  function notify(event) {
    if (disposed) return false;
    const check = explain(event);
    if (!check.ok) {
      // 留痕：真实事件被拦下时，Console 里能直接看到卡在哪一步，不必再靠
      // 「点了没反应」猜。（设置页的「测试通知」走 explain()，不会走到这里。）
      report(new Error(`notification skipped (${check.reason})`), 'notify');
      return false;
    }

    const Ctor = resolveCtor();
    if (Ctor === null) return false;
    const { kind } = event;
    const message = messageFor(event);
    let notification;
    try {
      notification = new Ctor(message.title, {
        body: message.body,
        // 长度受控：超过 Windows toast 的 64 字符上限会被整条静默丢弃（见 tagFor）。
        tag: tagFor(kind, event.sessionId),
        silent: true,
      });
    } catch (error) {
      report(error, 'show');
      return false;
    }

    track(notification);
    return true;
  }

  /** 关闭全部仍然活着的通知并释放资源（幂等）。 */
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const notification of open) {
      try {
        notification.close?.();
      } catch {
        // best effort
      }
    }
    open.clear();
  }

  return { supported, permission, requestPermission, explain, notify, dispose };
}
