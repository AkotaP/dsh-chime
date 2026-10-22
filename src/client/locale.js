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
    '粘贴 http(s) 网络链接，或本地音频文件的完整路径（Linux/macOS 如 /home/you/ding.mp3，Windows 如 E:\\Sounds\\ding.mp3）。插件不会复制你的文件。',

  // —— 顶层开关 ——
  enabled: '启用提示音',
  enabledHint: '总开关已关闭，所有事件都不会发声（试听仍可用）。',
  // —— 提醒时机（会话维度 × 窗口焦点维度，CONTRACT §3.7）——
  attentionSoundLabel: '音效提醒时机',
  attentionNotifyLabel: '通知提醒时机',
  policy_current_only: '只看当前会话',
  policy_current_only_hint: '当前打开的会话有事就提醒，其他会话不打扰。',
  policy_away: '只在我不在 DSH 时',
  policy_away_hint: '你正看着 DSH 时不提醒，切走之后才提醒 —— 对齐 Codex 桌面端的默认策略。',
  policy_away_or_other: '我不在，或事情在别的会话',
  policy_away_or_other_hint: '推荐：你正盯着那条会话时不打扰，其余情况一律提醒，不会漏掉后台会话。',
  policy_always: '总是提醒',
  policy_always_hint: '任何会话、任何时候都提醒。',
  policy_never: '从不提醒',
  policy_never_hint: '这条通道彻底静音。',
  policy_short_current_only: '仅当前会话',
  policy_short_away: '仅离开时',
  policy_short_away_or_other: '离开或有新情况',
  policy_short_always: '全部提醒',
  policy_short_never: '静音',

  // —— 通用配置（两条通道共用的安静规则）——
  configSectionTitle: '通用配置',
  maxDepthLabel: '最深响应的对话层级',
  maxDepthUnit: '层（0 = 只有主对话）',
  maxDepthHint: '0 = 只有主对话；1 = 主对话和它的直接子代理；依此类推。层级更深的事件不提醒（音效和通知都跳过）。',

  // —— 系统通知（独立于音效的第二条通道）——
  notifyTitle: '系统通知',
  notifyHint: '事件发生时弹一条系统通知。它与音效是两条独立通道，提醒时机单独设置。',
  notifyEnable: '启用系统通知',
  notifyPerKind: '发送系统通知',
  notifyPerKindOff: '通知总开关未开，这里勾了也暂时不生效。',
  notifyRequest: '授权',
  notifyRequesting: '请求中…',
  notifyPermissionDefault: '尚未授权，点「授权」后系统才会弹出通知。',
  notifyPermissionGranted: '已授权。',
  notifyPermissionDenied: '已被系统拒绝，需要到系统设置里重新允许。',
  notifyPermissionUnsupported: '当前环境不支持系统通知。',
  notifyTest: '测试通知',
  notifyTestReady: '已发出。如果系统没弹出来，那就是系统通知设置（专注助手 / 通知权限）把它拦住了。',
  notifyTestDisabled: '没弹：通知总开关关着。',
  notifyTestKindOff: '没弹：这一类事件的通知开关没勾。',
  notifyTestUnsupported: '没弹：当前环境不支持系统通知。',
  notifyTestPermission: '没弹：权限状态是 {state}。',
  notifyTestConfigError: '没弹：读不到配置（内部错误）。',
  notifyTestUnknownKind: '没弹：未知的事件类型（内部错误）。',
  notifyTestDisposed: '没弹：插件已停用。',
  // —— 实验性：点击通知把桌面窗口带到前台（CONTRACT §4.7）——
  notifyRaiseWindow: '点击通知时把窗口带到前台',
  notifyRaiseWindowHint:
    '实验性功能，默认关闭。Windows 会恢复最小化窗口，并通过桌面外壳显示关闭到托盘的窗口，再校验实际前台状态。普通后台仍无法激活时，会短暂最小化后恢复一次，可能闪动；系统仍可能拒绝激活。macOS / Linux 走 dsh://open。并发点击共享一个短命辅助进程。仅 Desktop 安装有效，Web 版会忽略。',
  experimentalTag: '实验性',
  notify_kind_approval_title: 'DSH · 等待授权',
  notify_kind_approval_body: '有工具调用在等你的批准。',
  notify_kind_question_title: 'DSH · 待回答',
  notify_kind_question_body: '有个问题在等你回复。',
  notify_kind_interrupted_title: 'DSH · 已中断',
  notify_kind_interrupted_body: '对话因错误无法继续。',
  notify_kind_completed_title: 'DSH · 已完成',
  notify_kind_completed_body: '任务结束了。',
  notifyBodyFromSession: '来自会话 ——「{session}」',

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
  completionMinHint: '距上一次用户输入不足这个秒数时，「完成」不提醒（音效和通知都跳过），避免小任务频繁打扰。',

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

  summaryNotifyOn: '系统通知已开',
};

/** 英文文案（地道英文，非逐字直译）。 */
export const en = {
  // —— Header guidance ——
  formatHint:
    'Paste an http(s) link, or the full path to a local audio file (e.g. /home/you/ding.mp3 on Linux/macOS, E:\\Sounds\\ding.mp3 on Windows). The plugin never copies your file.',

  // —— Global switches ——
  enabled: 'Enable sounds',
  enabledHint: 'Sounds are turned off globally — no event will play (preview still works).',
  // —— Attention timing (session × window focus, CONTRACT §3.7) ——
  attentionSoundLabel: 'Sound timing',
  attentionNotifyLabel: 'Notification timing',
  policy_current_only: 'Only the current session',
  policy_current_only_hint: 'Ring when the session you have open has news; leave the others alone.',
  policy_away: 'Only when I am away from DSH',
  policy_away_hint: 'Stay quiet while you are looking at DSH, ring once you switch away — the Codex desktop default.',
  policy_away_or_other: 'When I am away, or it is another session',
  policy_away_or_other_hint: 'Recommended: quiet only while you are actually looking at that session; everything else rings, so background sessions are never missed.',
  policy_always: 'Always',
  policy_always_hint: 'Ring for any session, at any time.',
  policy_never: 'Never',
  policy_never_hint: 'Mute this channel entirely.',
  policy_short_current_only: 'current session only',
  policy_short_away: 'only when away',
  policy_short_away_or_other: 'away or other sessions',
  policy_short_always: 'everything',
  policy_short_never: 'muted',

  // —— General (quiet rules shared by both channels) ——
  configSectionTitle: 'General',
  maxDepthLabel: 'Maximum session depth',
  maxDepthUnit: 'levels (0 = main session only)',
  maxDepthHint:
    '0 notifies only for the main session; 1 also for its direct subagents, and so on. Events from deeper sessions are skipped on both channels.',

  // —— System notifications (a second, independent channel) ——
  notifyTitle: 'System notifications',
  notifyHint:
    'Show a desktop notification when an event fires. It is a second channel, independent of sound, with its own timing policy.',
  notifyEnable: 'Enable system notifications',
  notifyPerKind: 'Send a notification',
  notifyPerKindOff: 'The notification master switch is off, so this does not take effect yet.',
  notifyRequest: 'Allow',
  notifyRequesting: 'Requesting…',
  notifyPermissionDefault: 'Not allowed yet — press "Allow" so the system can show them.',
  notifyPermissionGranted: 'Allowed.',
  notifyPermissionDenied: 'Blocked by the system; re-allow it in your system settings.',
  notifyPermissionUnsupported: 'System notifications are not available in this environment.',
  notifyTest: 'Test notification',
  notifyTestReady:
    'Sent. If nothing appeared, your system notification settings (Focus Assist / notification permission) are holding it back.',
  notifyTestDisabled: 'Not sent: the notification master switch is off.',
  notifyTestKindOff: 'Not sent: this event type is not ticked.',
  notifyTestUnsupported: 'Not sent: this environment does not support system notifications.',
  notifyTestPermission: 'Not sent: permission state is {state}.',
  notifyTestConfigError: 'Not sent: the configuration could not be read (internal error).',
  notifyTestUnknownKind: 'Not sent: unknown event type (internal error).',
  notifyTestDisposed: 'Not sent: the plugin has been disposed.',
  notifyRaiseWindow: 'Bring the window to the front on click',
  notifyRaiseWindowHint:
    'Experimental, off by default. Windows restores minimized windows and asks the desktop shell to show tray-hidden windows, then verifies foreground activation. If a visible background window still cannot be activated, one brief minimize/restore cycle may cause flicker; the OS can still deny activation. macOS and Linux use dsh://open. Concurrent clicks share a short-lived helper process. Desktop installs only — the browser ignores it.',
  experimentalTag: 'Experimental',
  notify_kind_approval_title: 'DSH · Approval needed',
  notify_kind_approval_body: 'A tool call is waiting for your approval.',
  notify_kind_question_title: 'DSH · Answer needed',
  notify_kind_question_body: 'A question is waiting for your reply.',
  notify_kind_interrupted_title: 'DSH · Interrupted',
  notify_kind_interrupted_body: 'The conversation could not continue because of an error.',
  notify_kind_completed_title: 'DSH · Finished',
  notify_kind_completed_body: 'The task has finished.',
  notifyBodyFromSession: 'From session — "{session}"',

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
    'Skip the completion event — on both channels — when less than this many seconds have passed since your last message, so small tasks stay quiet.',

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

  summaryNotifyOn: 'notifications on',
};
