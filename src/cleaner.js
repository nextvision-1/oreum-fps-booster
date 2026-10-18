// 스마트 파일 청소: 항목 정의 + 스캔/삭제 스크립트
// paths: 환경변수(%TEMP% 등)와 와일드카드(*) 사용 가능, %STEAM% 은 Steam 설치 경로
// olderH: 이 시간(시간)보다 오래된 파일만 삭제
const CLEAN_GROUPS = [
  { id: 'system', name: 'Windows 시스템' },
  { id: 'privacy', name: '사용 기록' },
  { id: 'browser', name: '브라우저 캐시' },
  { id: 'games', name: '게임·런처' },
  { id: 'apps', name: '메신저·업무 앱' },
  { id: 'gpu', name: '그래픽 캐시·드라이버' },
];

// 원칙: 다시 만들어지는 캐시·로그만 넣는다. 지우면 불편이 생기는 항목은 def: false + warn.
const SHADER_WARN = '지우면 게임 첫 실행 시 셰이더를 다시 만들며 잠깐 끊길 수 있습니다. 게임이 깨지거나 드라이버를 바꿨을 때만 지우세요.';
const chromium = (base) => ['Cache', 'Code Cache', 'GPUCache'].map((d) => `${base}\\User Data\\*\\${d}\\*`);
const electronApp = (base) => ['Cache', 'Code Cache', 'GPUCache'].map((d) => `${base}\\${d}\\*`);

const CLEAN_ITEMS = [
  // Windows
  { id: 'tempUser', group: 'system', name: '사용자 임시 파일', def: true, olderH: 2, paths: ['%TEMP%\\*'] },
  { id: 'tempWin', group: 'system', name: 'Windows 임시 파일', def: true, olderH: 2, paths: ['%WINDIR%\\Temp\\*'] },
  { id: 'storeTemp', group: 'system', name: 'Microsoft Store 앱 임시 파일', def: true, olderH: 24, paths: ['%LOCALAPPDATA%\\Packages\\*\\AC\\Temp\\*'] },
  { id: 'wu', group: 'system', name: 'Windows 업데이트 다운로드 잔여물', def: true, paths: ['%WINDIR%\\SoftwareDistribution\\Download\\*'] },
  { id: 'doCache', group: 'system', name: '배달 최적화 캐시', def: true, paths: ['%WINDIR%\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache\\*'] },
  { id: 'wer', group: 'system', name: '오류 보고서', def: true, paths: ['%ProgramData%\\Microsoft\\Windows\\WER\\ReportArchive\\*', '%ProgramData%\\Microsoft\\Windows\\WER\\ReportQueue\\*', '%ProgramData%\\Microsoft\\Windows\\WER\\Temp\\*', '%LOCALAPPDATA%\\Microsoft\\Windows\\WER\\*'] },
  { id: 'dumps', group: 'system', name: '메모리 덤프·크래시 덤프', def: true, paths: ['%LOCALAPPDATA%\\CrashDumps\\*', '%WINDIR%\\Minidump\\*', '%WINDIR%\\MEMORY.DMP', '%WINDIR%\\LiveKernelReports\\*.dmp'] },
  { id: 'logs', group: 'system', name: 'Windows 로그 파일', def: true, olderH: 24, paths: ['%WINDIR%\\Logs\\CBS\\*.log', '%WINDIR%\\Logs\\DISM\\*.log', '%WINDIR%\\Logs\\MoSetup\\*.log', '%WINDIR%\\Logs\\WindowsUpdate\\*.etl', '%WINDIR%\\Logs\\dosvc\\*.etl'] },
  { id: 'diagEtl', group: 'system', name: '진단 데이터 추적 로그', def: true, olderH: 24, paths: ['%ProgramData%\\Microsoft\\Diagnosis\\ETLLogs\\*'] },
  { id: 'setupLogs', group: 'system', name: 'Windows 설치 로그 (Panther)', def: false, olderH: 720, paths: ['%WINDIR%\\Panther\\*.log', '%WINDIR%\\Panther\\UnattendGC\\*.log'] },
  { id: 'esd', group: 'system', name: 'Windows 설치 미디어 다운로드 (ESD)', def: false, warn: 'Windows 재설치·업그레이드용으로 내려받은 설치 파일입니다. 업그레이드를 마쳤다면 지워도 됩니다.', paths: ['%SystemDrive%\\ESD\\*'] },
  { id: 'thumbs', group: 'system', name: '썸네일·아이콘 캐시', def: false, paths: ['%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer\\thumbcache_*.db', '%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer\\iconcache_*.db'] },
  { id: 'inet', group: 'system', name: '인터넷 임시 파일', def: true, paths: ['%LOCALAPPDATA%\\Microsoft\\Windows\\INetCache\\*'] },
  { id: 'recycle', group: 'system', name: '휴지통', def: false, special: 'recycle', paths: [] },

  // 사용 기록 (개인정보 정리용, 기본 해제)
  { id: 'recent', group: 'privacy', name: '최근 사용한 파일 목록', def: false, warn: '탐색기 "최근 항목" 목록이 비워집니다. 파일 자체는 지워지지 않습니다.', paths: ['%APPDATA%\\Microsoft\\Windows\\Recent\\*.lnk'] },
  { id: 'jumpList', group: 'privacy', name: '작업 표시줄 점프 목록', def: false, warn: '작업 표시줄 아이콘을 우클릭하면 보이는 최근 파일 목록이 비워집니다. (고정한 항목도 함께 지워질 수 있음)', paths: ['%APPDATA%\\Microsoft\\Windows\\Recent\\AutomaticDestinations\\*', '%APPDATA%\\Microsoft\\Windows\\Recent\\CustomDestinations\\*'] },

  // 브라우저
  { id: 'chrome', group: 'browser', name: 'Chrome 캐시', def: true, paths: chromium('%LOCALAPPDATA%\\Google\\Chrome') },
  { id: 'edge', group: 'browser', name: 'Edge 캐시', def: true, paths: chromium('%LOCALAPPDATA%\\Microsoft\\Edge') },
  { id: 'whale', group: 'browser', name: '네이버 웨일 캐시', def: true, paths: chromium('%LOCALAPPDATA%\\Naver\\Naver Whale') },
  { id: 'brave', group: 'browser', name: 'Brave 캐시', def: true, paths: chromium('%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser') },
  { id: 'vivaldi', group: 'browser', name: 'Vivaldi 캐시', def: true, paths: chromium('%LOCALAPPDATA%\\Vivaldi') },
  { id: 'firefox', group: 'browser', name: 'Firefox 캐시', def: true, paths: ['%LOCALAPPDATA%\\Mozilla\\Firefox\\Profiles\\*\\cache2\\*', '%LOCALAPPDATA%\\Mozilla\\Firefox\\Profiles\\*\\startupCache\\*', '%LOCALAPPDATA%\\Mozilla\\Firefox\\Profiles\\*\\thumbnails\\*'] },
  { id: 'opera', group: 'browser', name: 'Opera 캐시', def: true, paths: ['%LOCALAPPDATA%\\Opera Software\\Opera Stable\\Cache\\*', '%LOCALAPPDATA%\\Opera Software\\Opera Stable\\Default\\Cache\\*'] },
  { id: 'operagx', group: 'browser', name: 'Opera GX 캐시', def: true, paths: ['%LOCALAPPDATA%\\Opera Software\\Opera GX Stable\\Cache\\*', '%LOCALAPPDATA%\\Opera Software\\Opera GX Stable\\Default\\Cache\\*'] },
  { id: 'browserShader', group: 'browser', name: '브라우저 셰이더 캐시', def: true, paths: ['Google\\Chrome', 'Microsoft\\Edge', 'Naver\\Naver Whale', 'BraveSoftware\\Brave-Browser'].flatMap((b) => [`%LOCALAPPDATA%\\${b}\\User Data\\ShaderCache\\*`, `%LOCALAPPDATA%\\${b}\\User Data\\GrShaderCache\\*`]) },

  // 게임·런처
  { id: 'steam', group: 'games', name: 'Steam 웹 캐시·로그·덤프', def: true, paths: ['%STEAM%\\appcache\\httpcache\\*', '%STEAM%\\logs\\*', '%STEAM%\\dumps\\*', '%LOCALAPPDATA%\\Steam\\htmlcache\\*'] },
  { id: 'epic', group: 'games', name: 'Epic Games 런처 캐시·로그', def: true, paths: ['%LOCALAPPDATA%\\EpicGamesLauncher\\Saved\\webcache*\\*', '%LOCALAPPDATA%\\EpicGamesLauncher\\Saved\\Logs\\*'] },
  { id: 'bnet', group: 'games', name: 'Battle.net 캐시', def: true, paths: ['%LOCALAPPDATA%\\Battle.net\\Cache\\*', '%LOCALAPPDATA%\\Battle.net\\BrowserCaches\\*'] },
  { id: 'riot', group: 'games', name: 'Riot 클라이언트 로그', def: true, olderH: 24, paths: ['%LOCALAPPDATA%\\Riot Games\\Riot Client\\Logs\\*'] },
  { id: 'ea', group: 'games', name: 'EA app 캐시·로그', def: true, olderH: 24, paths: ['%LOCALAPPDATA%\\Electronic Arts\\EA Desktop\\Logs\\*', '%LOCALAPPDATA%\\Electronic Arts\\EA Desktop\\CEF\\BrowserCache\\*'] },
  { id: 'ubisoft', group: 'games', name: 'Ubisoft Connect 로그', def: true, olderH: 24, paths: ['%ProgramFiles(x86)%\\Ubisoft\\Ubisoft Game Launcher\\logs\\*'] },
  { id: 'gog', group: 'games', name: 'GOG Galaxy 로그', def: true, olderH: 24, paths: ['%ProgramData%\\GOG.com\\Galaxy\\logs\\*'] },
  { id: 'minecraft', group: 'games', name: 'Minecraft 로그·크래시 리포트', def: true, olderH: 24, paths: ['%APPDATA%\\.minecraft\\logs\\*', '%APPDATA%\\.minecraft\\crash-reports\\*'] },
  { id: 'roblox', group: 'games', name: 'Roblox 로그', def: true, olderH: 24, paths: ['%LOCALAPPDATA%\\Roblox\\logs\\*'] },
  { id: 'obs', group: 'games', name: 'OBS Studio 로그·크래시 기록', def: true, olderH: 24, paths: ['%APPDATA%\\obs-studio\\logs\\*', '%APPDATA%\\obs-studio\\crashes\\*'] },

  // 메신저·업무 앱
  { id: 'discord', group: 'apps', name: 'Discord 캐시', def: true, paths: electronApp('%APPDATA%\\discord') },
  { id: 'teams', group: 'apps', name: 'Microsoft Teams 캐시', def: true, paths: [...electronApp('%APPDATA%\\Microsoft\\Teams'), '%LOCALAPPDATA%\\Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache\\Microsoft\\MSTeams\\EBWebView\\*\\Cache\\*'] },
  { id: 'slack', group: 'apps', name: 'Slack 캐시', def: true, paths: electronApp('%APPDATA%\\Slack') },
  { id: 'zoom', group: 'apps', name: 'Zoom 로그', def: true, olderH: 24, paths: ['%APPDATA%\\Zoom\\logs\\*'] },
  { id: 'vscode', group: 'apps', name: 'VS Code 캐시', def: true, paths: [...electronApp('%APPDATA%\\Code'), '%APPDATA%\\Code\\CachedData\\*'] },
  { id: 'devCache', group: 'apps', name: '개발 도구 패키지 캐시 (npm·pip)', def: false, warn: '다음 설치 때 패키지를 다시 내려받습니다.', paths: ['%LOCALAPPDATA%\\npm-cache\\*', '%LOCALAPPDATA%\\pip\\Cache\\*'] },
  { id: 'java', group: 'apps', name: 'Java 캐시', def: true, paths: ['%USERPROFILE%\\AppData\\LocalLow\\Sun\\Java\\Deployment\\cache\\*'] },
  { id: 'spotify', group: 'apps', name: 'Spotify 캐시', def: false, warn: '스트리밍 캐시입니다. 지우면 자주 듣던 곡을 다시 내려받습니다.', paths: ['%LOCALAPPDATA%\\Spotify\\Data\\*'] },

  // 그래픽 캐시·드라이버 (셰이더는 기본 해제: 지우면 다음 게임 실행 때 잠깐 끊길 수 있음)
  { id: 'shader', group: 'gpu', name: 'DirectX·드라이버 셰이더 캐시', def: false, warn: SHADER_WARN,
    paths: ['%LOCALAPPDATA%\\D3DSCache\\*', '%LOCALAPPDATA%\\NVIDIA\\DXCache\\*', '%LOCALAPPDATA%\\NVIDIA\\GLCache\\*', '%LOCALAPPDATA%\\AMD\\DxCache\\*', '%LOCALAPPDATA%\\AMD\\DxcCache\\*', '%LOCALAPPDATA%\\AMD\\VkCache\\*', '%LOCALAPPDATA%\\Intel\\ShaderCache\\*'] },
  { id: 'steamShader', group: 'gpu', name: 'Steam 게임별 셰이더 캐시', def: false, warn: SHADER_WARN, paths: ['%STEAM%\\steamapps\\shadercache\\*'] },
  { id: 'nvCache', group: 'gpu', name: 'NVIDIA 컴퓨트 캐시', def: false, warn: SHADER_WARN, paths: ['%ProgramData%\\NVIDIA Corporation\\NV_Cache\\*', '%APPDATA%\\NVIDIA\\ComputeCache\\*'] },
  { id: 'driverLeft', group: 'gpu', name: '그래픽 드라이버 설치 잔여물', def: false, paths: ['%ProgramData%\\NVIDIA Corporation\\Downloader\\*', '%SystemDrive%\\AMD\\*', '%SystemDrive%\\NVIDIA\\*'] },
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
