# dsh-chime

English | [中文](README.md)

A DeepSeek Harness (DSH) **web** plugin for per-event notification chimes.

## Four chimes

| Chime | When it rings |
| --- | --- |
| **Approval** | A tool call is waiting for your decision (`pendingInteraction === 'approval'`) |
| **Question** | `ask_user_question`, or a plan review (`question` / `plan-review`) |
| **Interruption** | The conversation cannot continue because of an error — a **final** one; failures that get retried stay silent |
| **Completion** | The task has **really** finished: no running agent, no running subagents, no background jobs left |

## Features

- **Link-based sources** — the plugin never copies your audio files:
  - an `http(s)` link, or
  - the **full path** to a local audio file (e.g. `/home/you/ding.mp3` on Linux/macOS, `E:\Sounds\ding.mp3` on Windows), served by the plugin's own host half as a **same-origin URL**.
- **Per-chime volume** — 0–100, fully independent.
- **Attention timing** — five policies over two dimensions at once: which session the event came from, and whether the DSH window has focus. Current session only / only when I am away / away or another session (recommended) / always / never. Sound and notifications pick independently but share one judgement.
- **Rings from the background** — with the window hidden or parked for twenty minutes, a chime fires the moment the event lands instead of waiting for you to switch back.
- **System notifications (independent switch)** — a desktop notification per event, through the system notification centre on Windows, macOS and Linux. It is a second, independent channel with its own timing policy, and clicking one jumps straight back to the conversation that raised it. An experimental toggle also asks the Desktop shell to bring its window to the front (off by default, Desktop installs only).
- **No false positives** — background bash jobs or subagents still running never trigger "completion", and retried failures never trigger "interruption".
- **Silent by default** — an unconfigured chime stays silent; there is never a built-in fallback tone.

## Where to configure

**Plugins → this plugin's page** (or the **Chime** card). The form renders directly on the plugin page — no drilling into a component row.

Changes take effect immediately; there is no save button.

![Configuration UI](docs/img/ui.png)

## Install

> Installing changes the profile configuration under `%USERPROFILE%\.dsh` and requires restarting DSH (which interrupts running sessions). Please confirm first.

Repository: <https://github.com/AkotaP/dsh-chime>

**From the Plugins page**: sidebar **Plugins** → **Add plugin**, and enter the repository address `https://github.com/AkotaP/dsh-chime` (the same field also accepts the npm package name `dsh-chime`, an absolute local directory path, or a tarball). DSH probes the repository with `git ls-remote` before handing it to pnpm; once installed, confirm it shows as enabled in the list.

**One command** (equivalent):

```powershell
dsh plugin --profile desktop add https://github.com/AkotaP/dsh-chime
# Once published to npm, the package name works too:
# dsh plugin --profile desktop add dsh-chime
```

**Let the agent install it** (paste this into a DSH agent):

> Install this repository into the current DSH `desktop` profile: `https://github.com/AkotaP/dsh-chime`. Use the sidebar **Plugins** page's **Add plugin**, or `dsh plugin --profile desktop add https://github.com/AkotaP/dsh-chime`. After installing, confirm `dsh-chime` is present in the profile's `dsh.profile.bundles`, then **ask me first** before restarting DSH. After the restart, confirm the **Chime** card on the Plugins page opens the configuration form.

**Local development** (link a checkout into a profile so source changes apply live): see [Development](#development) below.

After installing, **restart DSH**; the **Chime** card on the Plugins page shows the configuration form. To uninstall: remove it from the **Plugins** page, or `dsh plugin --profile desktop remove dsh-chime` (and confirm the entry is gone from `dsh.profile.bundles`).

## How it works

- Mostly a **Client** plugin. Configuration lives in `localStorage` (`dsh.chime.config.v1`); nothing is written to your DSH profile.
- A thin **host half** exposes two loopback HTTP routes:
  - `GET /dsh-chime/asset?path=<absolute path>` — audio bytes with the right `Content-Type`, `Range`/`206` support, and `Cache-Control: no-store`
  - `GET /dsh-chime/list?path=<directory>` — directory entries (currently unused; that entry point is parked)
- **Why the host route reads local files**: DSH's Client Remote surface does **not** mount `workspaceFiles`, and the native directory picker can select a directory but not list one. Exposing the file through DSH's own HTTP server turns it into a **same-origin URL** the browser treats like any other resource — nothing is copied to disk, and no Remote channel is involved.
- Playback uses **Web Audio** (`AudioContext` + `decodeAudioData` + `BufferSource` + `GainNode`). The plugin unlocks its `AudioContext` on the first `pointerdown`/`keydown`, after which automatic playback is allowed.
- **Event-driven first, polling as a fallback**: the plugin subscribes to DSH's `uiSession.sessionStatus` and `sessions.list`, evaluates the moment either changes, and evaluates once more when the window returns to the foreground; the 400 ms poll is only a safety net. Background pages get throttled — a hidden tab's `setTimeout` is stretched to a second or more, and Chrome's Memory Saver can freeze such a tab outright — so a poll-only detector could hold a "question" or "approval" chime back until you switched back to DSH. The subscriptions ride DSH's remote channel and never touch a timer.
- **Notifications are a second, independent channel**: they read only `config.notify` (master switch + per-event toggles), go through the browser's `Notification`, and are always `silent: true` — sound belongs to the chime channel, or you would hear two tones. The first use needs one "Allow" click in the settings form, because browsers require the permission prompt to come from a user gesture; unsupported or denied environments degrade to silence without errors. Clicking a notification switches the main area back to the Session that raised it through ui-workspace's `openSession`; an unknown Session or a host without that service falls back to focus only, never to an error. Desktop installs additionally have an experimental "bring the window to the front" switch (`notify.raiseWindow`, off by default): Windows identifies the Desktop window by process, restores minimized windows, and asks the desktop shell to show tray-hidden windows, then verifies the actual foreground window. If a visible background window still cannot be activated, one brief minimize/restore cycle is used as a last resort and may flicker. macOS and Linux use DSH's `dsh://open`. Concurrent clicks share one short-lived helper; the OS can still deny activation, and failures retain diagnostics rather than guaranteeing success. A Web page has no window control, so browser installs skip it.
- Event detection mirrors DSH's own sidebar state machine. In particular, `running` only means the agent loop is busy — it does **not** mean the task is finished — so "completion" uses a composite test (see [`CONTRACT.md`](./CONTRACT.md) §3).

## Development

```bash
pnpm install
node build.mjs                 # emits lib/index.js and lib/client.js
node test/detect.test.mjs      # 43 event-detection cases
node tools/verify-apply.mjs    # activates the client half against a stub context
node tools/verify-host-routes.mjs
```

```bash
# Install into a profile for development (symlinks the repo, backs up package.json)
node tools/link-install.mjs web
```

> Build note: `build.mjs` drives the platform esbuild **binary** directly with `stdio: 'inherit'`.
> esbuild's JS API spawns its binary with piped stdio, which the DSH file sandbox rejects with `EPERM`.

Architecture, the DSH API surface used, and the event rules are in [`CONTRACT.md`](./CONTRACT.md).
Release history is in [`CHANGELOG.md`](./CHANGELOG.md).

## Compatibility

- Node.js `>=20`
- DSH `>=0.2.0-rc.2`

## License

[MIT](./LICENSE)
