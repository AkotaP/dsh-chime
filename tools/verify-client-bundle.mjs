/**
 * Offline verification for the built client bundle.
 *
 * Replays what `dsh-client-modules` does in the browser: evaluate
 * `lib/client.js` with a `window.__ModuleLoader__` stub, then materialize the
 * registered factory with a minimal platform module table. This catches a
 * malformed wrapper, an unexpected `require(...)`, or a module-body error
 * without needing a DSH restart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const code = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');

/** @type {Map<string, {id: string, factory: Function}>} */
const registered = new Map();
const fakeWindow = {
  __ModuleLoader__: {
    load(row) {
      registered.set(row.id, row);
    },
  },
};

// Evaluate exactly like the loader does: only `window` is in scope.
new Function('window', code)(fakeWindow);

const row = registered.get('dsh-chime');
if (row === undefined) throw new Error('bundle did not register id "dsh-chime"');
if (typeof row.factory !== 'function') throw new Error('registered row has no factory');

/** Minimal stand-ins for the frozen platform module table. */
const noop = () => {};
const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, noop],
  useEffect: noop,
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
  useSyncExternalStore: () => undefined,
  Fragment: Symbol('Fragment'),
};
const jsxRuntime = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  Fragment: Symbol('Fragment'),
};

const requested = [];
const requireStub = (name) => {
  requested.push(name);
  if (name === 'react') return react;
  if (name === 'react/jsx-runtime') return jsxRuntime;
  throw new Error(`unexpected require("${name}") — declare it under dsh.client.external`);
};

const mod = row.factory(requireStub);

const apply = mod.apply ?? mod.default?.apply;
if (typeof apply !== 'function') throw new Error('client half exports no apply()');

console.log('OK  registered id :', row.id);
console.log('OK  exports       :', Object.keys(mod).join(', '));
console.log('OK  inject        :', (mod.inject ?? []).join(', '));
console.log('OK  apply         :', typeof apply);
console.log('OK  require()d    :', [...new Set(requested)].join(', '));
