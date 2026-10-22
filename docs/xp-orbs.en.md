# Experience-orb component

The optional `chime-xp` row is disabled by default. It has its own browser entry, local audio routes, settings page and localStorage key (`dsh.chime.xp.config.v1`). Disabling notification chimes does not disable XP chimes.

## Setup

Enable **Experience orb chimes** (row `chime-xp`) in the dsh-chime component list, open that row's configuration page, supply an HTTP(S) audio URL or an absolute local file path, then enable automatic XP sound. Single-note and 10-second rhythm previews also work while automatic playback is off. No MC audio is supplied or downloaded. An original, unpitched short sample is recommended; recordings may already have pitch applied.

| Setting | Default | Range |
| --- | --- | --- |
| Minimum burst duration | 1 second | 0.1–30 seconds |
| Maximum burst duration | 3 seconds | 0.1–30 seconds; at least the minimum |
| Orb frequency | 6 per second | 0.1–10 per second |
| Volume | 10% | 0–100% |
| Play when unfocused | Off | On/off |
| Automatic XP sound | Off | On/off |

Source and number inputs save on blur or Enter; other controls save immediately. Preferences are browser-local and separate from notification settings.

## Trigger and playback rules

- Only new `tool/result` events in the currently viewed session trigger a burst. Any tool qualifies, including failed results. Calls in other sessions or subagents do not trigger unless that session is currently viewed.
- Each trigger samples a uniform duration between the configured endpoints. An ongoing burst ends at `max(existingEnd, now + sampledDuration)`; triggers do not add parallel loops or queued orbs. Continuous activity can therefore exceed the single-sample duration maximum.
- Orb starts follow the configured frequency, at most one every 100 ms. Tails overlap naturally, with at most 32 active voices; the oldest voice is released if the cap is reached.
- Approval/question waits, agent idle/completion, switching sessions, disabling playback, changing/clearing the source and component teardown stop playback. Window blur/hiding also stops it by default. Returning does not replay missed events.
- Initial history, pagination and reconnect replacements never trigger XP. Delayed timers drop missed opportunities rather than catching up.

Each sound uses the same sample and a playback rate of `0.9 + (Math.random() - Math.random()) * 0.35`: approximately 0.55–1.25 with a triangular distribution centered at 0.9. Playback rate changes pitch and duration together; HTMLAudio fallback disables pitch preservation. There is no musical scale, rising melody or forced repeat avoidance.

These rules reproduce the checked Java implementation ([client source, 1.20.3-pre1](https://raw.githubusercontent.com/mahtomedi/minecraft/main/src/main/java/net/minecraft/client/multiplayer/ClientPacketListener.java), [pickup cooldown](https://raw.githubusercontent.com/mahtomedi/minecraft/main/src/main/java/net/minecraft/world/entity/ExperienceOrb.java), [single-sample sound declaration, 1.9.1](https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.9.1/assets/minecraft/sounds.json)), not every Minecraft version. Mapping tool results to virtual orbs is plugin-specific and is not a measurement of task success. Gain 0.1 does not guarantee the same perceived loudness as the game.

## Packaging

Requires DSH 0.2.1-rc.2 or later. The child package lives under `components/xp`, is declared as workspace dependency `dsh-chime-xp`, and ships through `bundledDependencies`; no separate publication or download is required. Run `pnpm install` before local development to establish its workspace link. Loader mounts the package name, not a filesystem path. Exported `locale/en.json` and `locale/zh.json` supply display titles and descriptions.

The existing row ID and storage key are unchanged. After updating an older path-based entry, disable and re-enable dsh-chime on the plugin page to recompose, then reopen the component configuration. Neither a DSH restart nor re-entering audio settings is needed.

`node build.mjs` produces both notification and XP host/client artifacts. Building does not edit a DSH profile or restart any service. An installed linked checkout still needs its composition status confirmed in the plugin page.
