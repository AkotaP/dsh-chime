# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

No version has been released yet, so the entries below carry no release dates, and the development iterations that preceded the first release are folded into 0.1.0.

## [Unreleased]

### Added

- English and Chinese dictionaries (`src/client/locale.js`) registered through the DSH locale service, with the settings form rendered through the bound `t`.
- `README.en.md` mirroring the Chinese README; both link each other.
- `LICENSE`, `.gitignore`, and this changelog.

### Changed

- DSH compatibility declared as `>=0.2.0-rc.2` in `engines.dsh` and in the `@deepseek-ai/dsh` peer dependency.

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
