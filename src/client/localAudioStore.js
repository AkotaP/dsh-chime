/**
 * dsh-chime 本地音频存储：**浏览器原生文件选择 + IndexedDB**。
 *
 * 为什么需要它（决定性限制）：`<input type="file">` 的 `File` 对象只有 `name`，
 * **没有完整路径**，所以"选文件拿到路径"不可能实现。用户选中的音频字节必须由
 * 浏览器自己保存——用 IndexedDB（不是 `localStorage`：后者是字符串存储且有 ~5MB
 * 配额，音频很容易超）。
 *
 * 数据形状：库名 `dsh-chime-audio`，object store `files`，`keyPath: 'kind'`——
 * 一个音效（{@link ChimeKind}）一个文件，重复保存即覆盖写：
 *
 * ```js
 * { kind: 'approval', blob: Blob, name: 'ding.mp3', type: 'audio/mpeg', size: 12345, savedAt: 1730000000000 }
 * ```
 *
 * objectURL 缓存（本模块的核心设计）：
 * - `URL.createObjectURL` 是**同步** API，但读 IndexedDB 是异步的；而消费方
 *   `assets.js` 的 `toPlayableUrl` 必须是同步纯函数（播放引擎同步解析音源）。
 *   所以 {@link getLocalAudioUrl} 设计成**同步的缓存查询**：
 *   - 命中缓存 → 直接返回；
 *   - 未命中 → 返回 `null`，同时**发起一次后台水合**（读库 → 建 objectURL → 写缓存），
 *     下一次查询即可命中。
 * - 为了让"刷新页面后的第一次播放"也能命中，模块导入时会（支持 IndexedDB 时）
 *   预热一次（{@link warmLocalAudioUrls}）；`putLocalAudio` 成功后也用刚拿到的
 *   Blob 立即建 URL，覆盖旧的并 `revokeObjectURL` 掉旧 URL，避免内存泄漏。
 *
 * 降级策略（**绝不让未捕获的 rejection 冒泡**）：
 * - `putLocalAudio`：失败**抛出**带原因的中文 `Error`（UI 要展示，不能静默）；
 * - `getLocalAudio` / `listLocalAudio`：失败返回 `null` / `{}`；
 * - `getLocalAudioUrl`：失败返回 `null`；
 * - `removeLocalAudio`：失败**不抛错**，返回 `false`；
 * - `warmLocalAudioUrls`：失败返回 `null`；所有后台任务都挂了 `catch`。
 *
 * 纯 ESM + JSDoc，零新依赖；Node（无 `indexedDB`）与浏览器均可安全导入。
 *
 * @module dsh-chime/localAudioStore
 */

/** IndexedDB 库名。 */
export const LOCAL_AUDIO_DB_NAME = 'dsh-chime-audio';

/** object store 名（`keyPath: 'kind'`，一个音效一个文件）。 */
export const LOCAL_AUDIO_STORE_NAME = 'files';

/** 库结构版本：首次创建 store 用。 */
const DB_VERSION = 1;

/** 本模块抛出的错误统一用这个名字，便于上游识别"已带可读原因"。 */
const ERROR_NAME = 'ChimeLocalAudioError';

/** 操作前缀（面向用户的中文文案）。 */
const PUT_FAILED = '保存本地音频失败';
const READ_FAILED = '读取本地音频失败';
const REMOVE_FAILED = '删除本地音频失败';

/** 存储本身不可用（与具体操作无关，便于被各操作包上自己的前缀）。 */
const STORE_UNAVAILABLE = '本地音频存储不可用';

/** MIME → 扩展名：文件名缺失时给 `src` 兜一个可展示的名字。 */
const TYPE_EXTENSIONS = Object.freeze({
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/webm': '.webm',
});

/**
 * 音效种类（与 `config.js` 的 `CHIME_KINDS` 一致）。
 * @typedef {'approval' | 'question' | 'interrupted' | 'completed'} ChimeKind
 */

/**
 * `getLocalAudio` 的返回值。
 * @typedef {object} LocalAudio
 * @property {Blob} blob 音频字节（可直接 `URL.createObjectURL`）。
 * @property {string} name 原始文件名（没有时为 `audio.<ext>` 兜底）。
 * @property {string} type MIME 类型（未知时为空串）。
 * @property {number} size 字节数。
 */

/**
 * `putLocalAudio` 的返回值（不含 Blob，便于直接塞进 UI 状态）。
 * @typedef {object} LocalAudioSummary
 * @property {string} name 文件名。
 * @property {number} size 字节数。
 */

/** 当前打开的 IndexedDB 连接（惰性）。 @type {IDBDatabase|null} */
let connection = null;

/** 正在打开的连接（并发去重）。 @type {Promise<IDBDatabase>|null} */
let opening = null;

/** 释放世代号：`releaseAll()` 后旧的后台水合不得再写回缓存。 */
let generation = 0;

/** kind → objectURL 缓存。 @type {Map<string, string>} */
const objectUrls = new Map();

/** kind → 进行中的后台水合。 @type {Map<string, Promise<string|null>>} */
const hydrations = new Map();

/** 已知库里没有内容的 kind（避免每次查询都发起水合）。 @type {Set<string>} */
const absentKinds = new Set();

// ------------------------------------------------------------------ 公开 API

/**
 * 当前环境是否支持 IndexedDB。
 *
 * 只做能力探测，**不打开数据库、不抛错**：真正的可用性（隐私模式、配额、
 * 升级失败）由各 API 的降级路径兜住。
 *
 * @returns {boolean} `indexedDB` 存在且 `open` 可调用时为 `true`。
 */
export function isLocalAudioSupported() {
  try {
    const factory = globalThis.indexedDB;
    return factory !== null && factory !== undefined && typeof factory.open === 'function';
  } catch {
    // 某些沙箱里访问全局属性本身就抛 SecurityError。
    return false;
  }
}

/**
 * 保存（或覆盖）某个音效的本地音频。
 *
 * @param {unknown} kind 音效种类（非空字符串）。
 * @param {unknown} file `<input type="file">` 给出的 `File`，或任意 `Blob`。
 * @returns {Promise<LocalAudioSummary>} 保存后的文件名与大小。
 * @throws {Error} `kind` 非法、`file` 不是 Blob、环境不支持 IndexedDB，
 *   或事务失败时抛出**带可读中文原因**的 `Error`（底层原因挂在 `cause` 上）。
 */
export async function putLocalAudio(kind, file) {
  const key = normalizeKind(kind);
  if (key === '') {
    throw localAudioError(`${PUT_FAILED}：音效种类无效`);
  }
  if (!isBlobLike(file)) {
    throw localAudioError(`${PUT_FAILED}：没有拿到有效的音频文件`);
  }
  if (!isLocalAudioSupported()) {
    throw localAudioError(`${PUT_FAILED}：当前环境不支持 IndexedDB（可能处于隐私模式或禁用了本地存储）`);
  }

  const record = {
    kind: key,
    blob: file,
    name: nameOf(file),
    type: typeof file.type === 'string' ? file.type : '',
    size: typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0,
    savedAt: Date.now(),
  };
  const savedGeneration = generation;

  await transact('readwrite', PUT_FAILED, (store, setValue, fail) => {
    let request;
    try {
      request = store.put(record);
    } catch (error) {
      fail(localAudioError(`${PUT_FAILED}：${key}`, error));
      return;
    }
    if (!request) {
      fail(localAudioError(`${PUT_FAILED}：${key}（存储未接受写入请求）`));
      return;
    }
    request.onsuccess = () => setValue(true);
    request.onerror = () => fail(localAudioError(`${PUT_FAILED}：${key}`, request.error));
  });

  absentKinds.delete(key);
  if (savedGeneration === generation) cacheObjectUrl(key, file);
  return { name: record.name, size: record.size };
}

/**
 * 读取某个音效的本地音频。
 *
 * @param {unknown} kind 音效种类。
 * @returns {Promise<LocalAudio|null>} 记录；没有存过、数据损坏或读取失败时为 `null`。
 */
export async function getLocalAudio(kind) {
  const key = normalizeKind(kind);
  if (key === '') return null;
  try {
    const record = await transact('readonly', READ_FAILED, (store, setValue, fail) => {
      let request;
      try {
        request = store.get(key);
      } catch (error) {
        fail(localAudioError(`${READ_FAILED}：${key}`, error));
        return;
      }
      if (!request) {
        fail(localAudioError(`${READ_FAILED}：${key}（存储未返回读取请求）`));
        return;
      }
      request.onsuccess = () => setValue(normalizeRecord(request.result));
      request.onerror = () => fail(localAudioError(`${READ_FAILED}：${key}`, request.error));
    });
    return record || null;
  } catch {
    // 降级：读取失败对外表现就是"没存过"。
    return null;
  }
}

/**
 * 删除某个音效的本地音频。
 *
 * 失败**不抛错**（返回 `false`）：清除按钮不该因为存储异常把配置页搞崩。
 * 无论数据库删除是否成功，都会先 revoke 并清掉该 kind 的 objectURL 缓存，
 * 让"清除"立刻对播放生效。
 *
 * @param {unknown} kind 音效种类。
 * @returns {Promise<boolean>} 库里原本确实有记录且删除成功时为 `true`。
 */
export async function removeLocalAudio(kind) {
  const key = normalizeKind(kind);
  if (key === '') return false;

  releaseObjectUrl(key);
  absentKinds.add(key);

  try {
    const existed = await transact('readwrite', REMOVE_FAILED, (store, setValue, fail) => {
      let probe;
      try {
        probe = store.get(key);
      } catch (error) {
        fail(localAudioError(`${REMOVE_FAILED}：${key}`, error));
        return;
      }
      if (!probe) {
        fail(localAudioError(`${REMOVE_FAILED}：${key}（存储未返回读取请求）`));
        return;
      }
      probe.onsuccess = () => {
        const found = probe.result !== undefined && probe.result !== null;
        setValue(found);
        try {
          const deletion = store.delete(key);
          if (deletion) {
            deletion.onerror = () => fail(localAudioError(`${REMOVE_FAILED}：${key}`, deletion.error));
          }
        } catch (error) {
          fail(localAudioError(`${REMOVE_FAILED}：${key}`, error));
        }
      };
      probe.onerror = () => fail(localAudioError(`${REMOVE_FAILED}：${key}`, probe.error));
    });
    return existed === true;
  } catch {
    return false;
  }
}

/**
 * 列出已保存的本地音频（不含 Blob，设置页展示用）。
 *
 * @returns {Promise<Record<string, { name: string, size: number }>>} kind → 摘要；
 *   没有内容或读取失败时为 `{}`（空对象）。
 */
export async function listLocalAudio() {
  try {
    const records = await transact('readonly', READ_FAILED, (store, setValue, fail) => {
      readAllRecords(store, setValue, fail);
    });
    /** @type {Record<string, { name: string, size: number }>} */
    const summary = {};
    const rows = Array.isArray(records) ? records : [];
    for (const row of rows) {
      const key = normalizeKind(row && row.kind);
      if (key === '' || key === '__proto__') continue;
      const record = normalizeRecord(row);
      if (!record) continue;
      summary[key] = { name: record.name, size: record.size };
    }
    return summary;
  } catch {
    return {};
  }
}

/**
 * 同步取某个音效的 objectURL。**消费方 `toPlayableUrl` 的唯一入口。**
 *
 * 命中缓存直接返回；未命中返回 `null` 并**在后台发起一次水合**（读库 → 建 URL），
 * 下次调用即可命中。`IndexedDB` 不可用 / 库里没有 / 水合失败一律返回 `null`，
 * **永不抛错、永不产生未处理拒绝**。
 *
 * @param {unknown} kind 音效种类。
 * @returns {string|null} 可播放的 `blob:` URL；未就绪时为 `null`。
 */
export function getLocalAudioUrl(kind) {
  try {
    const key = normalizeKind(kind);
    if (key === '') return null;
    const cached = objectUrls.get(key);
    if (typeof cached === 'string' && cached !== '') return cached;
    if (!absentKinds.has(key) && !hydrations.has(key) && isLocalAudioSupported()) {
      void hydrate(key);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 预热：把库里所有音频读出来并建立 objectURL 缓存（幂等、可重复调用）。
 *
 * 模块导入时会自动调用一次，`putLocalAudio` 之后无需调用。设置页若要"进入页面
 * 就绪"，也可以显式 `await` 它。
 *
 * @returns {Promise<Record<string, string>|null>} kind → objectURL；失败为 `null`。
 */
export async function warmLocalAudioUrls() {
  try {
    if (!isLocalAudioSupported()) return null;
    const records = await transact('readonly', READ_FAILED, (store, setValue, fail) => {
      readAllRecords(store, setValue, fail);
    });
    if (!Array.isArray(records)) return null;
    /** @type {Record<string, string>} */
    const warmed = {};
    for (const row of records) {
      const key = normalizeKind(row && row.kind);
      if (key === '') continue;
      const record = normalizeRecord(row);
      if (!record) continue;
      const url = cacheObjectUrl(key, record.blob);
      if (url) warmed[key] = url;
    }
    return warmed;
  } catch {
    return null;
  }
}

/**
 * 释放全部资源：revoke 所有 objectURL、清空缓存、关闭连接。**幂等**。
 *
 * 在插件 `dispose()` / HMR 时调用。释放后模块仍可继续使用（连接会按需重开），
 * 但释放前发起、释放后才完成的后台水合不会再写回缓存（世代号保护）。
 *
 * @returns {void}
 */
export function releaseAll() {
  generation += 1;

  for (const url of objectUrls.values()) revokeObjectUrl(url);
  objectUrls.clear();
  hydrations.clear();
  absentKinds.clear();

  const db = connection;
  connection = null;
  opening = null;
  if (db) {
    try {
      db.close();
    } catch {
      // 连接可能已经被浏览器关掉，忽略。
    }
  }
}

// -------------------------------------------------------------- objectURL 缓存

/**
 * 把 Blob 建成 objectURL 并写进缓存；同一 kind 的旧 URL 一定被 revoke。
 *
 * @param {string} key 已归一化的 kind。
 * @param {unknown} blob 音频字节。
 * @returns {string|null} 新 URL；环境不支持或创建失败时为 `null`（旧 URL 仍已释放）。
 */
function cacheObjectUrl(key, blob) {
  releaseObjectUrl(key);
  if (!canCreateObjectUrl() || !isBlobLike(blob)) return null;
  let url = null;
  try {
    url = globalThis.URL.createObjectURL(blob);
  } catch {
    return null;
  }
  if (typeof url !== 'string' || url === '') return null;
  objectUrls.set(key, url);
  absentKinds.delete(key);
  return url;
}

/**
 * 释放某个 kind 的 objectURL 缓存条目。
 *
 * @param {string} key 已归一化的 kind。
 * @returns {void}
 */
function releaseObjectUrl(key) {
  const url = objectUrls.get(key);
  if (url === undefined) return;
  objectUrls.delete(key);
  revokeObjectUrl(url);
}

/**
 * `URL.createObjectURL` 是否可用。
 *
 * @returns {boolean} 可用则为 `true`。
 */
function canCreateObjectUrl() {
  try {
    return typeof globalThis.URL === 'function' && typeof globalThis.URL.createObjectURL === 'function';
  } catch {
    return false;
  }
}

/**
 * 尽力 revoke 一个 objectURL（绝不让清理失败冒泡）。
 *
 * @param {unknown} url objectURL。
 * @returns {void}
 */
function revokeObjectUrl(url) {
  try {
    if (typeof url !== 'string' || url === '') return;
    const urlApi = globalThis.URL;
    if (!urlApi || typeof urlApi.revokeObjectURL !== 'function') return;
    urlApi.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

/**
 * 后台水合一个 kind：读库 → 建 URL → 写缓存。并发去重、永不 reject。
 *
 * @param {string} key 已归一化的 kind。
 * @returns {Promise<string|null>} objectURL 或 `null`。
 */
function hydrate(key) {
  const running = hydrations.get(key);
  if (running) return running;

  const startedAt = generation;
  const task = (async () => {
    const record = await getLocalAudio(key);
    if (startedAt !== generation) return null; // 已被 releaseAll 释放，别写回缓存。
    if (!record) {
      absentKinds.add(key);
      return null;
    }
    return cacheObjectUrl(key, record.blob);
  })();

  const guarded = task
    .catch(() => null)
    .then((url) => {
      if (hydrations.get(key) === guarded) hydrations.delete(key);
      return url;
    });
  hydrations.set(key, guarded);
  return guarded;
}

// ------------------------------------------------------------- IndexedDB 底座

/**
 * 惰性打开（并缓存）数据库连接。
 *
 * @returns {Promise<IDBDatabase>} 数据库连接。
 */
function openDatabase() {
  if (connection) return Promise.resolve(connection);
  if (opening) return opening;

  const startedAt = generation;
  const task = new Promise((resolve, reject) => {
    if (!isLocalAudioSupported()) {
      reject(
        localAudioError(
          `${STORE_UNAVAILABLE}：当前环境不支持 IndexedDB（可能处于隐私模式或禁用了本地存储）`,
        ),
      );
      return;
    }

    let request;
    try {
      request = globalThis.indexedDB.open(LOCAL_AUDIO_DB_NAME, DB_VERSION);
    } catch (error) {
      reject(localAudioError(`${STORE_UNAVAILABLE}：无法打开 IndexedDB`, error));
      return;
    }
    if (!request || typeof request !== 'object') {
      reject(localAudioError(`${STORE_UNAVAILABLE}：IndexedDB 未返回打开请求`));
      return;
    }

    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (db && db.objectStoreNames && !db.objectStoreNames.contains(LOCAL_AUDIO_STORE_NAME)) {
          db.createObjectStore(LOCAL_AUDIO_STORE_NAME, { keyPath: 'kind' });
        }
      } catch {
        // 升级失败会走 onerror / onabort，统一在那里转成可读错误。
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      if (!db) {
        reject(localAudioError(`${STORE_UNAVAILABLE}：IndexedDB 未返回数据库连接`));
        return;
      }
      if (startedAt !== generation) {
        try {
          db.close();
        } catch {
          // ignore
        }
        reject(localAudioError(`${STORE_UNAVAILABLE}：本地音频存储已释放`));
        return;
      }
      connection = db;
      try {
        // 别的标签页要升级库结构时主动让路，避免把对方 block 死。
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // ignore
          }
          if (connection === db) connection = null;
        };
      } catch {
        // ignore
      }
      resolve(db);
    };

    request.onerror = () =>
      reject(localAudioError(`${STORE_UNAVAILABLE}：打开 IndexedDB 失败`, request.error));
    // onblocked 不 reject：旧连接可能很快释放，请求仍有机会成功。
  });

  opening = task.then(
    (db) => {
      opening = null;
      return db;
    },
    (error) => {
      opening = null;
      throw error;
    },
  );
  return opening;
}

/**
 * 在一个事务里同步地发起请求，事务提交后 resolve。
 *
 * `work(store, setValue, fail)` 必须是**同步**的：只在 `request.onsuccess` 里
 * 调用 `setValue(value)`，值会在 `tx.oncomplete` 时 resolve——这样请求成功但事务
 * 回滚（配额、中断）也会正确报错。
 *
 * @param {IDBTransactionMode} mode 事务模式。
 * @param {string} failureMessage 失败文案前缀。
 * @param {(store: IDBObjectStore, setValue: (value: unknown) => void, fail: (error: unknown) => void) => void} work 同步工作体。
 * @returns {Promise<unknown>} `setValue` 写入的值。
 */
function transact(mode, failureMessage, work) {
  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {unknown} */
    let value;

    /** @param {unknown} error */
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(asLocalAudioError(error, failureMessage));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openDatabase().then(
      (db) => {
        let tx;
        try {
          tx = db.transaction(LOCAL_AUDIO_STORE_NAME, mode);
        } catch (error) {
          fail(localAudioError(`${failureMessage}：无法开始存储事务`, error));
          return;
        }

        tx.oncomplete = succeed;
        tx.onabort = () => fail(localAudioError(`${failureMessage}：存储事务被中断`, tx.error));
        tx.onerror = () => fail(localAudioError(`${failureMessage}：存储事务失败`, tx.error));

        let store;
        try {
          store = tx.objectStore(LOCAL_AUDIO_STORE_NAME);
        } catch (error) {
          fail(localAudioError(`${failureMessage}：无法访问存储`, error));
          return;
        }

        try {
          work(store, (v) => {
            value = v;
          }, fail);
        } catch (error) {
          fail(localAudioError(`${failureMessage}：存储操作失败`, error));
          try {
            tx.abort();
          } catch {
            // 事务可能已经中止，忽略。
          }
        }
      },
      (error) => fail(localAudioError(`${failureMessage}：${detailOf(error)}`, error)),
    );
  });
}

/**
 * 读出 store 里全部记录：优先 `getAll()`，没有就退回游标遍历。
 *
 * @param {IDBObjectStore} store object store。
 * @param {(value: unknown) => void} setValue 事务结果写入器。
 * @param {(error: unknown) => void} fail 失败回调。
 * @returns {void}
 */
function readAllRecords(store, setValue, fail) {
  let all = null;
  try {
    if (typeof store.getAll === 'function') all = store.getAll();
  } catch {
    all = null;
  }
  if (all) {
    all.onsuccess = () => setValue(Array.isArray(all.result) ? all.result : []);
    all.onerror = () => fail(localAudioError(`${READ_FAILED}：存储返回错误`, all.error));
    return;
  }

  let cursorRequest;
  try {
    cursorRequest = store.openCursor();
  } catch (error) {
    fail(localAudioError(`${READ_FAILED}：无法遍历存储`, error));
    return;
  }
  if (!cursorRequest) {
    fail(localAudioError(`${READ_FAILED}：存储未返回游标`));
    return;
  }

  /** @type {unknown[]} */
  const rows = [];
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      setValue(rows);
      return;
    }
    rows.push(cursor.value);
    try {
      cursor.continue();
    } catch (error) {
      fail(localAudioError(`${READ_FAILED}：遍历存储失败`, error));
    }
  };
  cursorRequest.onerror = () => fail(localAudioError(`${READ_FAILED}：遍历存储失败`, cursorRequest.error));
}

// -------------------------------------------------------------------- 小工具

/**
 * 归一化 kind：非字符串或纯空白 → `''`（调用方一律视为"无 kind"）。
 *
 * @param {unknown} kind 原始 kind。
 * @returns {string} 去除首尾空白的 kind。
 */
function normalizeKind(kind) {
  return typeof kind === 'string' ? kind.trim() : '';
}

/**
 * 判断是否为 Blob/File（鸭子类型，Node 桩与真实 `File` 都适用）。
 *
 * @param {unknown} value 待判断值。
 * @returns {boolean} 像 Blob 则为 `true`。
 */
function isBlobLike(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.size === 'number' &&
    typeof value.type === 'string'
  );
}

/**
 * 取可展示的文件名：优先 Blob 的 `name`，缺失时按 MIME 兜底。
 *
 * @param {unknown} value File|Blob。
 * @returns {string} 文件名（永不为空）。
 */
function nameOf(value) {
  if (value && typeof value.name === 'string' && value.name.trim() !== '') return value.name;
  const type = value && typeof value.type === 'string' ? value.type : '';
  return `audio${TYPE_EXTENSIONS[type] || ''}`;
}

/**
 * 把库里的原始记录整形成 {@link LocalAudio}；损坏记录返回 `null`。
 *
 * @param {unknown} value 原始记录。
 * @returns {LocalAudio|null} 归一化结果。
 */
function normalizeRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const blob = value.blob;
  if (!isBlobLike(blob)) return null;
  const size =
    typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : blob.size;
  return {
    blob: /** @type {Blob} */ (blob),
    name: nameOf(value),
    type: typeof value.type === 'string' ? value.type : typeof blob.type === 'string' ? blob.type : '',
    size: typeof size === 'number' && Number.isFinite(size) ? size : 0,
  };
}

/**
 * 构造带可读原因的错误。
 *
 * @param {string} message 中文原因。
 * @param {unknown} [cause] 底层原因。
 * @returns {Error} 名字为 `ChimeLocalAudioError` 的错误。
 */
function localAudioError(message, cause) {
  let error;
  try {
    error = cause === undefined ? new Error(message) : new Error(message, { cause });
  } catch {
    error = new Error(message);
  }
  error.name = ERROR_NAME;
  if (cause !== undefined) {
    try {
      if (error.cause === undefined) error.cause = cause;
    } catch {
      // ignore
    }
  }
  return error;
}

/**
 * 保证最终抛出的是带可读原因的错误（本模块自己造的错直接透传）。
 *
 * @param {unknown} error 原始抛出物。
 * @param {string} failureMessage 失败文案前缀。
 * @returns {Error} 可读错误。
 */
function asLocalAudioError(error, failureMessage) {
  if (error instanceof Error && error.name === ERROR_NAME) return error;
  return localAudioError(failureMessage, error);
}

/**
 * 提炼错误细节文本（截断到 160 字）。
 *
 * @param {unknown} error 原始抛出物。
 * @returns {string} 细节文本。
 */
function detailOf(error) {
  if (error === undefined || error === null) return '未知原因';
  let text;
  try {
    text = error instanceof Error ? error.message || error.name : String(error);
  } catch {
    text = '未知原因';
  }
  if (typeof text !== 'string' || text === '') return '未知原因';
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

// ------------------------------------------------------------------ 自动预热

// objectURL 缓存是同步 API，消费方 `toPlayableUrl` 也是同步的，所以必须**提前**
// 把 IndexedDB 里的 Blob 读出来建成 URL——否则刷新页面后的第一次播放拿不到 URL。
// 模块导入时预热一次：后台任务内部全程 catch，不会产生未处理拒绝；不支持
// IndexedDB 的环境（如 Node）直接跳过。
if (isLocalAudioSupported()) {
  void warmLocalAudioUrls().catch(() => null);
}
