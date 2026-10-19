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

try {
  if ([string]$os.OSArchitecture -notmatch '64') { Add '시스템' 'Windows 비트' 'bad' $os.OSArchitecture '32비트 Windows 는 메모리를 4GB까지만 씁니다. 64비트로 다시 설치하는 것을 권장합니다.' $null }
  else { Add '시스템' 'Windows 비트' 'ok' $os.OSArchitecture '' $null }
} catch {}

try {
  # 55c92734-... = Windows 제품의 ApplicationID
  $lic = @(Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f'" -ErrorAction Stop)
  if (@($lic | Where-Object { $_.LicenseStatus -eq 1 }).Count -gt 0) { Add '시스템' 'Windows 정품 인증' 'ok' '인증됨' '' $null }
  else { Add '시스템' 'Windows 정품 인증' 'warn' '인증 안 됨' '정품 인증이 안 되면 개인 설정이 제한되고 일부 업데이트를 받지 못할 수 있습니다.' $null }
} catch { Add '시스템' 'Windows 정품 인증' 'info' '확인 불가' '' $null }

try {
  $wu = SG 'wuauserv'
  if ($wu.exists -and [int]$wu.start -eq 4) { Add '시스템' 'Windows 업데이트 서비스' 'warn' '사용 안 함' '업데이트 서비스가 꺼져 있으면 보안 패치와 게임용 드라이버·DirectX 업데이트를 받지 못합니다.' $null }
  else { Add '시스템' 'Windows 업데이트 서비스' 'ok' '사용' '' $null }
} catch {}

try {
  $bios = Get-CimInstance Win32_BIOS
  if ($bios.ReleaseDate) {
    $txt = ([string]$bios.SMBIOSBIOSVersion + ' (' + $bios.ReleaseDate.ToString('yyyy-MM-dd') + ')')
    if (((Get-Date) - $bios.ReleaseDate).TotalDays -gt 1095) { Add '시스템' 'BIOS 버전' 'info' $txt '3년 넘은 BIOS 입니다. 메인보드·노트북 제조사 사이트에서 안정성·CPU 호환성 업데이트가 있는지 확인해 보세요.' $null }
    else { Add '시스템' 'BIOS 버전' 'ok' $txt '' $null }
  }
} catch {}

try {
  $hb = RG 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Session Manager\Power' 'HiberbootEnabled'
  if ($hb.exists -and [int]$hb.value -eq 1) { Add '시스템' '빠른 시작' 'info' '켜짐' '빠른 시작이 켜져 있으면 "시스템 종료" 뒤에도 커널이 새로 시작되지 않아 드라이버 문제가 남을 수 있습니다. 문제가 생기면 "다시 시작"을 쓰세요.' $null }
  else { Add '시스템' '빠른 시작' 'ok' '꺼짐' '' $null }
} catch {}

# ───── 안정성 (최근 이벤트 로그) ─────
function EvList($log, $provider, $ids, $days) {
  $f = @{ LogName = $log; StartTime = (Get-Date).AddDays(-1 * $days) }
  if ($provider) { $f.ProviderName = $provider }
  if ($ids) { $f.Id = $ids }
  # 일치하는 이벤트가 없으면 오류를 내므로 조용히 빈 목록으로
  return @(Get-WinEvent -FilterHashtable $f -MaxEvents 500 -ErrorAction SilentlyContinue)
}

try {
  $n = (EvList 'System' 'Microsoft-Windows-WER-SystemErrorReporting' @(1001) 30).Count
  if ($n -gt 0) { Add '안정성' '블루스크린 (최근 30일)' 'bad' ($n.ToString() + '회') '블루스크린이 발생했습니다. 그래픽·칩셋 드라이버 업데이트, 오버클럭·XMP 해제 후 재현되는지 확인하세요.' $null }
  else { Add '안정성' '블루스크린 (최근 30일)' 'ok' '없음' '' $null }
} catch {}

try {
  $n = (EvList 'System' 'Microsoft-Windows-Kernel-Power' @(41) 30).Count
  if ($n -gt 0) { Add '안정성' '비정상 종료 (최근 30일)' 'warn' ($n.ToString() + '회') '전원이 갑자기 꺼지거나 멈춰서 강제로 끈 기록입니다. 게임 중 꺼진다면 파워 용량·온도·오버클럭을 확인하세요.' $null }
  else { Add '안정성' '비정상 종료 (최근 30일)' 'ok' '없음' '' $null }
} catch {}

try {
  $n = (EvList 'System' 'Display' @(4101) 30).Count
  if ($n -gt 0) { Add '안정성' '그래픽 드라이버 멈춤 (최근 30일)' 'warn' ($n.ToString() + '회') '그래픽 드라이버가 응답을 멈췄다가 복구된 기록입니다(화면 깜빡임·게임 튕김). 드라이버 재설치나 GPU 오버클럭 해제를 권장합니다.' $null }
  else { Add '안정성' '그래픽 드라이버 멈춤 (최근 30일)' 'ok' '없음' '' $null }
} catch {}

try {
  $n = (EvList 'System' 'Microsoft-Windows-WHEA-Logger' $null 30).Count
  if ($n -gt 0) { Add '안정성' '하드웨어 오류 (WHEA, 최근 30일)' 'warn' ($n.ToString() + '회') 'CPU·메모리·PCIe 장치가 보고한 하드웨어 오류입니다. 오버클럭·언더볼트·XMP 설정이 불안정할 때 자주 나타납니다.' $null }
  else { Add '안정성' '하드웨어 오류 (WHEA, 최근 30일)' 'ok' '없음' '' $null }
} catch {}

try {
  $n = (EvList 'System' 'disk' @(7, 11, 51, 153) 30).Count
  if ($n -gt 0) { Add '안정성' '디스크 입출력 오류 (최근 30일)' 'bad' ($n.ToString() + '회') '디스크 읽기·쓰기 오류가 기록됐습니다. 디스크 고장 전조일 수 있으니 중요한 파일을 백업하고 케이블·디스크 상태를 확인하세요.' $null }
  else { Add '안정성' '디스크 입출력 오류 (최근 30일)' 'ok' '없음' '' $null }
} catch {}

try {
  $ev = EvList 'Application' 'Application Error' @(1000) 7
  if ($ev.Count -ge 5) {
    $apps = @($ev | ForEach-Object { [string]$_.Properties[0].Value } | Group-Object | Sort-Object Count -Descending | Select-Object -First 3 | ForEach-Object { $_.Name + ' ' + $_.Count + '회' }) -join ', '
    Add '안정성' '프로그램 충돌 (최근 7일)' 'warn' ($ev.Count.ToString() + '회 · ' + $apps) '같은 프로그램이 반복해서 튕긴다면 재설치하거나, 게임이라면 파일 무결성 검사를 실행하세요.' $null
  } else { Add '안정성' '프로그램 충돌 (최근 7일)' 'ok' ($ev.Count.ToString() + '회') '' $null }
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
      if ($max -gt $cur -and $cur -le 60) { Add '그래픽·게임' '모니터 주사율' 'warn' ($cur.ToString() + 'Hz (최대 ' + $max + 'Hz)') '모니터가 더 높은 주사율을 지원하는데 60Hz로 설정되어 있을 수 있습니다. 해결을 누르면 최대 주사율로 바꿉니다.' (Fx 'action' 'maxRefresh') }
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
    elseif ([int64]$a.Speed -gt 0 -and [int64]$a.Speed -lt 1000000000) { Add '네트워크·시작' ('네트워크 연결: ' + $a.Name) 'warn' ('유선 · ' + $a.LinkSpeed) '유선인데 1Gbps 미만으로 연결됐습니다. 랜선(CAT5e 이상)이나 공유기 포트·케이블 접촉을 확인하세요.' $null }
    else { Add '네트워크·시작' ('네트워크 연결: ' + $a.Name) 'ok' ('유선 · ' + $a.LinkSpeed) '' $null }
  }
} catch {}

try {
  # 하나라도 손실되면 예외가 나지 않도록 SilentlyContinue 로 받고, 받은 응답 수로 손실률을 계산
  $n = 10
  $pings = @(Test-Connection -ComputerName 8.8.8.8 -Count $n -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.ResponseTime })
  if (-not $pings.Count) { throw '응답 없음' }
  $avg = [int](($pings | Measure-Object -Average).Average)
  $jit = [int](($pings | Measure-Object -Maximum).Maximum - ($pings | Measure-Object -Minimum).Minimum)
  $txt = ('평균 {0}ms · 흔들림 {1}ms' -f $avg, $jit)
  if ($avg -gt 80 -or $jit -gt 30) { Add '네트워크·시작' '인터넷 응답 속도' 'warn' $txt '핑이 높거나 불안정합니다. 다운로드 중인 프로그램을 확인하고 유선 연결을 권장합니다.' $null }
  else { Add '네트워크·시작' '인터넷 응답 속도' 'ok' $txt '' $null }
  $loss = [int](($n - $pings.Count) * 100 / $n)
  if ($loss -ge 10) { Add '네트워크·시작' '패킷 손실' 'warn' ($loss.ToString() + '%') '패킷이 손실되면 게임에서 순간이동·버벅임이 생깁니다. 공유기 재시작, 유선 연결, 다른 기기의 다운로드를 확인하세요.' $null }
  else { Add '네트워크·시작' '패킷 손실' 'ok' ($loss.ToString() + '%') '' $null }
} catch { Add '네트워크·시작' '인터넷 응답 속도' 'warn' '응답 없음' '인터넷 연결을 확인하세요.' (Fx 'action' 'flushDns') }

try {
  $n = 0
  foreach ($p in @('Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run', 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run')) {
    if (Test-Path -LiteralPath $p) { $n += @((Get-Item -LiteralPath $p).GetValueNames() | Where-Object { $_ -ne '' }).Count }
  }
  if ($n -gt 10) { Add '네트워크·시작' '시작 프로그램' 'warn' ($n.ToString() + '개') '부팅 시 자동 실행되는 프로그램이 많습니다. 필요 없는 것을 끄세요.' (Fx 'page' 'startup') }
  else { Add '네트워크·시작' '시작 프로그램' 'ok' ($n.ToString() + '개') '' $null }
} catch {}

# ───── 추가 검사: 메모리·디스크 ─────
$laptop = $false
try { $laptop = @(Get-CimInstance Win32_Battery -ErrorAction Stop).Count -gt 0 } catch {}

try {
  $mods = @(Get-CimInstance Win32_PhysicalMemory)
  if ($mods.Count -eq 1) {
    $txt = ('1개 장착 (' + [math]::Round([double]$mods[0].Capacity / 1GB) + 'GB)')
    # 노트북 온보드 램은 1개로 보여도 듀얼 채널일 수 있어 참고로만
    if ($laptop) { Add '메모리·디스크' 'RAM 구성' 'info' $txt '노트북 온보드 램이 아니라면, 같은 용량 램 2개(듀얼 채널) 구성이 게임에 유리합니다.' $null }
    else { Add '메모리·디스크' 'RAM 구성' 'warn' $txt '램이 1개뿐이면 싱글 채널로 동작해 게임 FPS가 크게 떨어질 수 있습니다. 같은 용량 2개(듀얼 채널) 구성을 권장합니다.' $null }
  } elseif ($mods.Count -gt 1) { Add '메모리·디스크' 'RAM 구성' 'ok' ($mods.Count.ToString() + '개 장착') '' $null }
  $spd = [int](($mods | Measure-Object Speed -Maximum).Maximum)
  $cfg = [int](($mods | Measure-Object ConfiguredClockSpeed -Minimum).Minimum)
  if ($spd -gt 0 -and $cfg -gt 0) {
    if ($cfg -lt $spd) { Add '메모리·디스크' 'RAM 속도' 'warn' ($cfg.ToString() + ' MT/s (지원 ' + $spd + ')') '램이 지원 속도보다 느리게 동작 중입니다. BIOS 에서 XMP/EXPO 를 켜면 FPS 가 오를 수 있습니다.' $null }
    else { Add '메모리·디스크' 'RAM 속도' 'ok' ($cfg.ToString() + ' MT/s') '' $null }
  }
} catch {}

try {
  foreach ($ld in @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $_.DeviceID -ne $env:SystemDrive -and $_.Size -gt 0 })) {
    $pct = [double]$ld.FreeSpace / [double]$ld.Size
    $txt = ('{0:N1} GB 남음 ({1:P0})' -f ($ld.FreeSpace / 1GB), $pct)
    if ($pct -lt 0.10) { Add '메모리·디스크' ('여유 공간 (' + $ld.DeviceID + ')') 'warn' $txt '게임이 설치된 드라이브라면 업데이트·셰이더 캐시를 위해 10% 이상 비워 두세요.' $null }
    else { Add '메모리·디스크' ('여유 공간 (' + $ld.DeviceID + ')') 'ok' $txt '' $null }
  }
} catch {}

try {
  $ErrorActionPreference = 'Continue'
  $t = (& fsutil.exe behavior query DisableDeleteNotify 2>&1 | ForEach-Object { [string]$_ }) -join ' '
  $ErrorActionPreference = 'Stop'
  if ($t -match 'NTFS[^=]*=\s*(\d)') {
    if ($matches[1] -eq '0') { Add '메모리·디스크' 'SSD TRIM' 'ok' '켜짐' '' $null }
    else { Add '메모리·디스크' 'SSD TRIM' 'warn' '꺼짐' 'TRIM 이 꺼져 있으면 SSD 가 점점 느려집니다. 관리자 명령 프롬프트에서 fsutil behavior set DisableDeleteNotify 0 을 실행하세요.' $null }
  }
} catch { $ErrorActionPreference = 'Stop' }

try {
  $hf = Get-Item -LiteralPath ($env:SystemDrive + '\hiberfil.sys') -Force -ErrorAction Stop
  $gb = [double]$hf.Length / 1GB
  if (-not $laptop -and $gb -gt 2) { Add '메모리·디스크' '최대 절전 파일' 'info' ('{0:N1} GB' -f $gb) '데스크톱에서 최대 절전을 쓰지 않는다면 관리자 명령 프롬프트에서 powercfg /h off 로 이 용량을 확보할 수 있습니다. (빠른 시작도 함께 꺼집니다)' $null }
  else { Add '메모리·디스크' '최대 절전 파일' 'ok' ('{0:N1} GB' -f $gb) '' $null }
} catch {}

# ───── 추가 검사: 그래픽·게임 ─────
try {
  $vram = [int64]0; $vname = ''
  $cls = 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
  foreach ($k in @(Get-ChildItem -LiteralPath $cls -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\d{4}$' })) {
    $q = RG $k.PSPath 'HardwareInformation.qwMemorySize'
    $d = RG $k.PSPath 'DriverDesc'
    if ($q.exists -and [int64]$q.value -gt $vram -and $d.value -notmatch 'Remote|Virtual|Parsec|Basic') { $vram = [int64]$q.value; $vname = [string]$d.value }
  }
  if ($vram -gt 0) {
    $gb = [double]$vram / 1GB
    $txt = ($vname + ' · ' + ('{0:N0} GB' -f $gb))
    if ($gb -lt 4) { Add '그래픽·게임' '그래픽 메모리 (VRAM)' 'info' $txt '그래픽 메모리가 적으면 최신 게임에서 끊김이 생깁니다. 게임의 텍스처 품질을 "중간" 이하로 낮추세요.' $null }
    else { Add '그래픽·게임' '그래픽 메모리 (VRAM)' 'ok' $txt '' $null }
  }
} catch {}

try {
  if ($laptop) {
    $bat = @(Get-CimInstance Win32_Battery)[0]
    if ([int]$bat.BatteryStatus -eq 1) { Add '그래픽·게임' '전원 연결 (노트북)' 'warn' ('배터리 사용 중 · ' + $bat.EstimatedChargeRemaining + '%') '노트북은 충전기를 연결해야 CPU·GPU 가 최대 성능을 냅니다. 배터리로는 FPS 가 크게 떨어집니다.' $null }
    else { Add '그래픽·게임' '전원 연결 (노트북)' 'ok' ('충전기 연결됨 · ' + $bat.EstimatedChargeRemaining + '%') '' $null }
  }
} catch {}

try {
  $dg = Get-CimInstance -Namespace 'root\Microsoft\Windows\DeviceGuard' -ClassName Win32_DeviceGuard -ErrorAction Stop
  if ([int]$dg.VirtualizationBasedSecurityStatus -eq 2) { Add '그래픽·게임' '가상화 기반 보안 (VBS)' 'info' '실행 중' 'VBS 는 보안 기능이지만 일부 CPU 에서 게임 성능을 몇 % 낮춥니다. 메모리 무결성 항목과 함께 판단하세요.' $null }
  else { Add '그래픽·게임' '가상화 기반 보안 (VBS)' 'ok' '꺼짐' '' $null }
} catch {}

# ───── 백그라운드 ─────
try {
  $t0 = @{}
  foreach ($p in Get-Process) { try { $t0[$p.Id] = $p.TotalProcessorTime.TotalMilliseconds } catch {} }
  Start-Sleep -Milliseconds 1500
  $cores = [Environment]::ProcessorCount
  $use = @{}
  foreach ($p in Get-Process) {
    try {
      if (-not $t0.ContainsKey($p.Id) -or $p.Id -eq $PID -or $p.ProcessName -eq 'Idle') { continue }
      $pc = ($p.TotalProcessorTime.TotalMilliseconds - $t0[$p.Id]) / 1500 / $cores * 100
      $use[$p.ProcessName] = [double]$use[$p.ProcessName] + $pc
    } catch {}
  }
  $top = @($use.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 3)
  $txt = (@($top | Where-Object { $_.Value -ge 1 } | ForEach-Object { $_.Key + ' ' + [math]::Round($_.Value) + '%' }) -join ', ')
  if (-not $txt) { $txt = '모두 1% 미만' }
  if ($top.Count -and $top[0].Value -ge 15) { Add '백그라운드' 'CPU 를 많이 쓰는 프로그램' 'warn' $txt '게임 전에 이 프로그램을 닫으면 FPS 와 반응 속도가 좋아집니다.' $null }
  else { Add '백그라운드' 'CPU 를 많이 쓰는 프로그램' 'ok' $txt '' $null }
} catch {}

try {
  $mem = @(Get-Process | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ n = $_.Name; m = [double](($_.Group | Measure-Object WorkingSet64 -Sum).Sum) } } | Sort-Object m -Descending | Select-Object -First 3)
  $txt = (@($mem | ForEach-Object { $_.n + ' ' + ('{0:N1}' -f ($_.m / 1GB)) + 'GB' }) -join ', ')
  if ($mem.Count -and $mem[0].m -gt 3GB) { Add '백그라운드' '메모리를 많이 쓰는 프로그램' 'warn' $txt '메모리를 많이 쓰는 프로그램(브라우저 탭 등)을 닫거나 메모리 정리를 실행하세요.' (Fx 'action' 'trimMemory') }
  else { Add '백그라운드' '메모리를 많이 쓰는 프로그램' 'ok' $txt '' $null }
} catch {}

try {
  $ov = @{ 'RTSS' = 'RivaTuner'; 'MSIAfterburner' = 'MSI Afterburner'; 'Overwolf' = 'Overwolf'; 'obs64' = 'OBS Studio'; 'GameBar' = 'Xbox Game Bar'; 'NVIDIA Share' = 'NVIDIA 오버레이'; 'Medal' = 'Medal'; 'Outplayed' = 'Outplayed'; 'XSplit.Core' = 'XSplit' }
  $run = @(Get-Process | Where-Object { $ov.ContainsKey($_.ProcessName) } | ForEach-Object { $ov[$_.ProcessName] } | Select-Object -Unique)
  if ($run.Count) { Add '백그라운드' '오버레이·녹화 프로그램' 'info' ($run -join ', ') '화면 위에 그리거나 녹화하는 프로그램은 FPS 를 조금 낮추고 입력 지연을 늘릴 수 있습니다. 쓰지 않을 땐 꺼 두세요.' $null }
  else { Add '백그라운드' '오버레이·녹화 프로그램' 'ok' '실행 중인 것 없음' '' $null }
} catch {}

# ───── 추가 검사: 보안 ─────
try {
  $tpm = Get-CimInstance -Namespace 'root\cimv2\Security\MicrosoftTpm' -ClassName Win32_Tpm -ErrorAction Stop
  if ($tpm -and $tpm.IsEnabled_InitialValue) { Add '보안' 'TPM' 'ok' ('켜짐 · ' + ([string]$tpm.SpecVersion).Split(',')[0].Trim()) '' $null }
  else { Add '보안' 'TPM' 'warn' '꺼짐' 'Windows 11 과 발로란트(뱅가드) 등 일부 안티치트는 TPM 2.0 이 필요합니다. BIOS 에서 fTPM/PTT 를 켜세요.' $null }
} catch { Add '보안' 'TPM' 'info' '확인 불가 (관리자 권한 필요)' '' $null }

try {
  $smb = RG 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\mrxsmb10' 'Start'
  if ($smb.exists -and [int]$smb.value -ne 4) { Add '보안' 'SMBv1 (구형 파일 공유)' 'warn' '켜짐' '워너크라이 랜섬웨어가 이용한 오래된 프로토콜입니다. "Windows 기능 켜기/끄기"에서 SMB 1.0 을 끄세요.' $null }
  else { Add '보안' 'SMBv1 (구형 파일 공유)' 'ok' '꺼짐' '' $null }
} catch {}

try {
  $rdp = RG 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Terminal Server' 'fDenyTSConnections'
  if ($rdp.exists -and [int]$rdp.value -eq 0) { Add '보안' '원격 데스크톱' 'info' '켜짐' '원격 데스크톱을 쓰지 않는다면 설정 > 시스템 > 원격 데스크톱에서 끄는 것이 안전합니다.' $null }
  else { Add '보안' '원격 데스크톱' 'ok' '꺼짐' '' $null }
} catch {}

try {
  $g = @(Get-LocalUser -ErrorAction Stop | Where-Object { $_.SID.Value -like '*-501' -and $_.Enabled })
  if ($g.Count) { Add '보안' 'Guest 계정' 'warn' '켜짐' '암호 없는 Guest 계정이 켜져 있습니다. 쓰지 않는다면 끄세요.' $null }
  else { Add '보안' 'Guest 계정' 'ok' '꺼짐' '' $null }
} catch {}

try {
  $mp2 = Get-MpComputerStatus -ErrorAction Stop
  if ($mp2.RealTimeProtectionEnabled) {
    $age = [int]$mp2.QuickScanAge
    if ($age -gt 14) { Add '보안' '마지막 바이러스 검사' 'info' ($age.ToString() + '일 전') '2주 넘게 검사하지 않았습니다. Windows 보안에서 빠른 검사를 한 번 실행하세요.' $null }
    else { Add '보안' '마지막 바이러스 검사' 'ok' ($age.ToString() + '일 전') '' $null }
  }
} catch {}

# ───── 추가 검사: 입력·전원 모드 ─────
try {
  $fk = RG 'Registry::HKEY_CURRENT_USER\Control Panel\Accessibility\Keyboard Response' 'Flags'
  if ($fk.exists -and (([int]$fk.value) -band 1)) { Add '그래픽·게임' '필터 키' 'warn' '켜짐' '필터 키가 켜져 있으면 짧게 누른 키가 무시되거나 늦게 인식됩니다. 설정 > 접근성 > 키보드에서 필터 키를 끄세요.' $null }
  else { Add '그래픽·게임' '필터 키' 'ok' '꺼짐' '' $null }
} catch {}

try {
  # Windows 11 전원 모드 (설정 > 시스템 > 전원): 최고의 전원 효율 = 961cc777-…
  $ov = RG 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes' 'ActiveOverlayAcPowerScheme'
  if ($ov.exists -and [string]$ov.value -match '961cc777-2547-4f9d-8174-7d86181b8a7a') { Add '그래픽·게임' 'Windows 전원 모드' 'warn' '최고의 전원 효율' '전원 모드가 절전 쪽으로 설정돼 CPU 성능이 제한됩니다. 설정 > 시스템 > 전원에서 "최고의 성능"으로 바꾸세요.' $null }
  elseif ($ov.exists) { Add '그래픽·게임' 'Windows 전원 모드' 'ok' (@{ 'ded574b5-45a0-4f42-8737-46345c09c238' = '최고의 성능' }[[string]$ov.value] + '') '' $null }
} catch {}

try {
  # 메모리 무결성: 설정값과 실제 동작이 다르면 재부팅해야 반영된다
  $set = RG 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' 'Enabled'
  $dg2 = Get-CimInstance -Namespace 'root\Microsoft\Windows\DeviceGuard' -ClassName Win32_DeviceGuard -ErrorAction Stop
  $running = @($dg2.SecurityServicesRunning) -contains 2
  if ($set.exists -and ([int]$set.value -eq 1) -ne $running) {
    $txt = '꺼짐 예정'; if ([int]$set.value -eq 1) { $txt = '켜짐 예정' }
    Add '그래픽·게임' '메모리 무결성 변경 대기' 'info' ($txt + ' (재부팅 필요)') '메모리 무결성 설정을 바꿨지만 아직 재부팅하지 않아 반영되지 않았습니다.' $null
  }
} catch {}

# ───── 추가 검사: 보안 (실행 가로채기·의심 프로세스) ─────
try {
  # 정상 프로그램 실행을 다른 프로그램으로 가로채는 IFEO Debugger 값 (악성 프로그램이 자주 쓰는 수법)
  $ifeo = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options'
  $hij = @(Get-ChildItem -LiteralPath $ifeo -ErrorAction SilentlyContinue | ForEach-Object {
    $d = RG $_.PSPath 'Debugger'
    if ($d.exists -and [string]$d.value) { $_.PSChildName + ' → ' + [string]$d.value }
  })
  if ($hij.Count) { Add '보안' '프로그램 실행 가로채기 (IFEO)' 'warn' (($hij | Select-Object -First 3) -join ', ') '다른 프로그램이 실행을 가로채도록 설정돼 있습니다. Process Explorer 처럼 직접 설치한 도구가 아니라면 악성 프로그램일 수 있으니 백신으로 검사하세요.' $null }
  else { Add '보안' '프로그램 실행 가로채기 (IFEO)' 'ok' '없음' '' $null }
} catch {}

try {
  $sys = @('svchost', 'csrss', 'lsass', 'winlogon', 'services', 'smss', 'wininit', 'explorer', 'dwm', 'spoolsv', 'taskhostw', 'conhost')
  $win = $env:WINDIR.ToLower()
  $tmp = @($env:TEMP.ToLower(), ($env:LOCALAPPDATA + '\Temp').ToLower(), ($env:WINDIR + '\Temp').ToLower())
  $bad = @(); $odd = @()
  # 포터블판 Oreum FPS Booster 자신은 임시 폴더에 풀려 실행되므로 제외
  foreach ($p in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.ProcessName -ne 'Oreum FPS Booster' })) {
    $path = $p.Path.ToLower()
    if ($sys -contains $p.ProcessName.ToLower() -and -not $path.StartsWith($win)) { $bad += ($p.ProcessName + ' (' + $p.Path + ')') }
    elseif (@($tmp | Where-Object { $path.StartsWith($_) }).Count) { $odd += $p.ProcessName }
  }
  if ($bad.Count) { Add '보안' '의심스러운 프로세스' 'bad' ($bad -join ', ') 'Windows 시스템 프로그램과 이름이 같지만 다른 위치에서 실행 중입니다. 악성 프로그램일 가능성이 높으니 즉시 백신으로 정밀 검사하세요.' $null }
  elseif ($odd.Count) { Add '보안' '의심스러운 프로세스' 'info' ('임시 폴더에서 실행 중: ' + ((@($odd | Select-Object -Unique)) -join ', ')) '설치 프로그램이 실행 중이 아니라면, 임시 폴더에서 계속 실행되는 프로그램은 확인해 보는 것이 좋습니다.' $null }
  else { Add '보안' '의심스러운 프로세스' 'ok' '없음' '' $null }
} catch {}

# ───── 추가 검사: 네트워크 ─────
try {
  $srv = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.ServerAddresses.Count -gt 0 -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|VirtualBox|VMware' } | ForEach-Object { $_.ServerAddresses } | Select-Object -Unique)
  if ($srv.Count) {
    $s = $srv[0]
    # 로컬 DNS 캐시를 거치지 않도록 DNS 서버에 직접 묻는다
    $ms = [int](Measure-Command { Resolve-DnsName -Name 'www.google.com' -Server $s -DnsOnly -Type A -ErrorAction Stop | Out-Null }).TotalMilliseconds
    $txt = ($s + ' · ' + $ms + 'ms')
    if ($ms -gt 100) { Add '네트워크·시작' 'DNS 응답 속도' 'warn' $txt 'DNS 가 느리면 게임 서버 접속·웹 로딩이 늦어집니다. 1.1.1.1 이나 8.8.8.8 같은 공용 DNS 를 고려해 보세요.' $null }
    else { Add '네트워크·시작' 'DNS 응답 속도' 'ok' $txt '' $null }
  }
} catch { Add '네트워크·시작' 'DNS 응답 속도' 'info' '확인 불가' '' $null }

try {
  $ie = RG 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings' 'ProxyEnable'
  if ($ie.exists -and [int]$ie.value -eq 1) {
    $ps = RG 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings' 'ProxyServer'
    Add '네트워크·시작' '프록시 설정' 'warn' ('켜짐 · ' + [string]$ps.value) '직접 설정하지 않았다면 악성 프로그램일 수 있습니다. 프록시는 핑을 높입니다. 설정 > 네트워크 > 프록시에서 확인하세요.' $null
  } else { Add '네트워크·시작' '프록시 설정' 'ok' '사용 안 함' '' $null }
} catch {}

try {
  if (@(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' -and ($_.NdisPhysicalMedium -eq 9 -or $_.InterfaceDescription -match 'Wi-?Fi|Wireless|802\.11|무선') }).Count) {
    $ErrorActionPreference = 'Continue'
    $w = (& netsh.exe wlan show interfaces 2>&1 | ForEach-Object { [string]$_ }) -join ' '
    $ErrorActionPreference = 'Stop'
    if ($w -match '(\d{1,3})\s*%') {
      $sig = [int]$matches[1]
      if ($sig -lt 60) { Add '네트워크·시작' 'Wi-Fi 신호 세기' 'warn' ($sig.ToString() + '%') '신호가 약하면 핑이 튀고 패킷이 손실됩니다. 공유기와 가까이 두거나 5GHz·유선 연결을 권장합니다.' $null }
      else { Add '네트워크·시작' 'Wi-Fi 신호 세기' 'ok' ($sig.ToString() + '%') '' $null }
    }
  }
} catch { $ErrorActionPreference = 'Stop' }

Emit @{ results = $script:R }
`;

module.exports = { CHECK_SCRIPT };
