/**
 * dsh-chime 在场感探针（纯 client half）。
 *
 * 规格来源：`CONTRACT.md` §3.7。它只回答一个问题：**人此刻在不在 DSH 面前**。
 * 提醒时机策略（音效 / 通知各选一档）就是把它和「事件来自哪个会话」组合出来的。
 *
 * 信号来源（对应 Codex 桌面端日志里的 `rendererWindowFocused` / `rendererWindowVisible`）：
 * - `focused()` ← `document.hasFocus()`：切到别的程序、最小化、被 DevTools 抢焦点都会变 false
 * - `visible()` ← `document.visibilityState !== 'hidden'`：只反映「最小化 / 隐藏」
 *
 * ⚠️ 两个实测注意点：
 * 1. **被其他窗口遮挡 ≠ 不可见**。DSH 的 Electron 主进程没有开 occlusion 计算，所以被遮挡时
 *    `visible()` 仍是 true —— 判定以 `focused()` 为主，`visible()` 只做兜底。
 * 2. **开着 DevTools 时 `focused()` 恒为 false**，调试通知策略时别被这个骗了。
 *
 * @module dsh-chime/presence
 */

/**
 * 建一个在场感探针。
 *
 * 所有读取都做容错：拿不到（非浏览器环境、`document` 不可用、实现抛错）时**一律当作「在场」**，
 * 也就是让提醒按保守方向照常发出 —— 宁可多提醒一次，也绝不因为读不到焦点而静默。
 *
 * @param {object} [deps] 依赖。
 * @param {Document} [deps.doc] 文档对象；默认取全局 `document`。
 * @returns {{ focused: () => boolean, visible: () => boolean }} 在场感。
 */
export function createPresence(deps) {
  const { doc = globalThis.document } = deps ?? {};

  /** @returns {boolean} 窗口此刻是否拥有焦点；读不到时按「有」处理。 */
  function focused() {
    try {
      if (doc && typeof doc.hasFocus === 'function') return doc.hasFocus();
    } catch {
      // 读焦点失败：按在场处理。
    }
    return true;
  }

  /** @returns {boolean} 窗口是否可见（非最小化）；读不到时按「可见」处理。 */
  function visible() {
    try {
      const state = doc?.visibilityState;
      if (typeof state === 'string') return state !== 'hidden';
    } catch {
      // 同上。
    }
    return true;
  }

  return { focused, visible };
}
