import { readFileSync } from 'node:fs';

// Loaded lazily: non-Windows hosts and unrelated asset handlers do not read the helper.
let script;

/** Only a validated internal PID is interpolated; the script is a separate package asset. */
export function buildWindowsRaiseScript(desktopPid) {
  if (!Number.isInteger(desktopPid) || desktopPid <= 0 || desktopPid > 2147483647) {
    throw new TypeError('desktopPid must be a positive Windows process ID');
  }
  script ??= readFileSync(new URL('./windows-raise.ps1', import.meta.url), 'utf8');
  return '$desktopPid = ' + desktopPid + '\n' + script;
}
