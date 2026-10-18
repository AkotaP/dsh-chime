/**
 * `/dsh-chime/raise` 的离线测试（CONTRACT §4.8）。
 *
 * 这条路由是**实验性**的：渲染进程无法激活宿主窗口（`window.focus()` 只影响
 * 页面焦点），所以由 host 半在 Windows 上直接用 Win32 消息恢复并前置主窗口
 * （`PostMessage` SC_RESTORE + `SwitchToThisWindow`）；macOS / Linux 继续走
 * DSH 已注册的 `dsh://open` 协议。
 *
 * 测试只关心「路由层」：方法/凭据校验、平台命令、执行结果与失败降级。
 * 进程执行用注入的假 `execFile`，因此**不会真的拉起 PowerShell**。
 *
 * 运行：`node test/raise.test.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRaiseHandler } from '../src/host/index.js';

/** 记录 `writeHead` / `end` 的假响应。 */
class FakeRes {
  constructor() {
    this.status = 0;
    this.headers = {};
    this.body = Buffer.alloc(0);
    this.headersSent = false;
    this.ended = false;
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = { ...(headers ?? {}) };
    this.headersSent = true;
    return this;
  }

  end(body) {
    if (body !== undefined && body !== null) {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    }
    this.ended = true;
    return this;
  }
}

/**
 * 调一次处理器（处理器是 async）。
 *
 * @param {(req: object, res: object) => Promise<void>} handler 处理器。
 * @param {{ method?: string, headers?: Record<string, string>, raw?: boolean }} [request] 请求描述。
 * @returns {Promise<FakeRes>} 假响应。
 */
async function call(handler, request = {}) {
  const res = new FakeRes();
  const req = request.raw
    ? {}
    : {
        method: request.method ?? 'GET',
        url: '/dsh-chime/raise',
        headers: request.headers ?? {},
      };
  await handler(req, res);
  return res;
}

/**
 * 造一个记录调用的假 `execFile`。
 *
 * @param {{ error?: Error|null }} [options] 回调时要带出的错误。
 * @returns {{ execFile: Function, calls: object[] }} 假实现与调用记录。
 */
function execSpy({ error = null } = {}) {
  /** @type {object[]} */
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(error, '', '');
  };
  return { execFile, calls };
}

/** @param {FakeRes} res 假响应。 @returns {object} 解析后的 JSON。 */
const bodyOf = (res) => JSON.parse(res.body.toString('utf8'));

test('缺凭据头 → 403，且不执行任何命令', async () => {
  const { execFile, calls } = execSpy();
  const handler = createRaiseHandler({ execFile, platform: 'win32' });
  const res = await call(handler, { method: 'POST' });
  assert.equal(res.status, 403);
  assert.equal(bodyOf(res).requested, false);
  assert.equal(calls.length, 0, '没凭据就不该碰进程');
});

test('凭据头不对 → 403', async () => {
  const { execFile } = execSpy();
  const handler = createRaiseHandler({ execFile, platform: 'win32' });
  const res = await call(handler, { method: 'POST', headers: { 'x-dsh-chime': 'nope' } });
  assert.equal(res.status, 403);
});

test('非 POST → 405（GET 不能触发唤起）', async () => {
  const { execFile, calls } = execSpy();
  const handler = createRaiseHandler({ execFile, platform: 'win32' });
  const res = await call(handler, { method: 'GET', headers: { 'x-dsh-chime': 'raise' } });
  assert.equal(res.status, 405);
  assert.equal(calls.length, 0);
});

test('POST + 凭据头 → 202；Windows 用 PowerShell 的 Win32 激活脚本', async () => {
  const { execFile, calls } = execSpy();
  const handler = createRaiseHandler({ execFile, platform: 'win32' });
  const res = await call(handler, { method: 'POST', headers: { 'x-dsh-chime': 'raise' } });
  assert.equal(res.status, 202);
  assert.equal(bodyOf(res).requested, true);
  assert.equal(bodyOf(res).exitCode, 0);
  assert.equal(calls.length, 1);
  assert.ok(/powershell\.exe$/i.test(calls[0].command), 'Windows 必须用绝对路径启动 powershell');
  assert.equal(bodyOf(res).command, calls[0].command, '响应要带出实际命令，便于诊断');
  assert.ok(calls[0].args.includes('-EncodedCommand'), '脚本要经 -EncodedCommand 传递');
  const encoded = calls[0].args[calls[0].args.indexOf('-EncodedCommand') + 1];
  const script = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.match(script, /SwitchToThisWindow/, '必须用 Win32 前置窗口');
  assert.match(script, /0xF120/, '最小化窗口要用 SC_RESTORE 恢复');
  assert.match(script, /skipped-hidden/, '关闭到托盘的隐藏窗口必须跳过：外部恢复会让 Electron 状态不同步、整窗卡死');
  assert.match(script, /DeepSeek Harness/, '要能定位 DSH 主窗口');
  assert.match(script, /dsh-chime-raise\.log/, '脚本要留执行痕迹，失败可诊断');
});

test('macOS / Linux 用各自的打开命令', async () => {
  for (const [platform, command, args] of [
    ['darwin', 'open', ['dsh://open']],
    ['linux', 'xdg-open', ['dsh://open']],
  ]) {
    const { execFile, calls } = execSpy();
    const handler = createRaiseHandler({ execFile, platform });
    const res = await call(handler, { method: 'POST', headers: { 'x-dsh-chime': 'raise' } });
    assert.equal(res.status, 202);
    assert.equal(bodyOf(res).requested, true);
    assert.equal(calls[0].command, command);
    assert.deepEqual(calls[0].args, args);
  }
});

test('未知平台 → 202 但 requested=false（不猜命令）', async () => {
  const { execFile, calls } = execSpy();
  const handler = createRaiseHandler({ execFile, platform: 'freebsd' });
  const res = await call(handler, { method: 'POST', headers: { 'x-dsh-chime': 'raise' } });
  assert.equal(res.status, 202);
  assert.deepEqual(bodyOf(res), { requested: false });
  assert.equal(calls.length, 0);
});

test('execFile 同步抛错 → 202 requested=false，原因写进响应', async () => {
  const handler = createRaiseHandler({
    execFile: () => {
      throw new Error('exec exploded');
    },
    platform: 'win32',
  });
  const res = await call(handler, { method: 'POST', headers: { 'x-dsh-chime': 'raise' } });
  assert.equal(res.status, 202);
  assert.equal(bodyOf(res).requested, false);
  assert.match(String(bodyOf(res).error), /exec exploded/);
});

test('execFile 回调错误（进程执行失败）→ 202 带 exitCode/error', async () => {
  const failure = Object.assign(new Error('spawn EPERM'), { code: 1 });
  const { execFile } = execSpy({ error: failure });
  const handler = createRaiseHandler({ execFile, platform: 'win32' });
  const res = await call(handler, { method: 'POST', headers: { 'x-dsh-chime': 'raise' } });
  assert.equal(res.status, 202);
  assert.equal(bodyOf(res).requested, false);
  assert.equal(bodyOf(res).exitCode, 1);
  assert.match(String(bodyOf(res).error), /EPERM/);
});

test('畸形 req（无 method/headers）不抛异常', async () => {
  const { execFile } = execSpy();
  const handler = createRaiseHandler({ execFile, platform: 'win32' });
  const res = await call(handler, { raw: true });
  assert.equal(res.status, 405);
  assert.equal(res.ended, true);
});
