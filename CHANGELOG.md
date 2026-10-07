# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

No version has been released yet, so the entries below carry no release dates, and the development iterations that preceded the first release are folded into 0.1.0.

## [Unreleased]

## [0.3.1] — not released

### Fixed

- **A console error on every poll: `cannot get property "remote.job" without inject`.** The background-job count called `ctx.remote.job.list(...)`, a namespace a plugin cannot reach — Typert rejects `remote.<namespace>` without an explicit inject, and the client `jobs` service already wraps that namespace. The count now subscribes with `ctx.jobs.watchRows(sessionId)` and reads `ctx.jobs.state.rowsBySession`, which is how the official job list does it. The service is looked up optionally and every access is guarded, so a DSH without it degrades to a count of 0 instead of erroring. `tools/verify-apply.mjs` now activates the plugin twice — with and without the `jobs` service — to keep that degradation path honest.

## [0.3.0] — not released

### Added

- **Maximum session depth** (`maxDepth`, default `0`): how deep a session may be for its chime to ring. `0` rings only for the main session, `1` also for its direct subagents, and so on. The depth is read from the session list's `parentSessionId` chain and cached per session; it is computed only when a chime is about to play, so the per-tick path pays nothing. A session that is a subagent but whose parent cannot be resolved counts as depth 1; an unreadable depth rings rather than going silent.
- `test/config.test.mjs`, a store-level suite whose first case enumerates `DEFAULT_CONFIG` so a new top-level field cannot be added without extending both `configsEqual` and that list.

### Fixed

- **The depth and completion-duration fields snapped back to their default value.** `configsEqual` — the comparison `commit` uses to decide whether a write changes anything — never looked at `maxDepth` or `completionMinSeconds`, so updates to exactly those two fields were dropped and the form re-read the default on blur. Every top-level field is now compared.
- `config.js` rounded these fields with `Math.round` while the settings form clamped them with `Math.floor`; both now floor.

### Changed

- The configuration screenshot in both READMEs (`docs/img/ui.png`) was refreshed.
- The event-detection suite grew from 33 to 41 cases: the depth gate across all four events, unreadable depths, a broken parent chain, a cyclic chain, a 40-deep chain, invalid thresholds, depth caching, and cache eviction.

## [0.2.0] — not released

### Added

- **Minimum task duration for the completion chime** (default **10 seconds**): the completion chime stays silent when less than this many seconds have passed since your last message, so small tasks stop ringing. The clock is read from the newest `user/message` in the session log, so waiting for an approval or answering a question never resets it. `0` rings on every completion. When that timestamp cannot be read the chime rings — the gate is opt-in silence, never accidental silence.
- English and Chinese dictionaries (`src/client/locale.js`) registered through the DSH locale service, with the settings form rendered through the bound `t`.
- `README.en.md` mirroring the Chinese README; both link each other.
- A configuration screenshot in both READMEs (`docs/img/ui.png`).
- `LICENSE`, `.gitignore`, and this changelog.

### Changed

- DSH compatibility declared as `>=0.2.0-rc.2` in `engines.dsh` and in the `@deepseek-ai/dsh` peer dependency.
- The event-detection suite grew from 27 to 33 cases: short and long tasks, the exact boundary, a disabled gate, unreadable timestamps, state still advancing after a suppressed chime, and attention events staying unaffected.

### Removed

- The local-file picker entry point on the settings page. The form now exposes a single input field — an `http(s)` link or an absolute path — which is the shortest path for both new and advanced users. The IndexedDB store, the `local` source, and the host `/dsh-chime/list` route remain in the codebase, unused, so the entry can be restored without redesign.

## [0.1.0] — not released

### Added

- Four independent chimes — **approval**, **question**, **interruption**, and **completion** — each with its own source and its own volume (0–100). Every chime is silent until configured.
- Configuration form rendered on the plugin's own page through the `plugins.bundle.config` seat, so no drilling into a component row is needed.
- Three sound sources: an `http(s)` link, a local absolute path served as a same-origin URL by the plugin's host half (`/dsh-chime/asset`), and a browser-picked file stored in IndexedDB.
- Web Audio playback (`AudioContext` + `decodeAudioData` + `BufferSource` + `GainNode`), so automatic chimes still sound without a fresh user gesture once the context is unlocked.
- A `backgroundSessions` switch deciding whether non-active sessions may ring.
- Host half exposing two loopback HTTP routes: `/dsh-chime/asset` (audio bytes, `Content-Type`, `Range`/`206`, `no-store`) and `/dsh-chime/list` (directory entries).
- Offline test suites: event detection (`test/detect.test.mjs`, 27 cases), client activation (`tools/verify-apply.mjs`), bundle loading (`tools/verify-client-bundle.mjs`), and host routes (`tools/verify-host-routes.mjs`).

### Fixed

- The plugin failed to activate in the browser (`ReferenceError: isLocalPath is not defined`) because the import was removed while the `createAudioEngine` dependency still referenced it; `tools/verify-apply.mjs` now reproduces the activation path so the class of bug cannot recur.
- Automatic chimes never sounded: playback used `HTMLAudioElement`, which the browser blocks outside a user gesture, and the completion/approval chimes have no gesture of their own. Playback moved to Web Audio.
- Tuning a local file always failed with a generic "cannot play this source": the read went through `ctx.remote.workspaceFiles`, which is **not mounted on the Client Remote surface** (`dsh-api-remotes` does not expose it), and the directory picker's native backend cannot list files.
- Local paths outside the session workspace could not be read at all; the host route reads any absolute path.
- Trial playback and file errors were swallowed into one vague message; failures now surface their cause (HTTP status, decode failure, blocked autoplay, missing local audio).
- `config.js` normalized `source: 'local'` to `'url'`, which silently disabled browser-picked files; the source whitelist now accepts all three.
