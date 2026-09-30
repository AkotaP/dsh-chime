/**
 * dsh-chime host 路由自测（无网络、无真实服务器）。
 *
 * 用假的 `ctx.webServer.register` 捕获两条路由，再用假的 `req` / `res`
 * 直接调用 handler，覆盖状态码、响应头、Content-Type、Range、排序与截断。
 *
 * 运行：`node tools/verify-host-routes.mjs`
 *
 * @module dsh-chime/tools/verify-host-routes
 */

import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apply, inject } from '../src/host/index.js';

let pass = 0;
let fail = 0;

/**
 * 记一条断言。
 *
 * @param {string} name 断言名。
 * @param {boolean} condition 是否通过。
 * @param {string} [extra] 失败时的附加信息。
 */
function ok(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  console.log(`FAIL: ${name} ${extra}`);
}

/** 捕获到的路由表。 */
const routes = new Map();
/** `ctx.effect` 返回的 cleanup 列表。 */
const cleanups = [];
/** 已释放的路由路径。 */
const disposed = [];
/** 捕获的告警。 */
const warnings = [];

/**
 * 构造假 Host Context。
 *
 * @param {{ register?: Function, omitWebServer?: boolean, effect?: boolean }} [options] 选项。
 * @returns {object} 假 ctx。
 */
function makeCtx(options = {}) {
  const webServer = options.omitWebServer
    ? undefined
    : {
        register:
          options.register ??
          ((route) => {
            routes.set(route.path, route);
            return () => {
              disposed.push(route.path);
              routes.delete(route.path);
            };
          }),
      };
  return {
    logger: { warn: (message) => warnings.push(String(message)) },
    ...(options.effect === false
      ? {}
      : {
          effect: (callback) => {
            cleanups.push(callback());
          },
        }),
    ...(webServer === undefined ? {} : { webServer }),
  };
}

/** 假响应：记录 writeHead / end。 */
class FakeRes {
  constructor() {
    this.status = 0;
    this.headers = {};
    this.body = Buffer.alloc(0);
    this.headersSent = false;
    this.ended = false;
  }

  /**
   * @param {number} status 状态码。
   * @param {Record<string, string>} [headers] 响应头。
   * @returns {FakeRes} this。
   */
  writeHead(status, headers) {
    this.status = status;
    this.headers = { ...(headers ?? {}) };
    this.headersSent = true;
    return this;
  }

  /**
   * @param {unknown} [body] 响应体。
   * @returns {FakeRes} this。
   */
  end(body) {
    if (body !== undefined && body !== null) {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    }
    this.ended = true;
    return this;
  }
}

/**
 * 发一个假请求。
 *
 * @param {object} route 捕获到的路由。
 * @param {{ method?: string, url?: string, headers?: Record<string, unknown>, raw?: boolean }} [request] 请求描述。
 * @returns {Promise<FakeRes>} 假响应。
 */
async function call(route, request = {}) {
  const res = new FakeRes();
  const req = request.raw
    ? {}
    : { method: request.method ?? 'GET', url: request.url ?? '/', headers: request.headers ?? {} };
  await route.handler(req, res);
  return res;
}

/**
 * 拼一条 asset / list 请求 URL。
 *
 * @param {string} base 路由路径。
 * @param {string} pathValue `path` 参数。
 * @param {Record<string, string>} [extra] 其他 query 参数。
 * @returns {string} 请求 URL。
 */
function routeUrl(base, pathValue, extra = {}) {
  const params = new URLSearchParams({ path: pathValue, ...extra });
  return `${base}?${params.toString()}`;
}

/** 音频夹具字节（非真实 RIFF，仅用于字节比对）。 */
const WAV_BYTES = Buffer.from(`RIFF-${'x'.repeat(120)}`, 'utf8');

/**
 * 并发写一批空文件（带分块，避免一次打开过多句柄）。
 *
 * @param {string} dir 目标目录。
 * @param {string[]} names 文件名列表。
 * @returns {Promise<void>} 无返回值。
 */
async function createManyFiles(dir, names) {
  const chunkSize = 200;
  for (let index = 0; index < names.length; index += chunkSize) {
    const chunk = names.slice(index, index + chunkSize);
    await Promise.all(
      chunk.map(async (name) => {
        const handle = await open(join(dir, name), 'w');
        await handle.close();
      }),
    );
  }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-chime-routes-'));
try {
  // ---------- 夹具 ----------
  const media = join(root, 'media');
  await mkdir(media, { recursive: true });
  await writeFile(join(media, 'alpha.wav'), WAV_BYTES);
  await writeFile(join(media, 'Beta.MP3'), Buffer.from([1, 2, 3, 4, 5]));
  await writeFile(join(media, 'notes.txt'), Buffer.from('ignore me', 'utf8'));
  await writeFile(join(media, 'empty.wav'), Buffer.alloc(0));
  await writeFile(join(media, 'my song.wav'), Buffer.from([9, 9, 9], 'utf8'));
  await mkdir(join(media, 'sub'));
  await mkdir(join(media, 'sounds.mp3'));

  // ---------- apply + 路由捕获 ----------
  const ctx = makeCtx();
  apply(ctx);
  const asset = routes.get('/dsh-chime/asset');
  const list = routes.get('/dsh-chime/list');
  ok('inject 声明 webServer', Array.isArray(inject) && inject.join() === 'webServer', JSON.stringify(inject));
  ok('注册了两条路由', routes.size === 2, String(routes.size));
  ok('asset 是 prefix 路由', asset && asset.kind === 'prefix', JSON.stringify(asset && asset.kind));
  ok('list 是 prefix 路由', list && list.kind === 'prefix', JSON.stringify(list && list.kind));
  ok('handler 是函数', typeof asset?.handler === 'function' && typeof list?.handler === 'function');

  // ---------- asset ----------
  const a1 = await call(asset, { url: routeUrl('/dsh-chime/asset', join(media, 'alpha.wav')) });
  ok('asset 200', a1.status === 200, String(a1.status));
  ok('asset Content-Type=audio/wav', a1.headers['Content-Type'] === 'audio/wav', a1.headers['Content-Type']);
  ok('asset Content-Length', a1.headers['Content-Length'] === String(WAV_BYTES.length), a1.headers['Content-Length']);
  ok('asset Cache-Control=no-store', a1.headers['Cache-Control'] === 'no-store');
  ok('asset Accept-Ranges=bytes', a1.headers['Accept-Ranges'] === 'bytes');
  ok('asset body 等于文件字节', a1.body.equals(WAV_BYTES));
  ok('asset 已 end', a1.ended === true);

  const a2 = await call(asset, { url: routeUrl('/dsh-chime/asset', join(media, 'Beta.MP3')) });
  ok('asset 大写扩展名 -> audio/mpeg', a2.status === 200 && a2.headers['Content-Type'] === 'audio/mpeg', `${a2.status} ${a2.headers['Content-Type']}`);
  const a3 = await call(asset, { url: routeUrl('/dsh-chime/asset', join(media, 'notes.txt')) });
  ok('asset 非白名单 -> 400', a3.status === 400, String(a3.status));
  ok('asset 400 是 text/plain', String(a3.headers['Content-Type']).startsWith('text/plain'), a3.headers['Content-Type']);
  const a4 = await call(asset, { url: routeUrl('/dsh-chime/asset', join(media, 'missing.wav')) });
  ok('asset 文件不存在 -> 404', a4.status === 404, String(a4.status));
  const a5 = await call(asset, { url: '/dsh-chime/asset' });
  ok('asset 缺 path -> 400', a5.status === 400, String(a5.status));
  const a6 = await call(asset, { url: routeUrl('/dsh-chime/asset', 'relative.wav') });
  ok('asset 相对路径 -> 400', a6.status === 400, String(a6.status));
  const a7 = await call(asset, { url: routeUrl('/dsh-chime/asset', join(media, 'sounds.mp3')) });
  ok('asset 目录 -> 404', a7.status === 404, String(a7.status));
  const a8 = await call(asset, { url: routeUrl('/dsh-chime/asset', join(media, 'alpha.wav'), { v: '1700000000' }) });
  ok('asset 忽略 v 参数 -> 200', a8.status === 200 && a8.body.equals(WAV_BYTES));
  const a9 = await call(asset, { url: routeUrl('/dsh-chime/asset', join(media, 'my song.wav')) });
  ok('asset 路径含空格（URL 编码）-> 200', a9.status === 200 && a9.body.length === 3, String(a9.status));

  // Range
  const r1 = await call(asset, {
    url: routeUrl('/dsh-chime/asset', join(media, 'alpha.wav')),
    headers: { range: 'bytes=0-3' },
  });
  ok('Range 0-3 -> 206', r1.status === 206, String(r1.status));
  ok('Range Content-Range 正确', r1.headers['Content-Range'] === `bytes 0-3/${WAV_BYTES.length}`, r1.headers['Content-Range']);
  ok('Range Content-Length=4', r1.headers['Content-Length'] === '4', r1.headers['Content-Length']);
  ok('Range body 切片正确', r1.body.length === 4 && r1.body.equals(WAV_BYTES.subarray(0, 4)));
  const r2 = await call(asset, {
    url: routeUrl('/dsh-chime/asset', join(media, 'alpha.wav')),
    headers: { range: 'bytes=4-' },
  });
  ok('Range 4- -> 206 到文件尾', r2.status === 206 && r2.body.equals(WAV_BYTES.subarray(4)), String(r2.status));
  const r3 = await call(asset, {
    url: routeUrl('/dsh-chime/asset', join(media, 'alpha.wav')),
    headers: { range: 'bytes=-4' },
  });
  ok('Range -4 -> 206 最后 4 字节', r3.status === 206 && r3.body.equals(WAV_BYTES.subarray(WAV_BYTES.length - 4)), String(r3.status));
  const r4 = await call(asset, {
    url: routeUrl('/dsh-chime/asset', join(media, 'alpha.wav')),
    headers: { range: 'bytes=999999-' },
  });
  ok('Range 越界 -> 416', r4.status === 416, String(r4.status));
  ok('416 Content-Range=bytes */size', r4.headers['Content-Range'] === `bytes */${WAV_BYTES.length}`, r4.headers['Content-Range']);
  const r5 = await call(asset, {
    url: routeUrl('/dsh-chime/asset', join(media, 'alpha.wav')),
    headers: { range: 'bytes=0-1,3-4' },
  });
  ok('多段 Range -> 退回整文件 200', r5.status === 200 && r5.body.equals(WAV_BYTES), String(r5.status));
  const r6 = await call(asset, {
    url: routeUrl('/dsh-chime/asset', join(media, 'empty.wav')),
    headers: { range: 'bytes=0-' },
  });
  ok('空文件 Range -> 416', r6.status === 416, String(r6.status));
  const r7 = await call(asset, { url: routeUrl('/dsh-chime/asset', join(media, 'empty.wav')) });
  ok('空文件整文件 -> 200 且长度 0', r7.status === 200 && r7.body.length === 0 && r7.headers['Content-Length'] === '0');

  // HEAD / 方法 / 畸形请求
  const h1 = await call(asset, { method: 'HEAD', url: routeUrl('/dsh-chime/asset', join(media, 'alpha.wav')) });
  ok('HEAD -> 200 + Content-Length', h1.status === 200 && h1.headers['Content-Length'] === String(WAV_BYTES.length), String(h1.status));
  ok('HEAD 无 body', h1.body.length === 0);
  const m1 = await call(asset, { method: 'POST', url: routeUrl('/dsh-chime/asset', join(media, 'alpha.wav')) });
  ok('POST -> 405', m1.status === 405, String(m1.status));
  const w1 = await call(asset, { raw: true });
  ok('畸形 req 不抛异常 -> 400', w1.status === 400 && w1.ended === true, String(w1.status));

  // ---------- list ----------
  const l1 = await call(list, { url: routeUrl('/dsh-chime/list', media) });
  ok('list 200', l1.status === 200, String(l1.status));
  ok('list Content-Type=application/json', String(l1.headers['Content-Type']).startsWith('application/json'), l1.headers['Content-Type']);
  const l1body = JSON.parse(l1.body.toString('utf8'));
  ok('list path 是绝对路径', l1body.path === resolve(media), l1body.path);
  ok(
    'list 目录在前 + 名称排序 + 只保留音频文件',
    JSON.stringify(l1body.entries.map((entry) => `${entry.type}:${entry.name}`)) ===
      JSON.stringify(['directory:sounds.mp3', 'directory:sub', 'file:Beta.MP3', 'file:alpha.wav', 'file:empty.wav', 'file:my song.wav']),
    JSON.stringify(l1body.entries.map((entry) => `${entry.type}:${entry.name}`)),
  );
  ok('list 排除非音频文件', l1body.entries.every((entry) => entry.name !== 'notes.txt'));
  ok('list entry.path 拼接正确', l1body.entries[0].path === join(resolve(media), 'sounds.mp3'), l1body.entries[0].path);
  ok('list truncated=false', l1body.truncated === false);

  const l2 = await call(list, { url: routeUrl('/dsh-chime/list', join(root, 'nope')) });
  ok('list 目录不存在 -> 404', l2.status === 404, String(l2.status));
  ok('list 404 是 JSON { error }', typeof JSON.parse(l2.body.toString('utf8')).error === 'string');
  const l3 = await call(list, { url: routeUrl('/dsh-chime/list', join(media, 'alpha.wav')) });
  ok('list 指向文件 -> 404', l3.status === 404, String(l3.status));
  const l4 = await call(list, { url: '/dsh-chime/list' });
  ok('list 缺 path -> 400', l4.status === 400, String(l4.status));
  const l5 = await call(list, { url: routeUrl('/dsh-chime/list', 'relative/dir') });
  ok('list 相对路径 -> 400', l5.status === 400, String(l5.status));
  const l6 = await call(list, { method: 'POST', url: routeUrl('/dsh-chime/list', media) });
  ok('list POST -> 405', l6.status === 405, String(l6.status));
  const l7 = await call(list, { raw: true });
  ok('list 畸形 req -> 400', l7.status === 400, String(l7.status));

  // 截断
  const big = join(root, 'big');
  await mkdir(big, { recursive: true });
  const many = Array.from({ length: 2001 }, (_, index) => `f${String(index).padStart(4, '0')}.wav`);
  await createManyFiles(big, many);
  const l8 = await call(list, { url: routeUrl('/dsh-chime/list', big) });
  const l8body = JSON.parse(l8.body.toString('utf8'));
  ok('list 2001 条 -> 截断到 2000', l8body.entries.length === 2000, String(l8body.entries.length));
  ok('list truncated=true', l8body.truncated === true);
  ok('list 截断后仍有序', l8body.entries[0].name === 'f0000.wav' && l8body.entries[1999].name === 'f1999.wav', l8body.entries[1999]?.name);

  // ---------- 真实目录冒烟（只读，存在才跑） ----------
  const sounds = 'C:\\Users\\timat\\.claude\\sounds-hooks\\sounds';
  try {
    const sl = await call(list, { url: routeUrl('/dsh-chime/list', sounds) });
    if (sl.status !== 200) throw new Error(`status ${sl.status}`);
    const sbody = JSON.parse(sl.body.toString('utf8'));
    ok('真实 sounds 目录：只出 wav 文件', sbody.entries.length === 7 && sbody.entries.every((entry) => entry.type === 'file' && entry.name.endsWith('.wav')), JSON.stringify(sbody.entries.map((entry) => entry.name)));
    const sa = await call(asset, { url: routeUrl('/dsh-chime/asset', join(sounds, 'elicitation.wav')) });
    ok('真实 wav 可整文件播放', sa.status === 200 && sa.headers['Content-Type'] === 'audio/wav' && sa.body.length === 85122, `${sa.status} ${sa.body.length}`);
    ok('真实 wav Range 可播', (await call(asset, { url: routeUrl('/dsh-chime/asset', join(sounds, 'elicitation.wav')), headers: { range: 'bytes=0-99' } })).status === 206);
  } catch (error) {
    console.log(`SKIP: 真实 sounds 目录不可用（${error instanceof Error ? error.message : String(error)}）`);
  }

  // ---------- 生命周期 / 降级 ----------
  ok('ctx.effect 捕获到 cleanup', cleanups.length === 1 && typeof cleanups[0] === 'function');
  cleanups[0]();
  ok('disposer 释放了两条路由', disposed.length === 2 && routes.size === 0, JSON.stringify(disposed));

  const missingWarnings = [];
  let missingCleanup;
  const missingCtx = {
    logger: { warn: (message) => missingWarnings.push(String(message)) },
    effect: (callback) => {
      missingCleanup = callback();
    },
  };
  const missingReturn = apply(missingCtx);
  ok('webServer 缺失不抛异常', missingReturn === undefined);
  ok('webServer 缺失写告警', missingWarnings.some((message) => message.includes('webServer service is unavailable')), JSON.stringify(missingWarnings));
  ok('webServer 缺失时 cleanup 是 no-op', (() => {
    if (typeof missingCleanup !== 'function') return false;
    try {
      missingCleanup();
      return true;
    } catch {
      return false;
    }
  })());

  const failingWarnings = [];
  const failingCtx = makeCtx({ register: () => { throw new Error('duplicate route'); } });
  failingCtx.logger = { warn: (message) => failingWarnings.push(String(message)) };
  apply(failingCtx);
  ok('register 抛异常不冒泡', failingWarnings.some((message) => message.includes('failed to register route')), JSON.stringify(failingWarnings));

  const noEffectCtx = makeCtx({ effect: false });
  const disposer = apply(noEffectCtx);
  ok('无 ctx.effect 时直接返回 disposer', typeof disposer === 'function' && routes.size === 2, String(routes.size));
  disposer();
  ok('直接返回的 disposer 可用', routes.size === 0);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(`PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
