/**
 * `/dsh-chime/raise` 的离线测试（CONTRACT §4.8）。
 *
 * 这条路由是**实验性**的：渲染进程无法激活宿主窗口（`window.focus()` 只影响
 * 页面焦点），所以由 host 半在 Windows 上执行 PID 限定的 Win32 脚本：
 * 最小化态用 SC_RESTORE，隐藏态只请求 `dsh://open`，实际前台状态单独校验。
 * macOS / Linux 继续走 DSH 已注册的 `dsh://open` 协议。
 *
 * 测试只关心「路由层」：方法/凭据校验、平台命令、执行结果与失败降级。
 * 进程执行用注入的假 `execFile`，因此**不会真的拉起 PowerShell**。
 *
 * 运行：`node test/raise.test.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRaiseHandler } from '../src/host/index.js';
import { buildWindowsRaiseScript } from '../src/host/windows-raise.js';

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
 * @param {{ error?: Error|null, stdout?: string }} [options] 回调时带出的错误和输出。
 * @returns {{ execFile: Function, calls: object[] }} 假实现与调用记录。
 */
function execSpy({ error = null, stdout = '' } = {}) {
  /** @type {object[]} */
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(error, stdout, '');
  };
  return { execFile, calls };
}

/** @param {FakeRes} res 假响应。 @returns {object} 解析后的 JSON。 */
const bodyOf = (res) => JSON.parse(res.body.toString('utf8'));

const raiseRequest = { method: 'POST', headers: { 'x-dsh-chime': 'raise' } };
const activatedResult = {
  activated: true,
  reason: 'activated',
  attempts: 1,
  initialState: 'normal',
  protocolRequested: false,
};

/** 只解码，不执行生成的 PowerShell。 */
function scriptOf(invocation) {
  const index = invocation.args.indexOf('-EncodedCommand');
  assert.notEqual(index, -1, 'Windows 脚本必须编码后传入');
  return Buffer.from(invocation.args[index + 1], 'base64').toString('utf16le');
}

/** 由测试决定何时完成，避免真实进程和任意时长的 sleep。 */
function deferredExecSpy() {
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, options, callback });
  };
  return { execFile, calls };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

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
  const { execFile, calls } = execSpy({ stdout: JSON.stringify(activatedResult) });
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
  assert.equal(script, buildWindowsRaiseScript(process.ppid), '默认 PID 必须取宿主父进程');
  assert.equal(bodyOf(res).activated, true);
  assert.equal(bodyOf(res).reason, 'activated');
  assert.match(script, /0xF120/i, '最小化窗口要用 SC_RESTORE 恢复');
  assert.match(script, /0xF020/i, '普通后台失败后的降级只做一次最小化恢复');
  assert.match(script, /finally[\s\S]*?0xF120/i, '降级等待中断也必须请求恢复');
  assert.match(script, /ELECTRON_RUN_AS_NODE/, 'Desktop 副实例不能继承 Node 启动模式');
  assert.match(script, /dsh:\/\/open/, '隐藏态必须通过 Electron 协议恢复');
  assert.match(script, /GetWindowThreadProcessId/, '选窗必须检查所属进程，不能只匹配标题');
  assert.match(script, /GetForegroundWindow/, '实际激活必须校验前台窗口');
  assert.match(script, /for\s*\([^)]*-lt\s+[1-9]\d*/, '重试循环必须有明确的次数上限');
  assert.match(script, /ElapsedMilliseconds\s*-lt\s*\$\w+/, '重试还必须受截止时间约束');
  assert.doesNotMatch(script, /SwitchToThisWindow|AttachThreadInput|keybd_event/i, '不能调用旧抢焦点 API');
  assert.doesNotMatch(script, /::ShowWindow\s*\(/i, '不能直接 ShowWindow 恢复隐藏态');
});

test('macOS / Linux 用各自的打开命令', async () => {
  for (const [platform, command, args] of [
    ['darwin', 'open', ['dsh://open']],
    ['linux', 'xdg-open', ['dsh://open']],
  ]) {
    const { execFile, calls } = execSpy({ stdout: JSON.stringify(activatedResult) });
    const handler = createRaiseHandler({ execFile, platform });
    const res = await call(handler, { method: 'POST', headers: { 'x-dsh-chime': 'raise' } });
    assert.equal(res.status, 202);
    assert.equal(bodyOf(res).requested, true);
    assert.notEqual(bodyOf(res).activated, true, '协议执行成功不等于实际聚焦');
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

for (const [reason, activated, initialState, protocolRequested, attempts] of [
  ['activated', true, 'normal', false, 2],
  ['already-foreground', true, 'normal', false, 0],
  ['foreground-denied', false, 'normal', false, 3],
  ['hidden', false, 'hidden', true, 0],
  ['not-found', false, 'normal', false, 0],
  ['restore-pending', false, 'minimized', false, 0],
  ['interrupted', false, 'normal', false, 1],
  ['ambiguous', false, 'normal', false, 0],
  ['protocol-error', false, 'hidden', true, 0],
]) {
  test('Windows 结构化结果：' + reason + '，不以 exit 0 代替实际聚焦', async () => {
    const result = { activated, reason, initialState, protocolRequested, attempts };
    const { execFile } = execSpy({ stdout: '\r\n' + JSON.stringify(result) + '\r\n' });
    const handler = createRaiseHandler({ execFile, platform: 'win32' });
    const res = await call(handler, raiseRequest);
    const body = bodyOf(res);
    assert.equal(res.status, 202);
    assert.equal(body.requested, true, 'requested 只表示命令成功执行');
    assert.equal(body.exitCode, 0);
    for (const [key, value] of Object.entries(result)) assert.equal(body[key], value, key);
  });
}

test('Windows 缺失、损坏或非结果 JSON → invalid-result，命令 exit 0 仍不是激活成功', async (t) => {
  const badResults = [
    '', ' ', 'not-json', '{"activated":', 'null', '[]', 'true', '42', '{}',
    JSON.stringify({ ...activatedResult, activated: 'true' }),
    JSON.stringify({ ...activatedResult, reason: 'unknown' }),
    JSON.stringify({ ...activatedResult, attempts: -1 }),
    JSON.stringify({ ...activatedResult, attempts: 1.5 }),
    JSON.stringify({ ...activatedResult, attempts: '1' }),
    JSON.stringify({ ...activatedResult, initialState: 'unknown' }),
    JSON.stringify({ ...activatedResult, protocolRequested: 'false' }),
  ];
  for (const key of Object.keys(activatedResult)) {
    const incomplete = { ...activatedResult };
    delete incomplete[key];
    badResults.push(JSON.stringify(incomplete));
  }
  for (const stdout of badResults) {
    await t.test(JSON.stringify(stdout), async () => {
      const { execFile } = execSpy({ stdout });
      const handler = createRaiseHandler({ execFile, platform: 'win32' });
      const res = await call(handler, raiseRequest);
      const body = bodyOf(res);
      assert.equal(res.status, 202);
      assert.equal(body.requested, true);
      assert.equal(body.exitCode, 0);
      assert.equal(body.activated, false);
      assert.equal(body.reason, 'invalid-result');
    });
  }
});

test('Windows 命令失败即使 stdout 声称已激活，也不能报告 activated=true', async () => {
  const { execFile } = execSpy({
    error: Object.assign(new Error('process failed'), { code: 1 }),
    stdout: JSON.stringify(activatedResult),
  });
  const res = await call(createRaiseHandler({ execFile, platform: 'win32' }), raiseRequest);
  assert.equal(bodyOf(res).requested, false);
  assert.equal(bodyOf(res).activated, false);
});

test('Windows builder 只接受内部 number 正整数，不允许字符串或对象拼接脚本', () => {
  for (const desktopPid of [
    undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    '123', '123; Start-Process calc.exe', true, {}, [], 123n,
  ]) {
    assert.throws(() => buildWindowsRaiseScript(desktopPid), undefined, typeof desktopPid);
  }
  let coerced = false;
  assert.throws(() => buildWindowsRaiseScript({
    toString() { coerced = true; return '12345'; },
    valueOf() { coerced = true; return 12345; },
  }));
  assert.equal(coerced, false, '必须先验证类型，不能隐式执行外部对象的转换代码');
  assert.equal(typeof buildWindowsRaiseScript(12345), 'string');
  assert.match(buildWindowsRaiseScript(12345), /\b12345\b/);
});

test('Windows handler 的非法 desktopPid 不能到达 execFile', async () => {
  for (const desktopPid of [0, -1, 1.5, NaN, null, '123', '123; Start-Process calc.exe']) {
    const { execFile, calls } = execSpy({ stdout: JSON.stringify(activatedResult) });
    // 实现可以在创建时拒绝，也可以在请求时降级；任何情况下都不能拼接并执行。
    let rejected = false;
    let response;
    try {
      const handler = createRaiseHandler({ execFile, platform: 'win32', desktopPid });
      response = await call(handler, raiseRequest);
    } catch (error) {
      assert.ok(error instanceof Error);
      rejected = true;
    }
    assert.equal(calls.length, 0, '非法 PID 不允许启动命令');
    if (!rejected) assert.equal(bodyOf(response).requested, false);
  }
});

test('Windows handler 只使用注入 desktopPid，忽略 URL、头和 body 中的 PID/脚本', async () => {
  const { execFile, calls } = execSpy({ stdout: JSON.stringify(activatedResult) });
  const handler = createRaiseHandler({ execFile, platform: 'win32', desktopPid: 45678 });
  const injected = '99999; Start-Process calc.exe';
  const res = new FakeRes();
  await handler({
    method: 'POST',
    url: '/dsh-chime/raise?desktopPid=' + encodeURIComponent(injected),
    headers: { 'x-dsh-chime': 'raise', 'x-desktop-pid': injected },
    body: { desktopPid: injected },
    query: { desktopPid: injected },
    desktopPid: injected,
  }, res);
  assert.equal(res.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(scriptOf(calls[0]), buildWindowsRaiseScript(45678));
  assert.doesNotMatch(scriptOf(calls[0]), /99999|calc\.exe/);
});

test('Windows 进行中的请求共享执行结果，完成后下一次可重新执行', async () => {
  const { execFile, calls } = deferredExecSpy();
  const handler = createRaiseHandler({ execFile, platform: 'win32' });
  const first = call(handler, raiseRequest);
  const second = call(handler, raiseRequest);
  const third = call(handler, raiseRequest);
  await nextTurn();
  assert.equal(calls.length, 1, '重叠请求只能 spawn 一次');

  // 在已有请求进行中，方法和凭据也必须继续校验，不能直接返回共享结果。
  assert.equal((await call(handler, { method: 'POST' })).status, 403);
  assert.equal((await call(handler, { method: 'GET', headers: raiseRequest.headers })).status, 405);
  assert.equal(calls.length, 1);
  calls[0].callback(null, JSON.stringify(activatedResult), '');
  const responses = await Promise.all([first, second, third]);
  for (const res of responses) {
    assert.equal(res.status, 202);
    assert.equal(bodyOf(res).activated, true);
    assert.deepEqual(bodyOf(res), bodyOf(responses[0]));
  }

  const later = call(handler, raiseRequest);
  await nextTurn();
  assert.equal(calls.length, 2, '完成后必须清理 in-flight');
  calls[1].callback(null, JSON.stringify({ ...activatedResult, activated: false, reason: 'foreground-denied' }), '');
  const laterBody = bodyOf(await later);
  assert.equal(laterBody.requested, true);
  assert.equal(laterBody.activated, false, '下一次不能使用旧成功结果');
  assert.equal(laterBody.reason, 'foreground-denied');
});

test('Windows 并发回调失败共享失败，清理后可再次执行成功', async () => {
  const { execFile, calls } = deferredExecSpy();
  const handler = createRaiseHandler({ execFile, platform: 'win32' });
  const first = call(handler, raiseRequest);
  const second = call(handler, raiseRequest);
  await nextTurn();
  assert.equal(calls.length, 1);
  calls[0].callback(Object.assign(new Error('spawn EPERM'), { code: 1 }), '', '');
  for (const res of await Promise.all([first, second])) {
    assert.equal(res.status, 202);
    assert.equal(bodyOf(res).requested, false);
    assert.equal(bodyOf(res).activated, false);
    assert.equal(bodyOf(res).exitCode, 1);
  }
  const recovery = call(handler, raiseRequest);
  await nextTurn();
  assert.equal(calls.length, 2, '失败不能永久缓存');
  calls[1].callback(null, JSON.stringify(activatedResult), '');
  assert.equal(bodyOf(await recovery).activated, true);
});

test('Windows 同步 execFile 抛错后清理，下次请求可成功', async () => {
  let executions = 0;
  const handler = createRaiseHandler({
    platform: 'win32',
    execFile(command, args, options, callback) {
      executions += 1;
      if (executions === 1) throw new Error('first execution failed');
      callback(null, JSON.stringify(activatedResult), '');
    },
  });
  const failed = await call(handler, raiseRequest);
  assert.equal(bodyOf(failed).requested, false);
  assert.equal(bodyOf(failed).activated, false);
  const recovered = await call(handler, raiseRequest);
  assert.equal(executions, 2);
  assert.equal(bodyOf(recovered).requested, true);
  assert.equal(bodyOf(recovered).activated, true);
});

test('Windows 透传恢复降级诊断并拒绝不一致的成功结果', async () => {
  for (const [result, expected] of [
    [{ ...activatedResult, restoreCycle: true }, 'activated'],
    [{ ...activatedResult, restoreCycle: 'yes' }, 'invalid-result'],
    [{ ...activatedResult, attempts: 5 }, 'invalid-result'],
    [{ ...activatedResult, reason: 'foreground-denied' }, 'invalid-result'],
    [{ ...activatedResult, activated: false, reason: 'helper-error', initialState: 'unknown' }, 'helper-error'],
    [{ ...activatedResult, activated: false, reason: 'not-found', initialState: 'unknown' }, 'not-found'],
  ]) {
    const { execFile } = execSpy({ stdout: JSON.stringify(result) });
    const response = bodyOf(await call(createRaiseHandler({ platform: 'win32', execFile }), raiseRequest));
    assert.equal(response.reason, expected);
    assert.equal(response.activated, expected === 'activated');
    if (expected === 'activated') assert.equal(response.restoreCycle, true);
  }
});

test('Windows 无效结果后也可重试，不缓存 invalid-result', async () => {
  let executions = 0;
  const handler = createRaiseHandler({
    platform: 'win32',
    execFile(command, args, options, callback) {
      executions += 1;
      callback(null, executions === 1 ? '' : JSON.stringify(activatedResult), '');
    },
  });
  assert.equal(bodyOf(await call(handler, raiseRequest)).reason, 'invalid-result');
  assert.equal(bodyOf(await call(handler, raiseRequest)).activated, true);
  assert.equal(executions, 2);
});
