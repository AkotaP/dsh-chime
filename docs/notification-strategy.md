# dsh-chime 通知策略优化方案（0.5.0 提案）

> 对照材料：Codex 桌面端通知系统（2026-10 官方文档 + 社区 Issue）。
> 本文只谈**提醒策略**，不重复已经落地的实现（四类事件判定、音效通道、通知通道见 `CONTRACT.md` §3 / §4.7）。
>
> **阅读约定**：✅ = 已在 chime 里实现并验证过；🔬 = 需要新写的提案；⚠️ = 实测踩过的坑。

---

## 0. 结论先行

| 判断 | 内容 |
|---|---|
| **该抄** | 把"窗口是否在场"作为一等信号；完成通知按在场状态分级 |
| **已经领先 Codex** | ① 会话级焦点（Codex 还停在 Issue 阶段）；② 音效与通知彻底解耦（Codex 有"关了通知声还在响"的 bug）；③ 四类事件，比 Codex 多一类「中断」；④ 完成判定是复合的，不是"一条消息结束" |
| **不该抄** | 通知里的动作按钮（Codex 点 Approve 只关 Toast、没真批准）；Activity 视图（DSH 侧边栏自带 `completionUnread`） |
| **最大的缺口** | chime 只看"**哪个会话**"，不看"**窗口在不在场**"。Codex 只看"窗口在不在场"，不看"哪个会话"。**两者都只做对了一半** |
| **建议做法** | 两个维度都要，合并成一张五档策略表；音效与通知各选一档，但**共用同一个在场感判定**（避免 Codex 那种不同步） |

---

## 1. 现状盘点：Codex 能力 × chime 现状

| 能力 | Codex | chime 现状 |
|---|---|---|
| 完成通知分级（Never / Unfocused / Always） | ✅ 三档，按窗口焦点 | ❌ 只有一个布尔 `backgroundSessions`（只分会话，不分焦点） |
| 权限请求独立通知 | ✅ | ✅ `notify.kinds.approval` |
| 提问独立通知 | ✅ | ✅ `notify.kinds.question` |
| 中断 / 失败通知 | ➖ 未单列 | ✅ 独立一类 `interrupted`，且排除自动重试 |
| **会话级焦点**（事件来自非当前对话也通知） | ❌ 仍是一条功能请求 | ✅ **已有**：`sessions.list.byId[id].retainedBy.mainView > 0` 就是"当前正在看的会话" |
| 声音与通知解耦 | ⚠️ 出过"关了通知声仍响"的 bug | ✅ 两条独立通道，配置互不引用 |
| 通知去重 | conversationId + turnId + eventType | ✅ `tag = dsh-chime:<kind>:<会话id>` + 上升沿判定 |
| 通知点击定位到会话 | ✅ | ⚠️ 只做了 `window.focus()`，没跳会话 |
| 完成判定粒度 | turn 级 | ✅ 比 turn 更严：`running === false` **且**无在跑子代理 **且**无后台 job，外加 1200ms 防抖 |
| 通知动作按钮 | ⚠️ 有，但有"点了没真批准"的问题 | ➖ 建议**不做** |
| 应用内 Activity 视图 | ✅ | ➖ 不建议做，DSH 侧边栏已覆盖 |

**一句话**：Codex 的"焦点"这一半 chime 没有，chime 的"会话"这一半 Codex 没有。

---

## 2. 事件模型：不动

对照该材料中的建议表逐条核对，**现有实现已全部满足**，不需要改：

| 场景 | 建议 | chime 现状 |
|---|---|---|
| Agent 开始思考 / 调用工具 / 工具结束继续 | 不通知 | ✅ 不产生事件 |
| 输出最终回复（一轮结束） | 按焦点策略 | ✅ `completed`（复合判定 + 最短时长门槛） |
| 请求权限 | 通知 | ✅ `approval` |
| 主动提问 | 通知 | ✅ `question` / `plan-review` |
| 执行失败无法继续 | 通知 | ✅ `interrupted`（`lastAgentError` 上升沿 + 已停机） |
| 被手动停止 | 不通知 | ✅ 手动停止不产生 `lastAgentError`，天然不响 |
| 自动重试成功 | 不通知 | ✅ 重试期间 `running` 仍为 true，事件期不成立 |
| 自动重试耗尽 | 通知 | ✅ 错误保留 + 落回 idle → 成立 |

同一时刻多事件并存时的优先级 `approval > question > interrupted > completed` 也已经是既定规则（CONTRACT §3.1），与建议的 `Permission/Question > Error > TurnComplete` 一致。

> **关于"事件从哪里获取"**（该材料第七节的建议）：已经查清了，**不需要拦截页面内部消息**。DSH 公开了 `uiSession.sessionStatus`（`ObservableSnapshot<Map<SessionId, SessionStatus>>` **且带 `subscribe`**）与 `sessions.list`，chime 现在就是靠这两个源 + 事件驱动 `poke()` 跑的。

---

## 3. 新增维度：在场感（presence）🔬

新增 `src/client/presence.js`，把"人此刻在不在 DSH 面前"变成一个可查询、可单测的信号：

```js
createPresence({ getActiveSessionId })
// → {
//     focused(),                  // 窗口是否拥有焦点
//     visible(),                  // 窗口是否可见（非最小化）
//     attended(sessionId),        // 人是否正看着这条会话 = focused && 它是当前会话
//     subscribe(listener),        // 焦点/可见性变化时通知（用来撤销过期的通知）
//   }
```

**信号来源（已核实，无需 Host 依赖）**

| Codex 日志字段 | DSH 对应 | 说明 |
|---|---|---|
| `rendererWindowFocused` | `document.hasFocus()` | 最小化、切到别的程序、被 DevTools 抢焦点都会变 false |
| `rendererWindowVisible` | `document.visibilityState !== 'hidden'` | 只反映"最小化/隐藏标签页" |

⚠️ **两个实测注意点**：
1. **被其他窗口"遮挡"不等于不可见**。DSH 的 Electron 主进程没有开 occlusion 计算（主进程里没有 `CalculateNativeWinOcclusion` 之类的开关），所以被遮挡时 `visible()` 仍是 true，但 `focused()` 会是 false —— **判定以 `focused()` 为主，`visible()` 只用来兜底**。
2. **开着 DevTools 调试时 `focused()` 恒为 false**。测试通知策略时务必知道这一点，否则会误判。

---

## 4. 提醒策略：二值 → 五档枚举 🔬

把现有 `backgroundSessions`（只分会话）升级为 `attention`（会话 × 焦点）：

| 策略 | 当前会话·聚焦 | 当前会话·失焦 | 其他会话·聚焦 | 其他会话·失焦 | 对应 |
|---|---|---|---|---|---|
| `current-only` | 🔔 | 🔔 | ✕ | ✕ | **chime 现状**（`backgroundSessions: false`） |
| `away` | ✕ | 🔔 | ✕ | 🔔 | **Codex 默认**（Only when unfocused） |
| `away-or-other` | ✕ | 🔔 | 🔔 | 🔔 | **推荐**：Codex 那条 Issue 想要的，chime 现在就能做到 |
| `always` | 🔔 | 🔔 | 🔔 | 🔔 | chime 现状（`backgroundSessions: true`） |
| `never` | ✕ | ✕ | ✕ | ✕ | — |

**配置形状**

```js
attention: {
  sound:  'current-only',      // 音效：默认保持现状，不改变你的听感
  notify: 'away-or-other',     // 通知：默认比现在更聪明
},
notify: {
  enabled: false,
  kinds: { approval: true, question: true, interrupted: true, completed: true },  // 事件级：要不要提醒这一类
},
```

两层是 **AND** 关系：`kinds[kind]` 决定"这一类要不要提醒"，`attention.X` 决定"此刻要不要打扰"。前者是事件级，后者是时机级，互不替代。

**默认值建议**

- **音效 `current-only`**：保持现状零风险。你现在的听感是"我盯着的那个会话出事就响"，改掉会突兀。
- **通知 `away-or-other`**：这比现在的"无条件弹"更好 —— 你正看着那条会话时不再弹通知（你已经在看了），但只要窗口失焦或事件来自别的会话就一定弹。**这正是 Codex 那条 Issue 想要而还没做到的行为。**

**迁移**：读到旧配置时把 `backgroundSessions` 折算进来 —— `true → always`、`false → current-only`；旧字段随后不再参与判定（可以保留读取、不再写出）。

---

## 5. 通知通道的三个增强 🔬

| 增强 | 做法 | 为什么值得 |
|---|---|---|
| **撤回过期通知** | `presence.subscribe` + `pendingInteraction` 消失时，`close()` 掉对应 tag 的通知（`notify.js` 已有 `open` 集合，加一个 `revoke(kind, sessionId)` 即可） | 审批处理完了，那条"等待授权"还挂在通知中心，纯噪音 |
| **点击定位到会话** | `onClick` 里带上 `sessionId`，尝试把 DSH 切到该会话（优先用 DSH 的会话切换能力，拿不到就退回 `window.focus()`） | 多项目并行时，通知的价值一半在于"点进去就是那条对话" |
| **去重** | 已有：`tag` 按会话 + 上升沿判定；⚠️ tag 长度受 Windows 的 64 字符上限约束，已在 `tagFor()` 里截尾封顶 48 | 已解决，写进来是防止回归 |

---

## 6. 明确不做的 🔬

| 不做 | 理由 |
|---|---|
| **通知里的动作按钮**（批准 / 回复） | Codex 实测有"点了 Approve 只关 Toast、请求没批"的问题。审批是要担责的操作，塞进系统通知的按钮里风险不对等。要做也该由 DSH 自己的审批 UI 承担 |
| **Activity 视图** | DSH 侧边栏已有 `running` / `completionUnread`，插件再做一个只会重复 |
| **任何形式的抢焦点** | 只在用户主动点击通知时 `focus()`；其余时刻一律安静。Codex 历史上就吃过这个亏 |
| **声音绑定通知开关** | 已经是两条独立通道，继续保持 —— Codex 的"关了通知声还响"就是绑太紧的反例 |

---

## 7. 落地分期

| 阶段 | 内容 | 规模 |
|---|---|---|
| **P0** | `presence.js` + `attention` 五档策略（替换 `backgroundSessions`）+ 设置页两个下拉 + 迁移 + 测试 | 一轮，改动集中在 `config.js` / `detect.js` / `index.js` / `settings.jsx` |
| **P1** | 通知撤回 + 点击跳转会话 | 一轮，集中在 `notify.js` / `index.js` |
| **P2**（可选） | 通知音与音效通道的联动开关、按事件类型分别设置策略 | 按需 |

P0 之后，chime 在通知策略上就同时具备 Codex 的焦点感知**和** Codex 还没有的会话感知。

---

## 8. 已实测的技术约束（写在前面，省得重复踩坑）

1. ⚠️ **Windows toast 的 `Tag` 上限 64 字符**，超长会被 Chromium **整条静默丢弃**（构造成功、无 `error`、不弹也不进通知中心）。DSH 的 `session-<uuid>` 拼上前缀正好 64 —— 已修，`tagFor()` 封顶 48。
2. ⚠️ **后台窗口的 `setTimeout` 会被 Chromium 节流**（≥1 秒，长期后台更粗）。所以判定不能靠轮询 —— 已经改成订阅 `sessionStatus` / `sessions.list` + `poke()` 事件驱动，`visibilitychange` 兜底。
3. ⚠️ **通知权限**：Electron 里 `Notification.permission` 是 `granted`；DSH 主进程对某些 session 设了"一律拒绝"的权限处理器，但不拦这条路径（2026-10-17 实测：手动 `new Notification` 与插件调用都能弹）。
4. ⚠️ **`document.hasFocus()` 在 DevTools 打开时为 false** —— 测策略时记得先关掉或心里有数。
5. ⚠️ **通知必须 `silent: true`**：声音归音效通道，否则同一事件会"双响"。

---

## 9. 待决定的三件事

1. **音效默认策略**：保持 `current-only`（现状不变），还是也跟着升级到 `away-or-other`（"你正看着就不响"）？
2. **`backgroundSessions` 的处理**：直接替换成 `attention` 枚举（未发布，破坏性可控）还是两者并存一段时间？
3. **P0 是否现在动手**，还是先看完这份方案再定。
