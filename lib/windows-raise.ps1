$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$attempts = 0
$protocolRequested = $false
$restoreCycle = $false
$initialState = 'unknown'
$timer = [Diagnostics.Stopwatch]::StartNew()
function Finish-Raise([bool]$activated, [string]$reason) {
  $result = [ordered]@{ activated = $activated; reason = $reason; attempts = $attempts; initialState = $initialState; protocolRequested = $protocolRequested; restoreCycle = $restoreCycle; elapsedMs = $timer.ElapsedMilliseconds }
  $json = $result | ConvertTo-Json -Compress
  try { Add-Content -Path (Join-Path $env:TEMP 'dsh-chime-raise.log') -Value ((Get-Date -Format o) + ' ' + $json) } catch {}
  Write-Output $json
}
try {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DshChimeRaise {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref int length);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static string ExecutablePath(uint pid) {
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      var path = new StringBuilder(32768); int length = path.Capacity;
      if (!QueryFullProcessImageNameW(process, 0, path, ref length)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      return path.ToString();
    } finally { CloseHandle(process); }
  }
  public static uint LastInput() {
    LASTINPUTINFO info = new LASTINPUTINFO(); info.cbSize = (uint)Marshal.SizeOf(info);
    return GetLastInputInfo(ref info) ? info.dwTime : 0;
  }
  public static bool Owned(IntPtr h, uint expectedPid) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    return IsWindow(h) && pid == expectedPid;
  }
  public static IntPtr[] Find(uint expectedPid) {
    var windows = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr unused) {
      if (!Owned(h, expectedPid) || GetWindow(h, 4) != IntPtr.Zero) return true;
      var cls = new StringBuilder(256); GetClassNameW(h, cls, cls.Capacity);
      var title = new StringBuilder(512); GetWindowTextW(h, title, title.Capacity);
      if (cls.ToString() == "Chrome_WidgetWin_1" && title.Length > 0 && !title.ToString().StartsWith("DevTools")) windows.Add(h);
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
}
'@
$owner = [Diagnostics.Process]::GetProcessById($desktopPid)
# A standalone web host's parent is not necessarily Desktop: never launch an arbitrary parent.
if ($owner.ProcessName -ne 'DeepSeek Harness') { Finish-Raise $false 'not-found'; return }
$windows = @([DshChimeRaise]::Find([uint32]$desktopPid))
if ($windows.Count -eq 0) { Finish-Raise $false 'not-found'; return }
if ($windows.Count -ne 1) { Finish-Raise $false 'ambiguous'; return }
$target = $windows[0]
$initialState = if (-not [DshChimeRaise]::IsWindowVisible($target)) { 'hidden' } elseif ([DshChimeRaise]::IsIconic($target)) { 'minimized' } else { 'normal' }
if ($initialState -eq 'normal' -and [DshChimeRaise]::GetForegroundWindow() -eq $target) { Finish-Raise $true 'already-foreground'; return }
$lastInput = [DshChimeRaise]::LastInput()
$originalForeground = [DshChimeRaise]::GetForegroundWindow()
if ($initialState -eq 'minimized') {
  [void][DshChimeRaise]::PostMessage($target, 0x0112, [IntPtr]0xF120, [IntPtr]::Zero)
}
# Try the ordinary foreground API once. Hidden windows must be shown by Electron, never Win32.
if ($initialState -ne 'hidden') {
  $attempts++
  [void][DshChimeRaise]::SetForegroundWindow($target)
  Start-Sleep -Milliseconds 80
  if ([DshChimeRaise]::GetForegroundWindow() -eq $target -and -not [DshChimeRaise]::IsIconic($target)) { Finish-Raise $true 'activated'; return }
}
if ($lastInput -ne 0 -and [DshChimeRaise]::LastInput() -ne $lastInput -and [DshChimeRaise]::GetForegroundWindow() -ne $originalForeground -and [DshChimeRaise]::GetForegroundWindow() -ne $target) { Finish-Raise $false 'interrupted'; return }
# Route through Desktop's single-instance handler: restore/show/focus keeps Electron state in sync.
# The Host runs as Node inside Electron. Inheriting these variables turns a second Desktop launch
# into a Node CLI (and dsh://open becomes a nonexistent script), not a single-instance request.
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = [DshChimeRaise]::ExecutablePath([uint32]$desktopPid)
$start.Arguments = 'dsh://open'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
foreach ($key in @('ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE')) { $start.EnvironmentVariables.Remove($key) }
try {
  $launched = [Diagnostics.Process]::Start($start)
  $protocolRequested = $true
  $launched.Dispose()
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  Finish-Raise $false 'protocol-error'; return
}
$deadline = $timer.ElapsedMilliseconds + 2500
for ($i = 0; $i -lt 20 -and $timer.ElapsedMilliseconds -lt $deadline; $i++) {
  if (-not [DshChimeRaise]::Owned($target, [uint32]$desktopPid)) { Finish-Raise $false 'not-found'; return }
  if ([DshChimeRaise]::GetForegroundWindow() -eq $target -and [DshChimeRaise]::IsWindowVisible($target) -and -not [DshChimeRaise]::IsIconic($target)) { Finish-Raise $true 'activated'; return }
  # Do not steal focus later if a new input event has superseded this notification click.
  if ($lastInput -ne 0 -and [DshChimeRaise]::LastInput() -ne $lastInput -and [DshChimeRaise]::GetForegroundWindow() -ne $originalForeground -and [DshChimeRaise]::GetForegroundWindow() -ne $target) { Finish-Raise $false 'interrupted'; return }
  # Bounded retries only after Electron has made the window visible; no Alt injection/input attachment.
  if ($i -in @(3, 8, 13) -and [DshChimeRaise]::IsWindowVisible($target) -and -not [DshChimeRaise]::IsIconic($target)) {
    $attempts++
    [void][DshChimeRaise]::SetForegroundWindow($target)
  }
  Start-Sleep -Milliseconds 100
  if ($initialState -eq 'normal' -and $i -ge 7) { break }
}
# A single minimize/restore cycle is the last resort for a visible, non-minimized window.
# These system commands keep Electron informed and preserve the prior normal/maximized state.
if ($initialState -eq 'normal' -and [DshChimeRaise]::Owned($target, [uint32]$desktopPid) -and [DshChimeRaise]::IsWindowVisible($target)) {
  if ($lastInput -ne 0 -and [DshChimeRaise]::LastInput() -ne $lastInput -and [DshChimeRaise]::GetForegroundWindow() -ne $originalForeground -and [DshChimeRaise]::GetForegroundWindow() -ne $target) { Finish-Raise $false 'interrupted'; return }
  $restoreCycle = $true
  [void][DshChimeRaise]::PostMessage($target, 0x0112, [IntPtr]0xF020, [IntPtr]::Zero)
  try {
    for ($j = 0; $j -lt 5 -and -not [DshChimeRaise]::IsIconic($target); $j++) { Start-Sleep -Milliseconds 30 }
  } finally {
    # Always restore, including when waiting is interrupted; never leave the window minimized.
    [void][DshChimeRaise]::PostMessage($target, 0x0112, [IntPtr]0xF120, [IntPtr]::Zero)
  }
  for ($j = 0; $j -lt 8; $j++) {
    if ([DshChimeRaise]::GetForegroundWindow() -eq $target -and -not [DshChimeRaise]::IsIconic($target)) { Finish-Raise $true 'activated'; return }
    if ($lastInput -ne 0 -and [DshChimeRaise]::LastInput() -ne $lastInput -and [DshChimeRaise]::GetForegroundWindow() -ne $originalForeground -and [DshChimeRaise]::GetForegroundWindow() -ne $target) { Finish-Raise $false 'interrupted'; return }
    Start-Sleep -Milliseconds 60
  }
}
$reason = if (-not [DshChimeRaise]::IsWindowVisible($target)) { 'hidden' } elseif ([DshChimeRaise]::IsIconic($target)) { 'restore-pending' } else { 'foreground-denied' }
Finish-Raise $false $reason
} catch {
  Finish-Raise $false 'helper-error'
  [Console]::Error.WriteLine($_.Exception.Message)
}
