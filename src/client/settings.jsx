/**
 * dsh-chime 配置页（纯 client half）。
 *
 * 导出两个槽组件（CONTRACT §4.5）：
 *  - `ChimeSettings` —— 完整表单，用于 `view === 'page'`
 *  - `ChimeSummary`  —— 卡片摘要，用于 `view === 'summary'`
 *
 * 依赖全部由 props 注入：`{ t, configStore, audioEngine }`。
 * 本文件刻意 **不 import** `config.js` / `audio.js` / `assets.js`，只依赖
 * CONTRACT §4.1–4.3 声明的接口签名，便于解耦与单测；因此音效 key 顺序与
 * 默认形状在本文件内本地复制了一份（见 `KIND_ORDER` / `FALLBACK_*`）。
 *
 * 唯一的本地 import 是 `./locale.js` 的 `zh`：文案一律走注入的 `t(key)`
 * （`index.js` 用 `locale.bind(NS)` 绑定），只有在 `t` 缺失/返回空串时才回落
 * 到 `zh` 字典，再不行就原样显示 key —— 不会渲染空白。
 *
 * 音源只有一种录入方式：输入栏粘贴
 *  1. http(s) 网络链接 → `source = 'url'`；
 *  2. 本地文件绝对路径 → `source = 'file'`，由 host 路由按需读取，不复制文件。
 *
 * 本地文件选择 UI（`<input type="file">` + IndexedDB）已按产品决定**撤下**；
 * 万一读到旧配置里的 `source: 'local'`，`normalizeSource` 仍原样保留，输入栏
 * 照常显示 `src`，不会崩。
 *
 * 所有修改立即写回 `configStore`（live 生效，无独立保存按钮，CONTRACT §2.4）。
 */

import { useCallback, useEffect, useState } from 'react';
import { zh } from './locale.js';

/** 音效种类顺序，与 CONTRACT §4.1 的 `CHIME_KINDS` 保持一致（不从 config.js import）。 */
const KIND_ORDER = ['approval', 'question', 'interrupted', 'completed'];

/** 单个音效的兜底形状，来自 CONTRACT §4.1 的 `DEFAULT_CHIME`。 */
const FALLBACK_KIND = { src: '', volume: 0.8, source: 'url' };

/**
 * 「完成」音效的最短任务时长（秒）的兜底值：字段缺失/损坏时按它显示，
 * 与 `config.js` 的 `DEFAULT_CONFIG.completionMinSeconds` 保持一致。
 */
const COMPLETION_MIN_FALLBACK = 10;

/** 最短任务时长的允许上限（秒）；超出一律钳到该值。 */
const COMPLETION_MIN_MAX = 3600;

/** 整体配置的兜底形状，来自 CONTRACT §4.1 的 `DEFAULT_CONFIG`。 */
const FALLBACK_CONFIG = {
  enabled: true,
  backgroundSessions: false,
  completionMinSeconds: COMPLETION_MIN_FALLBACK,
  kinds: {
    approval: { ...FALLBACK_KIND },
    question: { ...FALLBACK_KIND },
    interrupted: { ...FALLBACK_KIND },
    completed: { ...FALLBACK_KIND },
  },
};

/**
 * 全部内联样式。
 * 颜色一律走 `inherit` / `currentColor` / 半透明灰，以适配 DSH 的深浅色主题；
 * 不写死黑白色，也不依赖任何 UI 组件库或 CSS 文件。
 */
const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '2px 0',
    color: 'inherit',
    fontSize: '13px',
    lineHeight: 1.55,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 14px',
    border: '1px solid rgba(127, 127, 127, 0.28)',
    borderRadius: '10px',
  },
  cardHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  kindLabel: {
    fontWeight: 600,
  },
  hint: {
    opacity: 0.62,
    fontSize: '12px',
  },
  error: {
    margin: 0,
    fontSize: '12px',
    color: '#d9534f',
    opacity: 0.95,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  checkbox: {
    width: '15px',
    height: '15px',
    margin: 0,
    accentColor: 'currentColor',
    cursor: 'pointer',
  },
  input: {
    flex: '1 1 260px',
    minWidth: '180px',
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(127, 127, 127, 0.35)',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    fontSize: '12px',
  },
  button: {
    padding: '5px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(127, 127, 127, 0.35)',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    fontSize: '12px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  volumeLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    opacity: 0.85,
    cursor: 'pointer',
  },
  slider: {
    width: '130px',
    margin: 0,
    accentColor: 'currentColor',
    cursor: 'pointer',
  },
  volumeValue: {
    minWidth: '38px',
    fontSize: '12px',
    opacity: 0.75,
    fontVariantNumeric: 'tabular-nums',
  },
  spacer: {
    flex: '1 1 auto',
  },
  /** 「完成」卡片的最短任务时长区块（标签 + number 输入框 + 说明）。 */
  completionMin: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  numberInput: {
    width: '92px',
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(127, 127, 127, 0.35)',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    fontSize: '12px',
  },
  summary: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    color: 'inherit',
    fontSize: '12px',
    lineHeight: 1.5,
  },
  summaryMuted: {
    opacity: 0.62,
  },
};

/**
 * 归一化音源类型。
 *
 * 只有 `'url'`（http(s) 链接）与 `'file'`（本地绝对路径，走 host 路由）两种
 * 主动产生的取值；`'local'`（旧版本的浏览器本地文件）**仅为兼容旧配置而保留**，
 * 读到时不改写、不报错，照原样交给上层显示。`'local'` 但 `src` 为空时回落
 * `'url'`（等于未配置）。
 *
 * @param {unknown} value configStore 里的 `source`
 * @param {unknown} src 同一行的 `src`
 * @returns {'url'|'file'|'local'}
 */
function normalizeSource(value, src) {
  if (value === 'local') return String(src || '').trim() ? 'local' : 'url';
  if (value === 'file') return 'file';
  return 'url';
}

/**
 * 归一化单条音效配置。
 *
 * @param {unknown} raw 来自 configStore 的原始值
 * @returns {{ src: string, volume: number, source: 'url'|'file'|'local' }}
 */
function normalizeKind(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const volume = typeof value.volume === 'number' && Number.isFinite(value.volume) ? value.volume : FALLBACK_KIND.volume;
  const src = typeof value.src === 'string' ? value.src : '';
  return {
    src,
    volume: Math.min(1, Math.max(0, volume)),
    source: normalizeSource(value.source, src),
  };
}

/**
 * 把任意输入钳成合法的「最短任务时长」（秒）：空串/非数字/负数/NaN → 0，
 * 超过 3600 → 3600，其余向下取整。
 *
 * @param {unknown} raw 用户输入或 store 里的原始值
 * @returns {number} 0..3600 的整数
 */
function clampCompletionMinSeconds(raw) {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(COMPLETION_MIN_MAX, Math.floor(value));
}

/**
 * 读取 store 里的顶层 `completionMinSeconds`。
 *
 * 字段缺失/损坏时回落到默认值（10），保证界面不会出现 `NaN` 或空白。
 * 注意与输入态的区别：用户在输入框里清空得到的是 `''`，写进 store 的是 `0`，
 * 因此这里把「空值」视为缺失、把数字字符串视为有效数字。
 *
 * @param {unknown} raw configStore 快照里的原始值
 * @returns {number} 0..3600 的整数
 */
function readCompletionMinSeconds(raw) {
  if (raw === undefined || raw === null) return COMPLETION_MIN_FALLBACK;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? clampCompletionMinSeconds(raw) : COMPLETION_MIN_FALLBACK;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return COMPLETION_MIN_FALLBACK;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? clampCompletionMinSeconds(numeric) : COMPLETION_MIN_FALLBACK;
  }
  return COMPLETION_MIN_FALLBACK;
}

/**
 * 归一化整份配置；缺失/损坏字段回落到默认值，保证渲染不崩。
 *
 * @param {unknown} raw 来自 configStore 的快照
 * @returns {{ enabled: boolean, backgroundSessions: boolean, completionMinSeconds: number, kinds: Record<string, {src:string,volume:number,source:'url'|'file'|'local'}> }}
 */
function normalizeConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const rawKinds = value.kinds && typeof value.kinds === 'object' ? value.kinds : {};
  const kinds = {};
  for (const kind of KIND_ORDER) kinds[kind] = normalizeKind(rawKinds[kind]);
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : FALLBACK_CONFIG.enabled,
    backgroundSessions:
      typeof value.backgroundSessions === 'boolean' ? value.backgroundSessions : FALLBACK_CONFIG.backgroundSessions,
    completionMinSeconds: readCompletionMinSeconds(value.completionMinSeconds),
    kinds,
  };
}

/**
 * 读取一份安全的配置快照（store 抛错也不会冒泡到 React 渲染）。
 *
 * @param {{ getSnapshot: () => unknown } | undefined} configStore
 * @returns {ReturnType<typeof normalizeConfig>}
 */
function readSnapshot(configStore) {
  try {
    return normalizeConfig(configStore && configStore.getSnapshot());
  } catch {
    return normalizeConfig(FALLBACK_CONFIG);
  }
}

/**
 * 判断一个音源字符串是否走 URL 通道。
 *
 * @param {string} src
 * @returns {boolean}
 */
function isHttpUrl(src) {
  return /^https?:\/\//i.test(String(src || '').trim());
}

/**
 * 由输入内容推断 `source`：http(s) → `'url'`，其余 → `'file'`（空串回落 `'url'`）。
 *
 * @param {string} src
 * @returns {'url'|'file'}
 */
function classifySource(src) {
  if (!String(src || '').trim()) return 'url';
  return isHttpUrl(src) ? 'url' : 'file';
}

/**
 * 把任意异常转成一行可读文字；拿不到 `error.message` 时用调用方给的本地化兜底。
 *
 * @param {unknown} error
 * @param {string} [fallback] 无原因时的本地化文案（应由 `tt` 提供，避免硬编码）
 * @returns {string}
 */
function messageOf(error, fallback) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return typeof fallback === 'string' && fallback ? fallback : 'error';
}

/**
 * 取"试听失败"的可读原因。
 *
 * `audioEngine.preview()` 失败时会抛带原因的 Error（读取失败 / 解码失败 /
 * autoplay 被拒等）；这里优先透出 `error.message`，空 message 返回空串，
 * 由调用方回落到笼统文案。
 *
 * @param {unknown} error
 * @returns {string}
 */
function previewReason(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  return '';
}

/**
 * 把 `{name}` 占位替换为参数。
 *
 * @param {string} template
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
function format(template, params) {
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * 取一条文案。
 *
 * 优先用注入的 `t(key)`（`index.js` 用 `locale.bind(NS)` 绑定，随界面语言切换）；
 * `t` 缺失、抛错、返回空串或原样返回 key 时，回落到 `locale.js` 的 `zh` 字典；
 * 字典里也没有该 key 时原样显示 key —— **任何路径都不会渲染出空白**。
 *
 * DSH 的 locale `t` 只按 key 取值、没有占位参数，`{name}` 由本文件的 `format` 填充。
 *
 * @param {unknown} t 注入的 locale 函数
 * @param {string} key locale key
 * @param {Record<string, unknown>} [params] 占位参数
 * @returns {string}
 */
function translate(t, key, params) {
  const text = format(fallbackText(key), params);
  if (typeof t !== 'function') return text;
  try {
    const value = t(key);
    if (typeof value === 'string' && value.length > 0 && value !== key) return format(value, params);
  } catch {
    /* t 抛错时静默回落 */
  }
  return text;
}

/**
 * 取 `zh` 字典里的中文兜底；没有该 key 时原样返回 key（不产生空白）。
 *
 * @param {string} key locale key
 * @returns {string}
 */
function fallbackText(key) {
  const value = Object.prototype.hasOwnProperty.call(zh, key) ? zh[key] : undefined;
  return typeof value === 'string' && value.length > 0 ? value : key;
}

/**
 * 生成稳定的翻译函数（同一份 `t` 复用同一引用，便于 useCallback 依赖）。
 *
 * @param {unknown} t
 * @returns {(key: string, params?: Record<string, unknown>) => string}
 */
function useTranslator(t) {
  return useCallback((key, params) => translate(t, key, params), [t]);
}

/**
 * 订阅 configStore；快照变化时重渲染。
 *
 * @param {{ getSnapshot?: Function, subscribe?: Function } | undefined} configStore
 * @returns {ReturnType<typeof normalizeConfig>}
 */
function useConfigSnapshot(configStore) {
  const usable =
    !!configStore &&
    typeof configStore.getSnapshot === 'function' &&
    typeof configStore.subscribe === 'function';
  const [config, setConfig] = useState(() => (usable ? readSnapshot(configStore) : normalizeConfig(FALLBACK_CONFIG)));

  useEffect(() => {
    if (!usable) {
      setConfig(normalizeConfig(FALLBACK_CONFIG));
      return undefined;
    }
    setConfig(readSnapshot(configStore));
    let unsubscribe;
    try {
      unsubscribe = configStore.subscribe(() => setConfig(readSnapshot(configStore)));
    } catch {
      unsubscribe = undefined;
    }
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [usable, configStore]);

  return config;
}

/**
 * 完整配置表单（`view === 'page'`）。
 *
 * @param {object} props
 * @param {(key: string) => string} [props.t] locale 翻译函数，缺失用中文兜底
 * @param {{ getSnapshot: Function, subscribe: Function, update: Function, setKind: Function }} [props.configStore]
 * @param {{ preview?: Function, setVolume?: Function }} [props.audioEngine]
 * @returns {import('react').ReactElement}
 */
export function ChimeSettings(props) {
  const { t, configStore, audioEngine } = props || {};
  const tt = useTranslator(t);
  const config = useConfigSnapshot(configStore);

  /** 输入框草稿：key 存在时优先于 store 快照，避免 store 异步通知吞掉按键。 */
  const [drafts, setDrafts] = useState({});
  /** 每个音效的行内错误文字（试听失败等）。 */
  const [errors, setErrors] = useState({});
  /**
   * 「最短任务时长」输入框的草稿（保留用户输入的原始文本，避免输入中间态被
   * store 回写打断）；`undefined` 表示未编辑，直接显示 store 里的规范值。
   */
  const [completionDraft, setCompletionDraft] = useState(undefined);

  // store 采纳了草稿（或外部改动与草稿一致）后清掉草稿，让快照重新成为唯一事实来源。
  useEffect(() => {
    setDrafts((previous) => {
      const next = {};
      let changed = false;
      for (const kind of KIND_ORDER) {
        const draft = previous[kind];
        if (draft === undefined) continue;
        if (draft === config.kinds[kind].src) changed = true;
        else next[kind] = draft;
      }
      return changed ? next : previous;
    });
  }, [config]);

  /**
   * 设置/清除某个音效的行内错误。
   *
   * @param {string} kind
   * @param {string} message 空字符串表示清除
   */
  const setKindError = (kind, message) => {
    setErrors((previous) => {
      const next = { ...previous };
      if (message) next[kind] = message;
      else delete next[kind];
      return next;
    });
  };

  /**
   * 立即写入某个音效的配置（live 生效）。
   *
   * @param {string} kind
   * @param {object} patch
   */
  const writeKind = useCallback(
    (kind, patch) => {
      if (!configStore || typeof configStore.setKind !== 'function') return;
      try {
        configStore.setKind(kind, patch);
      } catch (error) {
        setKindError(kind, messageOf(error, tt('actionFailed')));
      }
    },
    [configStore, tt],
  );

  /**
   * 立即写入顶层配置。
   *
   * @param {object} patch
   */
  const updateConfig = useCallback(
    (patch) => {
      if (!configStore || typeof configStore.update !== 'function') return;
      try {
        configStore.update(patch);
      } catch {
        /* 顶层开关没有对应行内错误位，静默忽略 */
      }
    },
    [configStore],
  );

  /** 输入框变化：写草稿 + 立即回填 store，并按内容推断 source。 */
  const onSrcChange = (kind, value) => {
    setDrafts((previous) => ({ ...previous, [kind]: value }));
    setKindError(kind, '');
    writeKind(kind, { src: value, source: classifySource(value) });
  };

  /** 音量变化：0–100 → 0..1，顺手同步给 audioEngine（若可用）。 */
  const onVolumeChange = (kind, percentText) => {
    const percent = Number(percentText);
    if (!Number.isFinite(percent)) return;
    const volume = Math.min(1, Math.max(0, percent / 100));
    writeKind(kind, { volume });
    if (audioEngine && typeof audioEngine.setVolume === 'function') {
      try {
        audioEngine.setVolume(kind, volume);
      } catch {
        /* 仅预置音量，失败不影响配置写入 */
      }
    }
  };

  /**
   * 「最短任务时长」变化（顶层字段 `completionMinSeconds`，只作用于「完成」音效）。
   *
   * 输入框里保留用户原文当草稿，写进 store 的永远是钳制后的整数：
   * 空串/非数字/负数/NaN → `0`（= 关闭门槛），超过 3600 → `3600`。
   * 输入过程中不强行改写输入框内容（例如先打 `1` 再打 `5` 不会被 `1` 卡住），
   * 失焦时才收起草稿、显示规范值 —— 与现有输入框的草稿策略一致。
   *
   * @param {string} text number 输入框的原始字符串
   */
  const onCompletionMinChange = (text) => {
    setCompletionDraft(String(text));
    updateConfig({ completionMinSeconds: clampCompletionMinSeconds(text) });
  };

  /** 失焦：收起草稿，输入框改为显示 store 里的规范值。 */
  const onCompletionMinBlur = () => setCompletionDraft(undefined);

  /** 清掉某个音效的输入框草稿（store 成为唯一事实来源）。 */
  const dropDraft = (kind) => {
    setDrafts((previous) => {
      if (previous[kind] === undefined) return previous;
      const next = { ...previous };
      delete next[kind];
      return next;
    });
  };

  /** 「试听」：未配置时按钮已禁用，这里再兜一层。 */
  const onPreview = async (kind) => {
    const current = config.kinds[kind];
    setKindError(kind, '');
    if (!current.src.trim()) {
      setKindError(kind, tt('previewEmpty'));
      return;
    }
    if (!audioEngine || typeof audioEngine.preview !== 'function') {
      setKindError(kind, tt('previewUnsupported'));
      return;
    }
    try {
      const played = await audioEngine.preview(kind, {
        src: current.src,
        source: current.source,
        volume: current.volume,
      });
      if (played === false) {
        setKindError(kind, tt('previewFailed'));
      }
    } catch (error) {
      const reason = previewReason(error);
      setKindError(
        kind,
        reason ? tt('previewFailedReason', { message: reason }) : tt('previewFailed'),
      );
    }
  };

  /** 「清除」：清空音源（保留音量设置）。 */
  const onClear = (kind) => {
    dropDraft(kind);
    setKindError(kind, '');
    writeKind(kind, { src: '', source: 'url' });
  };

  return (
    <div style={styles.panel}>
      <p style={styles.hint}>
        {tt('formatHint')}
      </p>

      <section style={styles.card}>
        <label style={styles.toggleRow}>
          <input
            type="checkbox"
            style={styles.checkbox}
            checked={config.enabled}
            onChange={(event) => updateConfig({ enabled: event.target.checked })}
          />
          <span style={styles.kindLabel}>{tt('enabled')}</span>
        </label>
        <label style={styles.toggleRow}>
          <input
            type="checkbox"
            style={styles.checkbox}
            checked={config.backgroundSessions}
            onChange={(event) => updateConfig({ backgroundSessions: event.target.checked })}
          />
          <span>{tt('backgroundSessions')}</span>
        </label>
        <p style={styles.hint}>{tt('backgroundSessionsHint')}</p>
        {config.enabled ? null : <p style={styles.hint}>{tt('enabledHint')}</p>}
      </section>

      {KIND_ORDER.map((kind) => {
        const current = config.kinds[kind];
        const display = drafts[kind] !== undefined ? drafts[kind] : current.src;
        const configured = current.src.trim().length > 0;
        const error = errors[kind] || '';
        const percent = Math.round(current.volume * 100);
        // 只服务于「完成」卡片：优先显示输入草稿，否则显示 store 里的规范值。
        const completionDisplay =
          completionDraft !== undefined ? completionDraft : String(config.completionMinSeconds);

        return (
          <section key={kind} style={styles.card}>
            <div style={styles.cardHead}>
              <span style={styles.kindLabel}>{tt(`kind_${kind}_label`)}</span>
              <span style={styles.hint}>{tt(`kind_${kind}_hint`)}</span>
            </div>

            <div style={styles.row}>
              <input
                type="text"
                style={styles.input}
                value={display}
                spellCheck={false}
                placeholder={tt('srcPlaceholder')}
                aria-label={tt(`kind_${kind}_label`)}
                onChange={(event) => onSrcChange(kind, event.target.value)}
              />
            </div>

            <div style={styles.row}>
              <label style={styles.volumeLabel}>
                {tt('volume')}
                <input
                  type="range"
                  style={styles.slider}
                  min="0"
                  max="100"
                  step="1"
                  value={percent}
                  onChange={(event) => onVolumeChange(kind, event.target.value)}
                />
              </label>
              <span style={styles.volumeValue}>{percent}%</span>
              <span style={styles.spacer} />
              <button type="button" style={styles.button} disabled={!configured} onClick={() => onPreview(kind)}>
                {tt('preview')}
              </button>
              <button type="button" style={styles.button} disabled={!configured} onClick={() => onClear(kind)}>
                {tt('clear')}
              </button>
            </div>

            {kind === 'completed' ? (
              <div style={styles.completionMin}>
                <div style={styles.row}>
                  <label style={styles.volumeLabel} htmlFor="dsh-chime-completion-min">
                    {tt('completionMinLabel')}
                  </label>
                  <input
                    id="dsh-chime-completion-min"
                    type="number"
                    style={styles.numberInput}
                    min="0"
                    max="3600"
                    step="1"
                    inputMode="numeric"
                    value={completionDisplay}
                    aria-label={tt('completionMinLabel')}
                    onChange={(event) => onCompletionMinChange(event.target.value)}
                    onBlur={onCompletionMinBlur}
                  />
                  <span style={styles.hint}>{tt('completionMinUnit')}</span>
                </div>
                <p style={styles.hint}>{tt('completionMinHint')}</p>
              </div>
            ) : null}

            {error ? <p style={styles.error}>{error}</p> : null}
          </section>
        );
      })}

      <p style={styles.hint}>
        {tt('storageHint')}
      </p>
    </div>
  );
}

/**
 * 卡片摘要（`view === 'summary'`）：一行状态 + 一行配置计数。
 *
 * @param {object} props
 * @param {(key: string) => string} [props.t] locale 翻译函数，缺失用中文兜底
 * @param {{ getSnapshot: Function, subscribe: Function }} [props.configStore]
 * @returns {import('react').ReactElement}
 */
export function ChimeSummary(props) {
  const { t, configStore } = props || {};
  const tt = useTranslator(t);
  const config = useConfigSnapshot(configStore);

  const total = KIND_ORDER.length;
  const configured = KIND_ORDER.filter((kind) => config.kinds[kind].src.trim().length > 0).length;
  const countText = tt('summaryCount', { total, configured });

  return (
    <div style={styles.summary}>
      <span>
        {config.enabled ? tt('summaryEnabled') : tt('summaryDisabled')}
        <span style={styles.summaryMuted}>
          {' · '}
          {config.backgroundSessions ? tt('summaryBackgroundOn') : tt('summaryBackgroundOff')}
        </span>
      </span>
      <span style={styles.summaryMuted}>{countText}</span>
    </div>
  );
}
