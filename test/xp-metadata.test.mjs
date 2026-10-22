/** Exercise the exact named resources used by DSH display metadata and client discovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../package.json', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const root = readJson(new URL('../package.json', import.meta.url));

test('XP is a real named dependency bundled with the main package, not a path-only row', () => {
  assert.equal(root.dependencies['dsh-chime-xp'], 'workspace:*');
  assert.ok(root.bundledDependencies.includes('dsh-chime-xp'));
  const manifestPath = require.resolve('dsh-chime-xp/package.json');
  // Package managers and confined Windows resolvers may preserve a workspace-link spelling.
  assert.deepEqual(readJson(manifestPath), readJson(new URL('../components/xp/package.json', import.meta.url)));
  assert.equal(readJson(manifestPath).name, 'dsh-chime-xp');
  assert.equal(readJson(manifestPath).version, root.version);
  assert.match(root.version, /-playground$/);
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.ok(patch.includes("name: 'dsh-chime-xp'"));
  assert.ok(!patch.includes('components/xp/lib/index.js'));
});

test('display metadata exports a readable Chinese title and English fallback', () => {
  const zh = readJson(require.resolve('dsh-chime-xp/locale/zh.json'));
  const en = readJson(require.resolve('dsh-chime-xp/locale/en.json'));
  assert.equal(zh.meta.title, '经验球音效');
  assert.equal(en.meta.title, 'Experience orb chimes');
  assert.ok(zh.meta.description.length > 0 && en.meta.description.length > 0);
  for (const metadata of [zh.meta, en.meta]) {
    assert.ok(!metadata.title.includes('file:'));
    assert.ok(!metadata.title.includes('/'));
  }
});

test('named host and client entries resolve independently without importing notification client', async () => {
  const host = await import('dsh-chime-xp');
  assert.equal(host.name, 'dsh-chime-xp');
  assert.equal(typeof host.apply, 'function');
  const client = readFileSync(require.resolve('dsh-chime-xp/client'), 'utf8');
  assert.ok(client.includes('id: "dsh-chime-xp"'));
  assert.ok(!client.includes('require("dsh-chime")'));
});

test('row identity, settings slot and persisted preferences keep their previous identifiers', () => {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.ok(patch.includes("id: chime-xp\n      name: 'dsh-chime-xp'\n      disabled: true"));
  const client = readFileSync(require.resolve('dsh-chime-xp/client'), 'utf8');
  assert.ok(client.includes('dsh.chime.xp.config.v1'));
  assert.ok(client.includes('dsh-chime#chime-xp'));
});
