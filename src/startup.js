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

// ───── 예약 작업: 로그온·부팅 때 실행되는 타사 작업 (\Microsoft\ 아래는 제외) ─────
const TASKS_LIST_SCRIPT = String.raw`
$res = @()
foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskPath -notlike '\Microsoft\*' })) {
  $trig = (@($t.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ' ')
  if ($trig -notmatch 'Logon|Boot') { continue }
  $act = (@($t.Actions | Where-Object { $_.Execute } | ForEach-Object { ([string]$_.Execute + ' ' + [string]$_.Arguments).Trim() }) -join ' ; ')
  $res += ,@{ src = 'TASK'; label = '예약 작업'; name = $t.TaskName; path = $t.TaskPath; cmd = $act; enabled = ([string]$t.State -ne 'Disabled') }
}
Emit @{ items = $res }
`;

const TASK_SET_SCRIPT = String.raw`
$t = Get-ScheduledTask -TaskPath $A.path -TaskName $A.name -ErrorAction Stop
if ($t.TaskPath -like '\Microsoft\*') { throw 'Windows 기본 예약 작업은 바꿀 수 없습니다.' }
if ($A.enabled) { Enable-ScheduledTask -InputObject $t -ErrorAction Stop | Out-Null } else { Disable-ScheduledTask -InputObject $t -ErrorAction Stop | Out-Null }
Emit @{ ok = $true }
`;

// ───── 서비스: Windows 폴더 밖에 설치된 타사 서비스 중 자동 시작인 것 ─────
// 보안·드라이버·장치 관련 서비스는 목록에서 아예 뺀다. 끌 때는 "사용 안 함"이 아니라 "수동"으로 바꿔
// 프로그램이 필요할 때 직접 시작할 수 있게 한다.
const SVC_LIB = String.raw`
function SvcThirdParty($s) {
  $p = [string]$s.PathName
  if (-not $p) { return $false }
  $win = $env:WINDIR.ToLower()
  if ($p.ToLower().Replace('"', '').StartsWith($win)) { return $false }
  $txt = ($s.Name + ' ' + $s.DisplayName + ' ' + $p)
  if ($txt -match 'Defender|Security|Antivirus|AntiMalware|Firewall|V3 |AhnLab|ESTsoft|ALYac|Norton|McAfee|Kaspersky|Avast|AVG|Bitdefender|ESET|Malwarebytes') { return $false }
  if ($txt -match 'NVDisplay|NVIDIA Display|Graphics|igfx|AMD External|amdfendr|Radeon|Audio|Realtek|Dolby|DTS|Waves|Bluetooth|Synaptics|ELAN|Touchpad|Precision|Wacom|Intel\(R\) (Dynamic|Platform|Management)|Thunderbolt|Wi-?Fi|Wireless|Killer') { return $false }
  # 원격 접속 서비스: 끄면 원격으로 쓰던 PC 에 다시 들어갈 수 없게 된다
  if ($txt -match 'chromoting|Remote Desktop|원격 데스크톱|TeamViewer|AnyDesk|Parsec|RustDesk|Splashtop|RealVNC|TightVNC|UltraVNC|LogMeIn|Sunshine') { return $false }
  return $true
}
`;

const SVC_LIST_SCRIPT = SVC_LIB + String.raw`
$known = @($A.known)
$res = @()
foreach ($s in @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue)) {
  $auto = ([string]$s.StartMode -eq 'Auto')
  if (-not $auto -and -not ($known -contains $s.Name)) { continue }
  if (-not (SvcThirdParty $s)) { continue }
  $res += ,@{ src = 'SVC'; label = '서비스'; name = $s.Name; display = $s.DisplayName; cmd = [string]$s.PathName; enabled = $auto }
}
Emit @{ items = $res }
`;

// $A.name, $A.enabled, $A.start(켤 때 되돌릴 시작 유형), $A.delayed
const SVC_SET_SCRIPT = SVC_LIB + String.raw`
$s = Get-CimInstance Win32_Service -Filter ("Name='" + ([string]$A.name).Replace("'", "''") + "'") -ErrorAction Stop
if (-not $s) { throw '서비스를 찾을 수 없습니다.' }
if (-not (SvcThirdParty $s)) { throw '이 서비스는 바꿀 수 없습니다 (Windows·보안·장치 관련).' }
$before = SG $A.name
if ($A.enabled) { SS $A.name ([int]$A.start) ([int]$A.delayed) } else { SS $A.name 3 0 }
Emit @{ ok = $true; before = $before }
`;

module.exports = { STARTUP_SRCS, STARTUP_LIST_SCRIPT, STARTUP_SET_SCRIPT, TASKS_LIST_SCRIPT, TASK_SET_SCRIPT, SVC_LIST_SCRIPT, SVC_SET_SCRIPT };
