// 정밀 시스템 검사 스크립트
// 결과: { group, name, status: ok|warn|bad|info, value, advice, fix: {type: tweak|page|action, id} }
const CHECK_SCRIPT = String.raw`
$script:R = @()
function Add($group, $name, $status, $value, $advice, $fix) {
  $script:R += ,@{ group = $group; name = $name; status = $status; value = [string]$value; advice = [string]$advice; fix = $fix }
}
function Fx($type, $id) { return @{ type = $type; id = $id } }

$os = $null; try { $os = Get-CimInstance Win32_OperatingSystem } catch {}

# ───── 시스템 ─────
try {
  $b = [int]$os.BuildNumber
  if ($b -lt 18362) { Add '시스템' 'Windows 버전' 'warn' ($os.Caption + ' ' + $b) 'Windows 10 1903 이상으로 업데이트하세요.' $null }
  else { Add '시스템' 'Windows 버전' 'ok' ($os.Caption + ' (빌드 ' + $b + ')') '' $null }
} catch { Add '시스템' 'Windows 버전' 'info' '확인 불가' '' $null }

try {
  $up = (Get-Date) - $os.LastBootUpTime
  $txt = ('{0}일 {1}시간' -f $up.Days, $up.Hours)
  if ($up.TotalDays -gt 7) { Add '시스템' '연속 가동 시간' 'warn' $txt '일주일 넘게 재부팅하지 않았습니다. 재부팅하면 메모리 누수·쌓인 업데이트가 정리됩니다.' $null }
  else { Add '시스템' '연속 가동 시간' 'ok' $txt '' $null }
} catch {}

try {
  $p = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
  $q = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
  if ((Test-Path -LiteralPath $p) -or (Test-Path -LiteralPath $q)) { Add '시스템' '보류 중인 재부팅' 'warn' '재부팅 필요' '업데이트 설치를 마치려면 재부팅이 필요합니다. 게임 전에 재부팅하세요.' $null }
  else { Add '시스템' '보류 중인 재부팅' 'ok' '없음' '' $null }
} catch {}

try {
  $hf = Get-HotFix -ErrorAction Stop | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
  $days = [int]((Get-Date) - $hf.InstalledOn).TotalDays
  if ($days -gt 60) { Add '시스템' '최근 Windows 업데이트' 'warn' ($days.ToString() + '일 전') '두 달 넘게 업데이트가 없습니다. 보안·드라이버 호환을 위해 업데이트하세요.' $null }
  else { Add '시스템' '최근 Windows 업데이트' 'ok' ($days.ToString() + '일 전 (' + $hf.HotFixID + ')') '' $null }
} catch { Add '시스템' '최근 Windows 업데이트' 'info' '확인 불가' '' $null }

try {
  $bad = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -ne 0 })
  if ($bad.Count -gt 0) { Add '시스템' '장치 관리자 오류' 'warn' ($bad.Count.ToString() + '개: ' + ((@($bad | Select-Object -First 3 | ForEach-Object { $_.Name })) -join ', ')) '드라이버가 없거나 오류인 장치가 있습니다. 장치 관리자에서 드라이버를 설치·업데이트하세요.' $null }
  else { Add '시스템' '장치 관리자 오류' 'ok' '없음' '' $null }
} catch {}

try {
  $cs = Get-CimInstance Win32_ComputerSystem
  if ($cs.AutomaticManagedPagefile) { Add '시스템' '가상 메모리' 'ok' '시스템 자동 관리' '' $null }
  else { Add '시스템' '가상 메모리' 'warn' '수동 설정됨' '페이지 파일이 수동으로 잡혀 있습니다. 너무 작으면 게임이 튕길 수 있어 "자동 관리"를 권장합니다.' $null }
} catch {}

# ───── 메모리·디스크 ─────
try {
  $tot = [double]$os.TotalVisibleMemorySize / 1MB
  $txt = ('{0:N1} GB' -f $tot)
  if ($tot -lt 7.5) { Add '메모리·디스크' 'RAM 용량' 'bad' $txt '최신 게임은 16GB 이상을 권장합니다. 램 증설을 고려하세요.' $null }
  elseif ($tot -lt 15) { Add '메모리·디스크' 'RAM 용량' 'warn' $txt '8GB는 게임+디스코드+브라우저 동시 사용 시 부족할 수 있습니다. 16GB 권장.' $null }
  else { Add '메모리·디스크' 'RAM 용량' 'ok' $txt '' $null }
  $used = 1 - ([double]$os.FreePhysicalMemory / [double]$os.TotalVisibleMemorySize)
  $txt2 = ('{0:P0} 사용 중' -f $used)
  if ($used -gt 0.85) { Add '메모리·디스크' '현재 메모리 사용률' 'warn' $txt2 '메모리를 많이 쓰는 중입니다. 브라우저 탭을 닫거나 메모리 정리를 실행하세요.' (Fx 'action' 'trimMemory') }
  else { Add '메모리·디스크' '현재 메모리 사용률' 'ok' $txt2 '' $null }
} catch {}

try {
  $d = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
  $pct = [double]$d.FreeSpace / [double]$d.Size
  $txt = ('{0:N1} GB 남음 ({1:P0})' -f ($d.FreeSpace / 1GB), $pct)
  if ($pct -lt 0.10) { Add '메모리·디스크' ('시스템 드라이브 여유 공간 (' + $env:SystemDrive + ')') 'bad' $txt '여유 공간이 10% 미만이면 업데이트·가상 메모리·셰이더 캐시가 제대로 동작하지 않습니다.' (Fx 'page' 'cleaner') }
  elseif ($pct -lt 0.20) { Add '메모리·디스크' ('시스템 드라이브 여유 공간 (' + $env:SystemDrive + ')') 'warn' $txt '여유 공간을 20% 이상 유지하는 것이 좋습니다.' (Fx 'page' 'cleaner') }
  else { Add '메모리·디스크' ('시스템 드라이브 여유 공간 (' + $env:SystemDrive + ')') 'ok' $txt '' $null }
} catch {}

try {
  foreach ($pd in @(Get-PhysicalDisk -ErrorAction Stop)) {
    $nm = $pd.FriendlyName + ' (' + $pd.MediaType + ')'
    if ($pd.HealthStatus -ne 'Healthy') { Add '메모리·디스크' ('디스크 상태: ' + $pd.FriendlyName) 'bad' ($pd.HealthStatus.ToString()) '디스크 이상 징후가 있습니다. 중요한 파일을 즉시 백업하세요.' $null }
    elseif ($pd.MediaType -eq 'HDD') { Add '메모리·디스크' ('디스크 상태: ' + $pd.FriendlyName) 'warn' ('정상 · HDD') 'HDD는 게임 로딩·텍스처 스트리밍이 느립니다. 게임은 SSD에 설치하세요.' $null }
    else { Add '메모리·디스크' ('디스크 상태: ' + $pd.FriendlyName) 'ok' ('정상 · ' + $pd.MediaType) '' $null }
  }
} catch { Add '메모리·디스크' '디스크 상태' 'info' '확인 불가' '' $null }

try {
  $v = Get-CimInstance Win32_Volume -Filter ("DriveLetter='" + $env:SystemDrive + "'")
  if ($v.DirtyBitSet) { Add '메모리·디스크' '파일 시스템 오류 표시' 'bad' '오류 표시됨' '다음 부팅 때 디스크 검사가 필요합니다. 관리자 명령 프롬프트에서 chkdsk C: /f 를 예약하세요.' $null }
  else { Add '메모리·디스크' '파일 시스템 오류 표시' 'ok' '정상' '' $null }
} catch {}

try {
  $t = Get-ChildItem -LiteralPath $env:TEMP -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum
  $gb = [double]$t.Sum / 1GB
  if ($gb -gt 1) { Add '메모리·디스크' '임시 파일' 'warn' ('{0:N1} GB' -f $gb) '임시 파일이 많이 쌓였습니다.' (Fx 'page' 'cleaner') }
  else { Add '메모리·디스크' '임시 파일' 'ok' ('{0:N0} MB' -f ($t.Sum / 1MB)) '' $null }
} catch {}

# ───── 그래픽·게임 ─────
try {
  foreach ($vc in @(Get-CimInstance Win32_VideoController)) {
    if ($vc.Name -match 'Remote|Virtual|Parsec|Meta') { continue }
    if ($vc.Name -match 'Basic Display|기본 디스플레이') { Add '그래픽·게임' '그래픽 드라이버' 'bad' $vc.Name '그래픽 드라이버가 설치되지 않았습니다. 제조사(NVIDIA/AMD/Intel) 사이트에서 설치하세요.' $null; continue }
    $age = [int]((Get-Date) - $vc.DriverDate).TotalDays
    $txt = $vc.Name + ' · ' + $vc.DriverVersion + ' (' + $age + '일 전)'
    if ($age -gt 365) { Add '그래픽·게임' '그래픽 드라이버' 'bad' $txt '1년 넘은 드라이버입니다. 최신 게임 최적화·버그 수정이 빠져 있습니다.' $null }
    elseif ($age -gt 180) { Add '그래픽·게임' '그래픽 드라이버' 'warn' $txt '6개월 넘은 드라이버입니다. 최신 버전으로 업데이트를 권장합니다.' $null }
    else { Add '그래픽·게임' '그래픽 드라이버' 'ok' $txt '' $null }
    $cur = [int]$vc.CurrentRefreshRate; $max = [int]$vc.MaxRefreshRate
    if ($cur -gt 0) {
      if ($max -gt $cur -and $cur -le 60) { Add '그래픽·게임' '모니터 주사율' 'warn' ($cur.ToString() + 'Hz (최대 ' + $max + 'Hz)') '모니터가 더 높은 주사율을 지원하는데 60Hz로 설정되어 있을 수 있습니다. 설정 > 디스플레이 > 고급 디스플레이에서 확인하세요.' $null }
      else { Add '그래픽·게임' '모니터 주사율' 'ok' ($cur.ToString() + 'Hz') '' $null }
    }
  }
} catch {}

try {
  $line = (PG).line
  if ($line -match 'Oreum FPS|8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c|e9a42b02-d5df-448d-aa00-03f14749eb61') { Add '그래픽·게임' '전원 계획' 'ok' '고성능' '' $null }
  else { Add '그래픽·게임' '전원 계획' 'warn' '균형 조정/절전' '게임용으로는 최고 성능 전원 계획을 권장합니다.' (Fx 'tweak' 'powerplan') }
} catch {}

try {
  $g = RG 'Registry::HKEY_CURRENT_USER\Software\Microsoft\GameBar' 'AutoGameModeEnabled'
  if ($g.exists -and [int]$g.value -eq 0) { Add '그래픽·게임' '게임 모드' 'warn' '꺼짐' '게임 모드를 켜면 게임 중 백그라운드 작업이 억제됩니다.' (Fx 'tweak' 'gamemode') }
  else { Add '그래픽·게임' '게임 모드' 'ok' '켜짐' '' $null }
  $dv = RG 'Registry::HKEY_CURRENT_USER\System\GameConfigStore' 'GameDVR_Enabled'
  if ($dv.exists -and [int]$dv.value -eq 0) { Add '그래픽·게임' '백그라운드 녹화' 'ok' '꺼짐' '' $null }
  else { Add '그래픽·게임' '백그라운드 녹화' 'warn' '켜짐' '백그라운드 녹화가 GPU 인코더와 디스크를 계속 사용합니다.' (Fx 'tweak' 'gamedvr') }
  $hs = RG 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' 'HwSchMode'
  if ($hs.exists -and [int]$hs.value -eq 2) { Add '그래픽·게임' 'GPU 스케줄링(HAGS)' 'ok' '켜짐' '' $null }
  else { Add '그래픽·게임' 'GPU 스케줄링(HAGS)' 'info' '꺼짐' '최신 GPU라면 켜서 CPU 부담을 줄일 수 있습니다.' (Fx 'tweak' 'hags') }
  $ms = RG 'Registry::HKEY_CURRENT_USER\Control Panel\Mouse' 'MouseSpeed'
  if ($ms.exists -and [string]$ms.value -eq '0') { Add '그래픽·게임' '마우스 가속' 'ok' '꺼짐' '' $null }
  else { Add '그래픽·게임' '마우스 가속' 'warn' '켜짐' '마우스 가속이 켜져 있으면 에임이 일정하지 않습니다.' (Fx 'tweak' 'mouse') }
} catch {}

try {
  $dg = Get-CimInstance -Namespace 'root\Microsoft\Windows\DeviceGuard' -ClassName Win32_DeviceGuard -ErrorAction Stop
  if (@($dg.SecurityServicesRunning) -contains 2) { Add '그래픽·게임' '메모리 무결성(HVCI)' 'info' '켜짐' '보안 기능이지만 CPU에 따라 FPS가 5~15% 낮아질 수 있습니다. 끄기 전 보안 영향을 확인하세요.' (Fx 'tweak' 'vbs') }
  else { Add '그래픽·게임' '메모리 무결성(HVCI)' 'ok' '꺼짐' '' $null }
} catch {}

# ───── 보안 ─────
try {
  $mp = Get-MpComputerStatus -ErrorAction Stop
  $other = @(Get-CimInstance -Namespace 'root\SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | Where-Object { $_.displayName -notmatch 'Defender' })
  if ($mp.RealTimeProtectionEnabled) { Add '보안' '실시간 바이러스 보호' 'ok' 'Microsoft Defender 켜짐' '' $null }
  elseif ($other.Count -gt 0) { Add '보안' '실시간 바이러스 보호' 'ok' ($other[0].displayName) '' $null }
  else { Add '보안' '실시간 바이러스 보호' 'bad' '꺼짐' '백신 실시간 보호가 꺼져 있습니다. Windows 보안에서 켜세요.' $null }
  if ($mp.RealTimeProtectionEnabled -and $mp.AntivirusSignatureAge -gt 7) { Add '보안' '백신 정의 업데이트' 'warn' ($mp.AntivirusSignatureAge.ToString() + '일 전') '백신 정의가 오래되었습니다. Windows 업데이트를 실행하세요.' $null }
} catch { Add '보안' '실시간 바이러스 보호' 'info' '확인 불가' '' $null }

try {
  $off = @(Get-NetFirewallProfile -ErrorAction Stop | Where-Object { -not $_.Enabled })
  if ($off.Count -gt 0) { Add '보안' '방화벽' 'warn' ((@($off | ForEach-Object { $_.Name })) -join ', ') '일부 네트워크 프로필의 방화벽이 꺼져 있습니다.' $null }
  else { Add '보안' '방화벽' 'ok' '모두 켜짐' '' $null }
} catch {}

try {
  $uac = RG 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' 'EnableLUA'
  if ($uac.exists -and [int]$uac.value -eq 0) { Add '보안' '사용자 계정 컨트롤(UAC)' 'warn' '꺼짐' 'UAC가 꺼져 있으면 악성 프로그램이 관리자 권한을 쉽게 얻습니다.' $null }
  else { Add '보안' '사용자 계정 컨트롤(UAC)' 'ok' '켜짐' '' $null }
} catch {}

try {
  $sb = Confirm-SecureBootUEFI -ErrorAction Stop
  if ($sb) { Add '보안' '보안 부팅' 'ok' '켜짐' '' $null }
  else { Add '보안' '보안 부팅' 'info' '꺼짐' 'Windows 11에서 발로란트(뱅가드) 등 일부 안티치트는 보안 부팅·TPM 2.0이 필요합니다. BIOS에서 켤 수 있습니다.' $null }
} catch { Add '보안' '보안 부팅' 'info' '레거시 BIOS 또는 확인 불가' '' $null }

# ───── 네트워크·시작 ─────
try {
  $ad = @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' })
  foreach ($a in $ad) {
    $wifi = ($a.InterfaceDescription -match 'Wi-?Fi|Wireless|802\.11|무선') -or ($a.NdisPhysicalMedium -eq 9)
    if ($wifi) { Add '네트워크·시작' ('네트워크 연결: ' + $a.Name) 'info' ('무선 · ' + $a.LinkSpeed) '무선은 핑이 튀기 쉽습니다. 가능하면 유선 랜을 권장합니다.' $null }
    else { Add '네트워크·시작' ('네트워크 연결: ' + $a.Name) 'ok' ('유선 · ' + $a.LinkSpeed) '' $null }
  }
} catch {}

try {
  $pings = @(Test-Connection -ComputerName 8.8.8.8 -Count 4 -ErrorAction Stop | ForEach-Object { $_.ResponseTime })
  $avg = [int](($pings | Measure-Object -Average).Average)
  $jit = [int](($pings | Measure-Object -Maximum).Maximum - ($pings | Measure-Object -Minimum).Minimum)
  $txt = ('평균 {0}ms · 흔들림 {1}ms' -f $avg, $jit)
  if ($avg -gt 80 -or $jit -gt 30) { Add '네트워크·시작' '인터넷 응답 속도' 'warn' $txt '핑이 높거나 불안정합니다. 다운로드 중인 프로그램을 확인하고 유선 연결을 권장합니다.' $null }
  else { Add '네트워크·시작' '인터넷 응답 속도' 'ok' $txt '' $null }
} catch { Add '네트워크·시작' '인터넷 응답 속도' 'warn' '응답 없음' '인터넷 연결을 확인하세요.' (Fx 'action' 'flushDns') }

try {
  $n = 0
  foreach ($p in @('Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run', 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run')) {
    if (Test-Path -LiteralPath $p) { $n += @((Get-Item -LiteralPath $p).GetValueNames() | Where-Object { $_ -ne '' }).Count }
  }
  if ($n -gt 10) { Add '네트워크·시작' '시작 프로그램' 'warn' ($n.ToString() + '개') '부팅 시 자동 실행되는 프로그램이 많습니다. 필요 없는 것을 끄세요.' (Fx 'page' 'startup') }
  else { Add '네트워크·시작' '시작 프로그램' 'ok' ($n.ToString() + '개') '' $null }
} catch {}

Emit @{ results = $script:R }
`;

module.exports = { CHECK_SCRIPT };
