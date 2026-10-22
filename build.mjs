/**
 * Builds both halves of dsh-chime.
 *
 *  - `src/host/index.js`   -> `lib/index.js`   plain ESM for the Node side
 *  - `src/client/index.js` -> `lib/client.js`  browser bundle wrapped in the
 *    `window.__ModuleLoader__.load` protocol that `dsh-client-modules` serves.
 *
 * Sandbox note: esbuild's JS API spawns its binary with piped stdio, which the
 * DSH file sandbox rejects with EPERM. We therefore drive the CLI binary
 * directly using `stdio: 'inherit'` and let it write output files.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** Requests resolved at runtime by the DSH browser module loader. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale',
];

/**
 * Locate the platform-specific esbuild binary.
 *
 * Handles both the flat npm layout and pnpm's `.pnpm` store layout.
 *
 * @returns {string} absolute path to the esbuild executable.
 */
function findEsbuild() {
  const platform = process.platform === 'win32' ? 'win32-x64' : `${process.platform}-${process.arch}`;
  const names = process.platform === 'win32' ? ['esbuild.exe'] : ['bin/esbuild'];
  const candidates = [];
  for (const name of names) {
    candidates.push(path.join(root, 'node_modules', '@esbuild', platform, name));
  }
  const store = path.join(root, 'node_modules', '.pnpm');
  if (fs.existsSync(store)) {
    for (const entry of fs.readdirSync(store)) {
      if (!entry.startsWith(`@esbuild+${platform}@`)) continue;
      for (const name of names) {
        candidates.push(path.join(store, entry, 'node_modules', '@esbuild', platform, name));
      }
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('esbuild binary not found — run `pnpm install` first');
}

const esbuild = findEsbuild();
fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
// Keep the PowerShell source beside the bundled host; package.json already includes lib/.
fs.copyFileSync(path.join(root, 'src/host/windows-raise.ps1'), path.join(root, 'lib/windows-raise.ps1'));

/**
 * Run one esbuild CLI invocation.
 *
 * @param {string[]} args - CLI arguments.
 */
function run(args) {
  execFileSync(esbuild, args, { cwd: root, stdio: 'inherit' });
}

// --- host half: plain ESM, every package import stays external -------------
run([
  'src/host/index.js',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=node20',
  '--packages=external',
  '--outfile=lib/index.js',
  '--log-level=warning',
]);

// --- client half: CJS in a temp file, then wrapped in the loader protocol --
const rawPath = path.join(root, 'lib', '.client.raw.cjs');
run([
  'src/client/index.js',
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  '--target=es2022',
  '--jsx=automatic',
  ...CLIENT_EXTERNALS.map((name) => `--external:${name}`),
  `--outfile=${path.relative(root, rawPath)}`,
  '--log-level=warning',
]);

const body = fs
  .readFileSync(rawPath, 'utf8')
  .split('\n')
  .map((line) => (line.length > 0 ? '    ' + line : line))
  .join('\n');

const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`;

fs.writeFileSync(path.join(root, 'lib/client.js'), wrapped);
fs.rmSync(rawPath, { force: true });
console.log(`built lib/index.js and lib/client.js with ${path.basename(esbuild)}`);
