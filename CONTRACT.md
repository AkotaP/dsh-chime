# dsh-chime 架构契约（所有 teammate 必读）

> 本文件是唯一事实来源。所有接口先在这里定死，再各自实现。
> 证据文件在 `.probe/`（从 DSH `app.asar` 提取的真实源码），引用格式 `文件:行号`。

---

## 0. 产品目标

DSH 音效插件。四类事件各一个音效，**默认全部为空 → 不响**：

| key | 事件 | 含义 |
|---|---|---|
| `approval` | 权限审批 | 等待用户批准工具调用 |
| `question` | 回答问题 | `ask_user_question` / 计划审批 |
| `interrupted` | 中断 | 对话因错误无法继续 |
| `completed` | 完成 | 任务真正结束 |

硬性要求：
1. **链接式**：用户自己提供音频（http(s) URL 或本地绝对路径），插件**不复制**文件到插件目录。
2. **每个音效独立音量**。
3. **多会话开关**：可关掉"背景会话也响"。
4. **自动重试不响**：会被自动重试的失败不得触发 `interrupted`。
5. **配置页写在 DSH 插件页里**，不新增顶层设置页。
6. 静态插件包。

---

## 1. 形态与构建

**纯 client 插件**：host half 只是 Loader 行占位（`export function apply() {}`），全部功能在 client half。
原因：所需能力全部有现成 Remote 通道（见 §2.1），自建 `@Remote` 需要 Typert 代码生成（`typert.host.js` / `typert.remote-client.js`），不划算。

**client bundle 格式**（DSH 的 `window.__ModuleLoader__.load` 协议，证据 `.probe/ui-session-client.js:1-4`、`.probe/client-modules-README.md:48`）：

```js
window.__ModuleLoader__.load({
  id: "dsh-chime",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    // ... bundle 内容，可用 require("@deepseek-ai/cordis") 等
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

构建用 **esbuild**：`format: 'cjs'` + `external` 保留 `require(...)`，再套上面的 wrapper（esbuild 的 cjs 输出正好用 `module.exports` / `require`）。
`package.json` 必须是：`exports["./client"] -> ./lib/client.js`，`dsh.client = { platform: "web", inject: [...], external: [...] }`（证据 `asar:/dsh/node_modules/@deepseek-ai/dsh-client-ui-jobs/package.json`）。

**构建器只提供已构建的 bundle** —— `lib/client.js` 必须先构建出来（证据 `.probe/client-modules-README.md:48-50`）。

---

## 2. 已核实的 DSH API

### 2.1 client half 可用能力

| 能力 | 调用 | 证据 |
|---|---|---|
| 取服务 | `ctx.get(name)` | Builtin provider |
| 生命周期 | `ctx.effect(fn, label)` | 同上 |
| 注册 UI | `ctx.slots.inject(slot, () => ctx.slots.register({...}, Component))` | `.probe/plugin-manager-README.zh.md:62-82` |
| 读本地文件字节 | `ctx.remote.workspaceFiles.readBytes(sessionId, path, options, signal)` | `.probe/workspace-files-client.js:110,363` |
| 浏览选目录 | `ctx.remote.directoryPicker.pick(signal)` → `string \| null` | host Service catalog |
| 列目录 | `ctx.remote.directoryPicker.list(path, signal)` | 同上 |
| 后台任务流 | `ctx.remote.job.list({ sessionId }, signal)` → `JobListFrame{type:'rows', jobs: JobView[]}`（**无自然结束**） | host Service catalog |

> ⚠️ `readBytes` 的 client 侧调用**传 sessionId，不传 `{sessionId, workspaceRoot}`**（wire 层做 lookup，证据 `.probe/workspace-files-client.js:110,363`）。返回 `WorkspaceFileBytes{ data: Uint8Array, offset, eof, absolutePath, version, bytes }`。

### 2.2 会话状态源（核心）

`ctx.get('uiSession').sessionStatus` 是 `ObservableSnapshot<Map<SessionId, SessionStatus>>`（证据 `.probe/ui-session-client.js:147-156,342-358`）：

```ts
type SessionStatus = {
  running: boolean | undefined;
  pendingInteraction: PendingInteraction | undefined;
  completionUnread: boolean;
};
```

在 **slot 组件**里用 standard prop `useSessionStatus(selector)` 更规范（证据 `settings.section` catalog 的 `standardProps`）。

`pendingInteraction` 的 `kind` ∈ `'approval' | 'plan-review' | 'question'`（证据 `.probe/workspace-client.js:441-448`）。

### 2.3 会话列表

`ctx.get('sessions').list` 是 `ObservableSnapshot<SessionListSnapshot>`：
- `ids: SessionId[]`
- `byId: Record<SessionId, { running, retainedBy: { mainView?: number }, ... }>`
- `projectionsBySession[id].values.subagentCatalog` → 子代理数组，每项 `{ id, ... }`
- `phase: 'pending' | 'ready'`

子代理计数参考实现（证据 `.probe/workspace-client.js:449-451`）：

```js
runningChildCount(list, parentId, statuses) {
  return list.projectionsBySession[parentId]?.values.subagentCatalog?.reduce(
    (count, child) => count + ((statuses.get(child.id)?.running ?? list.byId[child.id]?.running) === true ? 1 : 0), 0) ?? 0;
}
```

`retainedBy.mainView > 0` = **当前激活的会话**（证据 `.probe/ui-session-client.js:283,339-341`）。

### 2.4 配置页落点

DSH 的原则是「自带配置的插件把配置渲染在本页而不是设置里」（证据 `.probe/plugin-manager-README.zh.md:60`）。

**主落点：`plugins.row.config`**（keyed slot）。本插件是**自引用 bundle**（见 §6），patch 声明的行 id 为 `chime`，
于是插件详情页的该行出现「配置」控件，点开即我们的表单：

```jsx
ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
  name: 'plugins.row.config',
  key: 'dsh-chime#chime',        // <包名>#<行 id>
  locale: 'dshChime',
}, ({ t, view }) => view === 'summary' ? <ChimeSummary t={t} /> : <ChimeSettings t={t} />))
```

**兜底：`plugins.item`**（list slot，root scope）—— 出现在插件页「官方」分组，点开同样是完整配置页：

```jsx
ctx.slots.inject('plugins.item', () => ctx.slots.register({
  name: 'plugins.item',
  id: 'dsh-chime',
  order: 100,
  label: '提示音',
  locale: 'dshChime',
}, ({ t, view }) => view === 'summary' ? <ChimeSummary t={t} /> : <ChimeSettings t={t} />))
```

`view: 'page'` 渲染完整表单，`view: 'summary'` 渲染卡片摘要。两者由 **Lead 在 `index.js` 里二选一或同时注册**，
UI 组件本身与注册方式无关。

可选增强：`plugins.detail.section` 追加区块，`subject` 为 `{kind:'bundle'|'row'|'item', ...}`（证据 `.probe/plugin-manager-README.zh.md:74-82`）。

### 2.5 音频播放

**必须走 Web Audio**（`AudioContext` + `decodeAudioData` + `BufferSource` + `GainNode`），
不能把 `HTMLAudioElement` 当主引擎：

> 浏览器的 autoplay 策略要求 `HTMLMediaElement.play()` 落在用户手势的有效期内
> （transient activation）。而本插件的**核心场景恰恰是自动触发**——对话完成、审批、
> 中断，那时没有任何手势，`play()` 必然抛 `NotAllowedError`。

`AudioContext` 只需要在**任意一次**用户手势里 `resume()` 一次
（本插件在首次 `pointerdown` / `keydown` 时解锁，见 `src/client/index.js` 的
`dsh-chime: audio unlock` effect），此后 `BufferSource.start()` 不再受 autoplay 限制。

- 本地文件：`workspaceFiles.readBytes` → `arrayBuffer` → `decodeAudioData`
- URL：`fetch` → `decodeAudioData`（需目标站 CORS）；失败回退 `HTMLAudioElement`
- 音量：每个音效一个 `GainNode`，天然独立
- `preview` 失败时抛带原因的 `Error`（供设置页显示）；`play` 静默返回 boolean，
  另有 `lastFailure(kind)` 供诊断

---

## 3. 四类事件判定规则（**核心，防误报**）

> 背景：DSH 的 `agent/status` **只看 agent loop 的 phase**，与后台 job 零交互
> （证据 `.probe/agent-loop.js:790-798` + `.probe/api-list.js:93`）。所以 `running === false` **不等于**任务结束。

### 3.1 优先级

同一会话同一时刻只响一个音。优先级（高 → 低）：`approval` > `question` > `interrupted` > `completed`。
同一 tick 内多类事件同时成立时，只取优先级最高的一个。

### 3.2 `approval`（权限审批）

```
status.pendingInteraction?.kind === 'approval'
```
上升沿触发（undefined/其他 → 'approval'）。消失时重置。

### 3.3 `question`（回答问题）

```
status.pendingInteraction?.kind === 'question' || === 'plan-review'
```
上升沿触发。`plan-review` 归入 `question`。

### 3.4 `interrupted`（中断）—— **必须排除自动重试**

判定源（择一，实现时优先用能确认终局的）：

- **首选**：`SessionSnapshot.lastAgentError` 从 falsy → truthy 的**上升沿**。
  它是 agent 级的最终错误，重试成功不会留下它。
- 兜底：session 事件流里 `turn/end` 且 `data.reason.kind === 'error'`。
- **禁止**使用 host 的 `agent/request-error`（它包含会被自动重试的失败，违反需求 4）。

`SessionSnapshot` 由 `ctx.get('sessions').retain(id)` → `binding.session.getSnapshot()` 获得，字段含 `lastAgentError: string|null`、`promptError`、`running`。
仅在 `running === false` 后仍存在 `lastAgentError` 上升沿时才响（避免重试期间的瞬时错误）。

### 3.5 `completed`（完成）—— **必须复合判定**

```
真完成 = running === false
      && runningChildCount(list, sessionId, statuses) === 0     // 无在跑子代理
      && activeJobCount(sessionId) === 0                        // 无在跑后台 job
```

- `activeJobCount`：`ctx.remote.job.list({sessionId})` 流的最新帧里 `status ∈ {'running','stopping'}` 的条数。
- 从 `running === true` 开始跟踪，只有**观察到过 running（或 job 活跃）之后再落到全空闲**，才算一次完成 —— 防止初始状态误触发。
- 需要一个**防抖窗口**（建议 1200ms）：窗口内若 `running` 回到 true 或出现新 job，则取消本次完成。

### 3.6 多会话

- `sessionId` 是否为"当前激活会话"：`sessions.list.byId[id].retainedBy.mainView > 0`。
- 若配置 `backgroundSessions === false`（默认建议 false），**非激活会话一律不响**。
- 注意 DSH 的 `completionUnread` 只对非主会话置位（证据 `.probe/ui-session-client.js:314-321`），可作参考但**不要直接依赖它**，因为主会话永远为 false。

---

## 4. 模块接口（先定死，各自实现）

所有模块都是 **ESM**，位于 `src/client/`，由 esbuild 打包进单文件 `lib/client.js`。

### 4.1 `config.js`（owner: audio-and-config）

```js
/** 音效种类（顺序即 UI 顺序） */
export const CHIME_KINDS = ['approval', 'question', 'interrupted', 'completed'];

/** 单个音效配置；src 为空字符串表示未配置（不响） */
export const DEFAULT_CHIME = { src: '', volume: 0.8, source: 'url' };
// source: 'url' | 'file'

export const DEFAULT_CONFIG = {
  backgroundSessions: false,      // 背景会话是否也响
  enabled: true,                  // 总开关
  kinds: {
    approval:    { src: '', volume: 0.8, source: 'url' },
    question:    { src: '', volume: 0.8, source: 'url' },
    interrupted: { src: '', volume: 0.8, source: 'url' },
    completed:   { src: '', volume: 0.8, source: 'url' },
  },
};

/** ObservableSnapshot<Config> 风格 */
export function createConfigStore() {
  return {
    getSnapshot(),              // () => Config
    subscribe(fn),              // () => unsubscribe
    update(patch),              // 浅合并顶层
    setKind(kind, patch),       // 合并某个音效
    reset(),
  };
}
export function normalizeConfig(raw); // 容错读入（旧版本/损坏数据）
```

持久化：`localStorage`，key `dsh.chime.config.v1`。
> DSH 自己就用 localStorage 存浏览器侧偏好（证据 `.probe/plugin-manager-README.zh.md:153`）。

### 4.2 `audio.js`（owner: audio-and-config）

```js
/**
 * @param {object} deps
 * @param {(path:string, signal:AbortSignal)=>Promise<{data:Uint8Array, version:string}>} deps.readLocalFile
 * @param {(path:string)=>boolean} deps.isLocalPath
 */
export function createAudioEngine(deps) {
  return {
    /** 预解析并缓存（URL 直连；本地路径走 readLocalFile → Blob URL） */
    async prepare(kind, src, source),
    /** 播放；src 为空直接 resolve(false) 不发声 */
    async play(kind, { src, source, volume }),
    /** 仅设音量，0..1，钳制 */
    setVolume(kind, volume),
    /** 试听（等价 play，但忽略未配置则返回 false） */
    async preview(kind, { src, source, volume }),
    dispose(),
  };
}
```

要求：
- 本地路径：`readLocalFile` → `new Blob([data])` → `URL.createObjectURL` → `Audio`；**按 `version` 做缓存**，版本没变不重复读。
- 播放失败（`NotAllowedError` autoplay 拦截、404、解码失败）**必须静默 catch**，不得抛到调用方。
- 同一 kind 连续触发要能打断上一次（`currentTime = 0` 或新建实例）。

### 4.3 `assets.js`（owner: host-and-assets）

```js
/** 判断是否为本地绝对路径（Windows 盘符 / UNC / POSIX 绝对路径），而非 http(s) URL */
export function isLocalPath(src);

/** 构造读取器：client 侧调 workspaceFiles Remote */
export function createLocalFileReader(ctx) {
  return {
    /** 读任意本地文件字节；自动选一个可用 sessionId */
    async read(path, signal),      // → { data: Uint8Array, version: string }
  };
}

/** 目录浏览数据源，供配置页的文件选择器用 */
export function createFileBrowser(ctx) {
  return {
    /** 原生选目录对话框 → 绝对路径 | null */
    async pickDirectory(signal),
    /** 列出目录下的音频文件 */
    async listAudioFiles(path, signal),   // → [{ name, path, size }]
  };
}

export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'];
```

实现要点：
- `read`：`ctx.remote.workspaceFiles.readBytes(sessionId, path, {}, signal)`。`sessionId` 取 `ctx.get('sessions').list.getSnapshot().ids[0]`（或当前激活会话）。失败时给出可读错误。
- `pickDirectory`：`ctx.remote.directoryPicker.pick(signal)`；不可用时返回 null。
- `listAudioFiles`：`ctx.remote.directoryPicker.list(path, signal)` 过滤 `AUDIO_EXTENSIONS`。

### 4.4 `detect.js`（owner: detector）

```js
/**
 * @param {object} deps
 * @param {() => Map<SessionId, SessionStatus>} deps.getStatuses
 * @param {() => SessionListSnapshot}            deps.getSessionList
 * @param {(sessionId) => Promise<number>}       deps.countActiveJobs
 * @param {(event: {kind, sessionId, urgent?: boolean}) => void} deps.onChime
 * @param {() => Config}                         deps.getConfig
 */
export function createDetector(deps) {
  return {
    /** 开始监听；返回 dispose */
    start(),
    /** 单次求值（测试用，可注入假数据） */
    evaluate(statuses, list, activeJobs),
    dispose(),
  };
}
```

要求：
- 内部维护 per-session 的上一次状态快照，只做**上升沿**触发。
- 实现 §3 全部规则，特别是 §3.5 的复合判定与防抖、§3.4 的重试排除。
- **`evaluate(...)` 必须是纯函数式的单步求值**，便于单测（用假数据直接跑）。

### 4.5 `settings.jsx`（owner: settings-ui）

```jsx
export function ChimeSettings(props); // slot 组件，view 由 index.js 决定
export function ChimeSummary(props);  // 卡片摘要（view === 'summary'）
```

UI 内容：
- 总开关
- 「背景会话也响」开关
- 四个音效各一行：标签 + 链接输入框（URL 或绝对路径）+「浏览…」按钮 + 音量滑块（0-100）+「试听」按钮
- 未配置时输入框为空、显示"未设置（不响）"
- 保存：直接写入 config store（live 生效，不需要独立"保存"按钮）

依赖注入：组件通过 props 接收 `{ t, configStore, audioEngine, fileBrowser }`，**不要直接 import**（便于测试与解耦）。

### 4.6 `index.js`（owner: **Lead**）

组装全部模块、注册 slot、启动 detector。**由 Lead 独占，其他人不要改。**

---

## 5. 协作纪律

- **写文件范围严格按 owner 划分**，不要碰别人的文件。
- 只用 ESM；不要引入除 `react` 以外的新运行时依赖。
- 所有对外函数都要有 JSDoc 注释（DSH 风格）。
- 不做未在本文档定义的重构。

---

## 6. 打包形态（自引用 bundle）

单包 `dsh-chime`，同时声明 bundle 与 client：

```jsonc
// package.json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": [], "external": [] }
}
```

```yaml
# cordis.patch.yml  —— 声明插件行，行 id 为 chime
- insert:
    - id: chime
      name: 'dsh-chime'
```

```
dsh-chime/
├── package.json
├── cordis.patch.yml          Loader 行声明
├── icon.svg
├── build.mjs                 esbuild 构建
├── src/
│   ├── host/index.js         Loader 行占位（apply 为空）
│   └── client/               ← 全部功能
│       ├── index.js          Lead 独占：组装 + 注册 slot
│       ├── config.js         owner: audio-and-config
│       ├── audio.js          owner: audio-and-config
│       ├── assets.js         owner: host-and-assets
│       ├── detect.js         owner: detector
│       └── settings.jsx      owner: settings-ui
└── lib/
    ├── index.js              构建产物
    └── client.js             构建产物（__ModuleLoader__ 协议）
```

构建命令：`node build.mjs`（需先 `pnpm add -D esbuild`）。

