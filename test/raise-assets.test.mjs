import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWindowsRaiseScript } from '../src/host/windows-raise.js';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('PowerShell is a separate, byte-identical source and distribution asset', () => {
  const source = readFileSync(new URL('../src/host/windows-raise.ps1', import.meta.url));
  const bundled = readFileSync(new URL('../lib/windows-raise.ps1', import.meta.url));
  assert.deepEqual(bundled, source);
  assert.equal(buildWindowsRaiseScript(123), '$desktopPid = 123\n' + source.toString('utf8'));
  const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(host, /DllImport|public static class DshChimeRaise/);
  assert.match(host, /windows-raise\.ps1/);
});

test('bundled host resolves its sibling PowerShell asset without a source tree', async () => {
  const isolated = await mkdtemp(join(tmpdir(), 'dsh-chime-raise-assets-'));
  try {
    await copyFile(new URL('../lib/index.js', import.meta.url), join(isolated, 'index.mjs'));
    await copyFile(new URL('../lib/windows-raise.ps1', import.meta.url), join(isolated, 'windows-raise.ps1'));
    const { createRaiseHandler } = await import(pathToFileURL(join(isolated, 'index.mjs')).href);
    let invocation;
    const handler = createRaiseHandler({
      platform: 'win32', desktopPid: 123,
      execFile(command, args, options, callback) {
        invocation = { command, args };
        callback(null, JSON.stringify({ activated: true, reason: 'activated', attempts: 1,
          initialState: 'normal', protocolRequested: false }), '');
      },
    });
    const res = {
      headersSent: false, status: 0, body: null,
      writeHead(status) { this.status = status; this.headersSent = true; },
      end(body) { this.body = JSON.parse(body); },
    };
    await handler({ method: 'POST', headers: { 'x-dsh-chime': 'raise' } }, res);
    assert.equal(res.status, 202);
    assert.equal(res.body.activated, true);
    const encoded = invocation.args[invocation.args.indexOf('-EncodedCommand') + 1];
    assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), buildWindowsRaiseScript(123));
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
});
