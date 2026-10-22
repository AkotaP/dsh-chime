# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

No version has been released yet, so the entries below carry no release dates, and the development iterations that preceded the first release are folded into 0.1.0.

## [Unreleased]

## [0.7.0-playground] — not released

### Added

- Optional, default-disabled experience-orb component with its own client lifecycle, local audio routes, configuration page and storage. Any new tool result in the current session starts a uniformly sampled burst; duration bounds and orb frequency are configurable. Repeated triggers merge without multiplying playback loops; history and reconnect baselines never replay sounds.
- MC-style triangular random playback rate (0.55–1.25), overlapping tails, independent volume, foreground-only default, single-note and 10-second rhythm previews. No bundled or automatically downloaded sound files.
- Backward-compatible audio-engine options for playback rate, opt-in overlap, cancellation and shared in-flight decoding; notification playback retains its default interruption behavior.

### Fixed

- Experience-orb component titles now use exported Chinese/English metadata instead of a `file:///...` entry path. The component is a named, bundled workspace dependency; existing row and settings identifiers are preserved.

### Changed

- Minimum DSH version is now 0.2.1-rc.2 for portable embedded-component addressing and independent client discovery.
- The long-lived playground branch uses the next minor version above its main baseline, a patch counter for playground iterations, and the `-playground` suffix. The main package and bundled XP component share the same version.

## [0.6.0] — not released

### Added

- **Experimental: bringing the desktop window to the front on click** (`notify.raiseWindow`, off by default, CONTRACT §4.7 / §4.8). A renderer cannot raise its host window — `window.focus()` only moves page focus — so the host half raises it: on Windows a PowerShell Win32 script finds the DSH window (`Chrome_WidgetWin_1`), restores it with `PostMessage(WM_SYSCOMMAND, SC_RESTORE)` and foregrounds it with `SwitchToThisWindow` + `SetForegroundWindow`; macOS and Linux use DSH's registered `dsh://open` protocol. The `dsh://open` route was measured on Windows to be unreliable (the second instance exits with code 1 and the window never comes back), which is why Windows now uses Win32 messages directly. The helper is run with `execFile` and awaited, because DSH's process sandbox silently reaps detached children (a `spawn` returns a pid that is gone a second later); the route response now carries `exitCode` / `stdout` / `stderr`, and the script appends a timestamp to `%TEMP%\dsh-chime-raise.log` so a click can be traced end to end. **A window closed to the system tray is deliberately skipped**: closing hides the window in Electron (`event.preventDefault()` + `window.hide()`), and restoring that hidden HWND from outside leaves the main process's visibility state out of sync — the window appears but freezes (Chromium keeps treating it as hidden). Minimized and covered windows are restored normally; a tray-hidden window must be reopened from the tray until the shell exposes a raise IPC. The cost is one short-lived helper process per click; only Desktop installs are affected, and a browser page skips it. The new `POST /dsh-chime/raise` route accepts only POST with an `x-dsh-chime: raise` header, so a cross-site request cannot raise the window.
- **Clicking a notification goes to the conversation.** A click now switches the main area to the Session that raised the event, in addition to focusing the DSH window. It uses the client's documented `ctx.uiWorkspace.openSession(sessionId)`, which returns the main area to Conversation even from the plugin or settings page, so a notification is always one click away from the Session that caused it. Unknown or archived Sessions, a host without the service, and the settings form's synthetic test id degrade to the previous focus-only behaviour, and the callback still never throws.

## [0.5.0] — not released

### Added

- **Attention timing** (`attention.sound` / `attention.notify`, CONTRACT §3.7). Both channels now judge *when* to disturb you along two dimensions at once — which session the event came from, and whether the DSH window currently holds focus. Five policies: `current-only` (the previous behaviour), `away` (the Codex desktop default), `away-or-other` (recommended — quiet only while you are actually looking at that session), `always`, `never`. The two channels pick independently but share a single judgement, so the "notifications off, sound still ringing" mismatch the Codex desktop shipped cannot happen here. The settings form swaps the old checkbox for two dropdowns.
- `src/client/presence.js` — a tolerant focus/visibility probe. Unreadable focus counts as *present*, so a chime never goes silent merely because the signal was missing.
- The detector exports a pure `shouldDeliver(policy, isActiveSession, focused)`, covered by a truth-table test over all five policies (detection suite 45 → 48 cases).

### Changed

- **`backgroundSessions` is gone.** It is folded into `attention.sound` on read (`true → always`, `false → current-only`) and never written again; `CONTRACT.md` §3.7 documents the new model, and §4.1 / §4.4 / §4.7 follow. The maximum-session-depth field is untouched.
- `ChimeEvent` gained `notify: boolean`, mirroring `sound`, so a consumer can tell the two channels' verdicts apart.
- Config suite 6 → 8 cases (attention round-trip, and the `backgroundSessions` migration).
- Notification bodies name their source explicitly — `From session — "<title>"` instead of a bare conversation title that read like stray text. A session without a title still falls back to the per-event sentence.
- The settings form is organised by **priority: channel → general → event**. Each event card now carries its own chime source *and* a "send a notification" tick plus a per-event test button, so everything about one event lives in one place; the four notification ticks that used to sit in the notification card are gone. The two quiet rules (maximum session depth, minimum task duration) moved into a shared **General** card, since both gate both channels.

### Fixed

- **The policy dropdowns were unreadable on a dark theme.** The expanded option list is drawn by the operating system, so the `color: inherit` taken from the `<select>` landed as light-on-light. The options now use the `Canvas` / `CanvasText` system colour keywords, which follow the system theme and stay legible in any combination.

## [0.4.0] — not released

### Added

- **System notifications** — a second, independent reminder channel (`src/client/notify.js`, CONTRACT §4.7). Each event can raise a desktop notification in addition to (or instead of) its chime. The channel reads only `config.notify`, so it still fires with sounds switched off or no audio configured, and it deliberately ignores "also play in background sessions" — a notification matters most exactly when you are looking elsewhere. Notifications are always `silent: true` (the chime channel owns sound; otherwise you would hear two tones), clicking one focuses the window and closes it, and the tag `dsh-chime:<kind>:<sessionId>` replaces a session's previous notification instead of stacking. Permission comes from an "Allow" button in the settings form, because browsers require the prompt to be triggered by a user gesture; unsupported environments and denied permission degrade to silence rather than errors.
- A **Test notification** button in the settings form, next to the permission state. It calls `explain()` first and prints the verdict — "sent", "the master switch is off", "this event type is not ticked", "permission is denied" — so a notification that fails to appear is never just silence.
- `test/notify.test.mjs`, 14 cases: the master switch, the per-kind toggles, the permission three-state, unsupported environments, a throwing constructor, a throwing `buildMessage`, a throwing `getConfig`, unknown event kinds, click handling, `dispose()`, identical verdicts from `explain()` and `notify()`, and the tag-length bound.
- Two detection cases that pin the two channels apart: with notifications off, a background-session event is not emitted at all; with them on it is emitted with `sound: false` (43 → 45 cases).

### Changed

- `ChimeEvent` gained `sound: boolean` — the detector's verdict for the **sound** channel, so a consumer can tell "notify only" from "notify and ring" (CONTRACT §4.4).
- The path hint in both dictionaries, both READMEs and the settings form now shows a POSIX example next to the Windows one (`/home/you/ding.mp3`), so the plugin reads as cross-platform.
- `CONTRACT.md` §4.1 now documents `completionMinSeconds` and `maxDepth` (they had drifted out of the contract) plus the new `notify` block; §4.7 documents the notifier.

### Fixed

- **Desktop notifications that silently never appeared on Windows.** The `tag` was built as `dsh-chime:<kind>:<sessionId>`, which for DSH's `session-<uuid>` ids lands on **exactly 64 characters** — the ceiling of the Windows toast `Tag` property. Chromium drops an over-long notification **silently**: no banner, no notification-centre entry, not even an `error` event, while `new Notification()` still returns normally. That is why the settings-page test button (short synthetic id, no tag collision) rang every time while real events never did. The tag now keeps the session id's tail and is capped at 48 characters.

## [0.3.2] — not released

### Added

- **Event-driven detection (`detector.poke()`).** The client half now subscribes to `uiSession.sessionStatus` and `sessions.list` and evaluates the moment either source changes, plus once more when the window returns to the foreground; the 400 ms poll stays as a fallback. A hidden page has its timers throttled — Chromium stretches a background tab's `setTimeout` to a second or more, and Chrome's Memory Saver can freeze such a tab outright — so the poll-only detector could hold a "question" or "approval" chime back until the window came forward again. The new path rides DSH's remote channel and never touches a timer.
- Two detection cases covering `poke()`: it rings immediately with no timer involved, calls arriving while a tick is in flight collapse into a single follow-up run, and a call after `dispose()` does nothing (41 → 43 cases).

### Changed

- `CONTRACT.md` §4.4 documents `poke()` and the rule that polling must stay a fallback rather than the only evaluation path.

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
