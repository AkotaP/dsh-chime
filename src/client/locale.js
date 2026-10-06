/**
 * dsh-chime 的中英双语文案字典（纯 ESM，零依赖）。
 *
 * 用法（由 `index.js` 完成注册与绑定，见 CONTRACT §4.6）：
 * ```js
 * import { NS, zh, en } from './locale.js';
 * ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);
 * const t = ctx.locale.bind(NS);
 * ```
 *
 * 纪律：
 *  - 两个字典的 **key 集合必须完全一致**（含 `{name}` 占位符的 key 也一样）；
 *  - `zh` 同时充当 `settings.jsx` 在 `t` 缺失时的最后兜底，因此**不允许有空值**；
 *  - key 命名沿用扁平 `snake_case`，动态 key 形如 `kind_<kind>_label`。
 *
 * @module dsh-chime/locale
 */

/** Locale namespace shared by the dictionaries and the slot registration. */
export const NS = 'dshChime';

/** 中文文案（亦作为 `t` 缺失时的兜底字典）。 */
export const zh = {
  // —— 表头引导 ——
  formatHint:
    '粘贴 http(s) 网络链接，或本地音频文件的完整路径（如 E:\\Sounds\\ding.mp3）。插件不会复制你的文件。',

  // —— 顶层开关 ——
  enabled: '启用提示音',
  enabledHint: '总开关已关闭，所有事件都不会发声（试听仍可用）。',
  backgroundSessions: '背景会话也响',
  backgroundSessionsHint: '关闭时只有当前激活的会话会发声；开启后后台会话的事件也会响。',

  // —— 四类事件 ——
  kind_approval_label: '权限审批',
  kind_approval_hint: '等待你批准工具调用时。',
  kind_question_label: '回答问题',
  kind_question_hint: '提问或计划审批等待你回复时。',
  kind_interrupted_label: '中断',
  kind_interrupted_hint: '对话因错误无法继续时（自动重试不算）。',
  kind_completed_label: '完成',
  kind_completed_hint: '任务真正结束（无子代理、无后台任务）时。',

  // —— 每一行的控件 ——
  srcPlaceholder: '未设置（不响）',
  volume: '音量',
  preview: '试听',
  clear: '清除',

  // —— 「完成」卡片的最短任务时长门槛 ——
  completionMinLabel: '最短任务时长',
  completionMinUnit: '秒（0 = 总是响）',
  completionMinHint: '距上一次用户输入不足这个秒数时，完成音不响，避免小任务频繁提示。',

  // —— 行内错误 ——
  actionFailed: '操作失败',
  previewEmpty: '未设置音效，无法试听。',
  previewUnsupported: '当前环境不支持试听。',
  previewFailed: '试听失败：无法播放该音源。',
  previewFailedReason: '试听失败：{message}',

  // —— 页脚与摘要卡片 ——
  storageHint: '链接支持 http(s) 地址或本地绝对路径；改动即时生效并保存在本机浏览器。',
  summaryCount: '{total} 项中已配置 {configured} 项',
  summaryEnabled: '提示音已启用',
  summaryDisabled: '提示音已停用',
  summaryBackgroundOn: '背景会话也响',
  summaryBackgroundOff: '仅当前会话',
};

/** 英文文案（地道英文，非逐字直译）。 */
export const en = {
  // —— Header guidance ——
  formatHint:
    'Paste an http(s) link, or the full path to a local audio file (e.g. E:\\Sounds\\ding.mp3). The plugin never copies your file.',

  // —— Global switches ——
  enabled: 'Enable sounds',
  enabledHint: 'Sounds are turned off globally — no event will play (preview still works).',
  backgroundSessions: 'Also play in background sessions',
  backgroundSessionsHint:
    'When off, only the active session makes sound. When on, events in background sessions play too.',

  // —— The four events ——
  kind_approval_label: 'Approval',
  kind_approval_hint: 'While a tool call is waiting for your approval.',
  kind_question_label: 'Question',
  kind_question_hint: 'While a question or plan review is waiting for your answer.',
  kind_interrupted_label: 'Interrupted',
  kind_interrupted_hint:
    'When a conversation cannot continue because of an error (automatic retries do not count).',
  kind_completed_label: 'Completion',
  kind_completed_hint: 'When a task truly finishes (no subagents, no background jobs running).',

  // —— Per-row controls ——
  srcPlaceholder: 'Not set (silent)',
  volume: 'Volume',
  preview: 'Preview',
  clear: 'Clear',

  // —— Completion card: minimum task duration ——
  completionMinLabel: 'Minimum task duration',
  completionMinUnit: 'seconds (0 = always ring)',
  completionMinHint:
    'Skip the completion chime when less than this many seconds have passed since your last message, so small tasks stay quiet.',

  // —— Inline errors ——
  actionFailed: 'Operation failed',
  previewEmpty: 'No sound is set, so there is nothing to preview.',
  previewUnsupported: 'Preview is not available in this environment.',
  previewFailed: 'Preview failed: this audio source could not be played.',
  previewFailedReason: 'Preview failed: {message}',

  // —— Footer and summary card ——
  storageHint:
    'Links may be http(s) URLs or absolute local paths; changes take effect immediately and are stored in this browser.',
  summaryCount: '{configured} of {total} configured',
  summaryEnabled: 'Sounds on',
  summaryDisabled: 'Sounds off',
  summaryBackgroundOn: 'background sessions too',
  summaryBackgroundOff: 'current session only',
};
