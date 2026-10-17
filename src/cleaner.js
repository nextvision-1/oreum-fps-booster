// 스마트 파일 청소: 항목 정의 + 스캔/삭제 스크립트
// paths: 환경변수(%TEMP% 등)와 와일드카드(*) 사용 가능, %STEAM% 은 Steam 설치 경로
// olderH: 이 시간(시간)보다 오래된 파일만 삭제
const CLEAN_GROUPS = [
  { id: 'system', name: 'Windows 시스템' },
  { id: 'browser', name: '브라우저 캐시' },
  { id: 'apps', name: '게임 런처·앱' },
  { id: 'gpu', name: '그래픽 캐시' },
];

const CLEAN_ITEMS = [
  // Windows
  { id: 'tempUser', group: 'system', name: '사용자 임시 파일', def: true, olderH: 2, paths: ['%TEMP%\\*'] },
  { id: 'tempWin', group: 'system', name: 'Windows 임시 파일', def: true, olderH: 2, paths: ['%WINDIR%\\Temp\\*'] },
  { id: 'wu', group: 'system', name: 'Windows 업데이트 다운로드 잔여물', def: true, paths: ['%WINDIR%\\SoftwareDistribution\\Download\\*'] },
  { id: 'doCache', group: 'system', name: '배달 최적화 캐시', def: true, paths: ['%WINDIR%\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache\\*'] },
  { id: 'wer', group: 'system', name: '오류 보고서', def: true, paths: ['%ProgramData%\\Microsoft\\Windows\\WER\\ReportArchive\\*', '%ProgramData%\\Microsoft\\Windows\\WER\\ReportQueue\\*', '%LOCALAPPDATA%\\Microsoft\\Windows\\WER\\*'] },
  { id: 'dumps', group: 'system', name: '메모리 덤프·크래시 덤프', def: true, paths: ['%LOCALAPPDATA%\\CrashDumps\\*', '%WINDIR%\\Minidump\\*', '%WINDIR%\\MEMORY.DMP', '%WINDIR%\\LiveKernelReports\\*.dmp'] },
  { id: 'logs', group: 'system', name: 'Windows 로그 파일', def: true, olderH: 24, paths: ['%WINDIR%\\Logs\\CBS\\*.log', '%WINDIR%\\Logs\\DISM\\*.log', '%WINDIR%\\Logs\\MoSetup\\*.log', '%WINDIR%\\Logs\\WindowsUpdate\\*.etl'] },
  { id: 'thumbs', group: 'system', name: '썸네일·아이콘 캐시', def: false, paths: ['%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer\\thumbcache_*.db', '%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer\\iconcache_*.db'] },
  { id: 'inet', group: 'system', name: '인터넷 임시 파일', def: true, paths: ['%LOCALAPPDATA%\\Microsoft\\Windows\\INetCache\\*'] },
  { id: 'recycle', group: 'system', name: '휴지통', def: false, special: 'recycle', paths: [] },

  // 브라우저
  { id: 'chrome', group: 'browser', name: 'Chrome 캐시', def: true, paths: ['%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Cache\\*', '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Code Cache\\*', '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\GPUCache\\*'] },
  { id: 'edge', group: 'browser', name: 'Edge 캐시', def: true, paths: ['%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\*\\Cache\\*', '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\*\\Code Cache\\*', '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\*\\GPUCache\\*'] },
  { id: 'whale', group: 'browser', name: '네이버 웨일 캐시', def: true, paths: ['%LOCALAPPDATA%\\Naver\\Naver Whale\\User Data\\*\\Cache\\*', '%LOCALAPPDATA%\\Naver\\Naver Whale\\User Data\\*\\Code Cache\\*', '%LOCALAPPDATA%\\Naver\\Naver Whale\\User Data\\*\\GPUCache\\*'] },
  { id: 'firefox', group: 'browser', name: 'Firefox 캐시', def: true, paths: ['%LOCALAPPDATA%\\Mozilla\\Firefox\\Profiles\\*\\cache2\\*'] },
  { id: 'opera', group: 'browser', name: 'Opera 캐시', def: true, paths: ['%LOCALAPPDATA%\\Opera Software\\Opera Stable\\Cache\\*', '%LOCALAPPDATA%\\Opera Software\\Opera Stable\\Default\\Cache\\*', '%LOCALAPPDATA%\\Opera Software\\Opera GX Stable\\Cache\\*'] },

  // 게임 런처·앱
  { id: 'steam', group: 'apps', name: 'Steam 웹 캐시·로그·덤프', def: true, paths: ['%STEAM%\\appcache\\httpcache\\*', '%STEAM%\\logs\\*', '%STEAM%\\dumps\\*', '%LOCALAPPDATA%\\Steam\\htmlcache\\*'] },
  { id: 'epic', group: 'apps', name: 'Epic Games 런처 캐시·로그', def: true, paths: ['%LOCALAPPDATA%\\EpicGamesLauncher\\Saved\\webcache*\\*', '%LOCALAPPDATA%\\EpicGamesLauncher\\Saved\\Logs\\*'] },
  { id: 'bnet', group: 'apps', name: 'Battle.net 캐시', def: true, paths: ['%LOCALAPPDATA%\\Battle.net\\Cache\\*', '%LOCALAPPDATA%\\Battle.net\\BrowserCaches\\*'] },
  { id: 'riot', group: 'apps', name: 'Riot 클라이언트 로그', def: true, olderH: 24, paths: ['%LOCALAPPDATA%\\Riot Games\\Riot Client\\Logs\\*'] },
  { id: 'discord', group: 'apps', name: 'Discord 캐시', def: true, paths: ['%APPDATA%\\discord\\Cache\\*', '%APPDATA%\\discord\\Code Cache\\*', '%APPDATA%\\discord\\GPUCache\\*'] },
  { id: 'driverLeft', group: 'apps', name: '그래픽 드라이버 설치 잔여물', def: false, paths: ['%ProgramData%\\NVIDIA Corporation\\Downloader\\*', '%SystemDrive%\\AMD\\*', '%SystemDrive%\\NVIDIA\\*'] },

  // 그래픽 캐시 (기본 해제: 지우면 다음 게임 실행 때 잠깐 끊길 수 있음)
  { id: 'shader', group: 'gpu', name: 'DirectX·드라이버 셰이더 캐시', def: false, warn: '지우면 게임 첫 실행 시 셰이더를 다시 만들며 잠깐 끊길 수 있습니다. 게임이 깨지거나 드라이버를 바꿨을 때만 지우세요.',
    paths: ['%LOCALAPPDATA%\\D3DSCache\\*', '%LOCALAPPDATA%\\NVIDIA\\DXCache\\*', '%LOCALAPPDATA%\\NVIDIA\\GLCache\\*', '%LOCALAPPDATA%\\AMD\\DxCache\\*', '%LOCALAPPDATA%\\AMD\\DxcCache\\*', '%LOCALAPPDATA%\\AMD\\VkCache\\*'] },
];

const CLEAN_LIB = String.raw`
$script:steam = $null
try { $script:steam = ((Get-ItemProperty -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\Valve\Steam' -ErrorAction Stop).SteamPath) -replace '/', '\' } catch {}

function ExpandP($p) {
  $p = [Environment]::ExpandEnvironmentVariables($p)
  if ($p.Contains('%STEAM%')) { if (-not $script:steam) { return @() }; $p = $p.Replace('%STEAM%', $script:steam) }
  return @(Get-Item -Path $p -Force -ErrorAction SilentlyContinue)
}

function FilesOf($it, $olderH) {
  $files = @()
  if ($it.PSIsContainer) { $files = @(Get-ChildItem -LiteralPath $it.FullName -Recurse -Force -File -ErrorAction SilentlyContinue) } else { $files = @($it) }
  if ($olderH) { $lim = (Get-Date).AddHours(-1 * [double]$olderH); $files = @($files | Where-Object { $_.LastWriteTime -lt $lim }) }
  return $files
}

function RecycleSize() {
  try {
    $sh = New-Object -ComObject Shell.Application
    $s = [int64]0; $c = 0
    foreach ($i in $sh.NameSpace(10).Items()) { $s += [int64]$i.Size; $c++ }
    return @{ size = $s; count = $c }
  } catch { return @{ size = 0; count = 0 } }
}
`;

const CLEAN_SCAN = String.raw`
$out = @()
foreach ($c in @($A.items)) {
  $size = [int64]0; $count = 0
  if ($c.special -eq 'recycle') { $r = RecycleSize; $size = $r.size; $count = $r.count }
  else {
    foreach ($p in @($c.paths)) {
      foreach ($it in (ExpandP $p)) { foreach ($f in (FilesOf $it $c.olderH)) { $size += [int64]$f.Length; $count++ } }
    }
  }
  $out += ,@{ id = $c.id; size = $size; count = $count }
}
Emit @{ results = $out }
`;

const CLEAN_RUN = String.raw`
$out = @()
foreach ($c in @($A.items)) {
  $freed = [int64]0; $count = 0; $skip = 0
  if ($c.special -eq 'recycle') {
    $r = RecycleSize
    try { Clear-RecycleBin -Force -ErrorAction Stop; $freed = $r.size; $count = $r.count } catch { $skip = $r.count }
  } else {
    foreach ($p in @($c.paths)) {
      foreach ($it in (ExpandP $p)) {
        # 파일을 지우면 폴더 수정 시각이 바뀌므로, 지우기 전에 하위 폴더 목록과 시각을 기록해 둔다
        $dirs = @()
        if ($it.PSIsContainer) { $dirs = @($it) + @(Get-ChildItem -LiteralPath $it.FullName -Recurse -Force -Directory -ErrorAction SilentlyContinue) }
        foreach ($f in (FilesOf $it $c.olderH)) {
          $len = [int64]$f.Length
          try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $freed += $len; $count++ } catch { $skip++ }
        }
        # 비어 있는 폴더 정리 (와일드카드 앞의 대상 폴더 자체는 유지). 시간 조건이 있으면 그보다 오래된 폴더만
        $lim = $null
        if ($c.olderH) { $lim = (Get-Date).AddHours(-1 * [double]$c.olderH) }
        $dirs | Where-Object { -not $lim -or $_.LastWriteTime -lt $lim } | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
          if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
        }
      }
    }
  }
  $out += ,@{ id = $c.id; freed = $freed; count = $count; skipped = $skip }
}
Emit @{ results = $out }
`;

const DRIVES = String.raw`
$d = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ id = $_.DeviceID; label = $_.VolumeName; size = [int64]$_.Size; free = [int64]$_.FreeSpace } })
Emit @{ drives = $d }
`;

module.exports = { CLEAN_GROUPS, CLEAN_ITEMS, CLEAN_LIB, CLEAN_SCAN, CLEAN_RUN, DRIVES };
