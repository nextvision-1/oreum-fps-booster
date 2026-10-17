// 시작 프로그램: 레지스트리 Run 키 + 시작 폴더. 켜기/끄기는 작업 관리자와 같은 StartupApproved 값을 쓴다.

const APPROVED = '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\';
const STARTUP_SRCS = [
  { src: 'HKCU', label: '현재 사용자', run: 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', ap: 'Registry::HKEY_CURRENT_USER' + APPROVED + 'Run' },
  { src: 'HKLM', label: '모든 사용자', run: 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', ap: 'Registry::HKEY_LOCAL_MACHINE' + APPROVED + 'Run' },
  { src: 'HKLM32', label: '모든 사용자', run: 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', ap: 'Registry::HKEY_LOCAL_MACHINE' + APPROVED + 'Run32' },
  { src: 'UFOLDER', label: '현재 사용자 · 시작 폴더', dir: 'Startup', ap: 'Registry::HKEY_CURRENT_USER' + APPROVED + 'StartupFolder' },
  { src: 'CFOLDER', label: '모든 사용자 · 시작 폴더', dir: 'CommonStartup', ap: 'Registry::HKEY_LOCAL_MACHINE' + APPROVED + 'StartupFolder' },
];

const STARTUP_LIST_SCRIPT = String.raw`
$res = @()
$wsh = $null
foreach ($s in @($A.srcs)) {
  $entries = @()
  if ($s.run) {
    if (-not (Test-Path -LiteralPath $s.run)) { continue }
    $k = Get-Item -LiteralPath $s.run
    foreach ($n in $k.GetValueNames()) { if ($n -ne '') { $entries += ,@{ name = $n; cmd = [string]$k.GetValue($n) } } }
  } else {
    $d = [Environment]::GetFolderPath($s.dir)
    if (-not $d -or -not (Test-Path -LiteralPath $d)) { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $d -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' })) {
      $cmd = $f.FullName
      if ($f.Extension -eq '.lnk') {
        try { if (-not $wsh) { $wsh = New-Object -ComObject WScript.Shell }; $l = $wsh.CreateShortcut($f.FullName); if ($l.TargetPath) { $cmd = ($l.TargetPath + ' ' + $l.Arguments).Trim() } } catch {}
      }
      $entries += ,@{ name = $f.Name; cmd = $cmd }
    }
  }
  foreach ($e in $entries) {
    $en = $true
    $a = RG $s.ap $e.name
    if ($a.exists -and $a.kind -eq 'Binary') { $b = [Convert]::FromBase64String($a.value); if ($b.Length -gt 0 -and ($b[0] % 2) -eq 1) { $en = $false } }
    $res += ,@{ src = $s.src; label = $s.label; name = $e.name; cmd = $e.cmd; enabled = $en }
  }
}
Emit @{ items = $res }
`;

const STARTUP_SET_SCRIPT = String.raw`
$b = New-Object byte[] 12
if ($A.enabled) { $b[0] = 2 } else { $b[0] = 3; [BitConverter]::GetBytes([DateTime]::Now.ToFileTime()).CopyTo($b, 4) }
RS $A.ap $A.name 'Binary' ([Convert]::ToBase64String($b))
Emit @{ ok = $true }
`;

module.exports = { STARTUP_SRCS, STARTUP_LIST_SCRIPT, STARTUP_SET_SCRIPT };
