// 중복 파일 찾기: 크기가 같은 파일끼리 앞부분 → 전체 해시 순으로 비교해 내용이 똑같은 파일을 묶는다.
// 지울 때는 휴지통으로 보내고(되살릴 수 있음), 묶음마다 최소 한 개는 반드시 남긴다.
const path = require('path');

const DUPES_SCAN = String.raw`
$root = [string]$A.root
$min = [int64]$A.minSize
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Length -ge $min -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } | Select-Object -First 50000)
function Head($f) {
  try {
    $s = [IO.File]::OpenRead($f)
    try { $buf = New-Object byte[] 65536; $n = $s.Read($buf, 0, 65536); $md5 = [Security.Cryptography.MD5]::Create(); return [BitConverter]::ToString($md5.ComputeHash($buf, 0, $n)) } finally { $s.Dispose() }
  } catch { return $null }
}
$groups = @()
foreach ($bySize in @($files | Group-Object Length | Where-Object { $_.Count -gt 1 })) {
  # 앞 64KB 해시가 같은 것만 전체 해시로 확인 (큰 파일을 모두 읽지 않도록)
  foreach ($byHead in @($bySize.Group | Group-Object { Head $_.FullName } | Where-Object { $_.Count -gt 1 -and $_.Name })) {
    foreach ($byFull in @($byHead.Group | Group-Object { try { (Get-FileHash -LiteralPath $_.FullName -Algorithm MD5 -ErrorAction Stop).Hash } catch { '' } } | Where-Object { $_.Count -gt 1 -and $_.Name })) {
      $groups += ,@{ size = [int64]$byFull.Group[0].Length; hash = $byFull.Name; files = @($byFull.Group | Sort-Object LastWriteTime -Descending | ForEach-Object { @{ path = $_.FullName; mtime = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') } }) }
    }
  }
}
$groups = @($groups | Sort-Object { $_.size * ($_.files.Count - 1) } -Descending | Select-Object -First 300)
Emit @{ scanned = $files.Count; groups = $groups }
`;

// $A.paths 를 휴지통으로
const DUPES_DELETE = String.raw`
Add-Type -AssemblyName Microsoft.VisualBasic
$out = @()
foreach ($p in @($A.paths)) {
  try {
    $len = (Get-Item -LiteralPath $p -Force -ErrorAction Stop).Length
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
    $out += ,@{ path = $p; ok = $true; size = [int64]$len }
  } catch { $out += ,@{ path = $p; ok = $false; err = $_.Exception.Message } }
}
Emit @{ results = $out }
`;

// 검색하면 안 되는 위치 (시스템·프로그램 폴더). 문제가 있으면 이유, 없으면 null
function validateRoot(root) {
  if (!root || !path.win32.isAbsolute(root)) return '폴더를 선택하세요.';
  const r = path.win32.resolve(root).toLowerCase().replace(/\\+$/, '');
  if (/^[a-z]:$/.test(r)) return '드라이브 전체는 검색할 수 없습니다. 사진·다운로드·문서 같은 폴더를 고르세요.';
  const env = process.env;
  const blocked = [env.WINDIR, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData, env.APPDATA, env.LOCALAPPDATA]
    .filter(Boolean).map((x) => path.win32.resolve(x).toLowerCase());
  const hit = blocked.find((b) => r === b || r.startsWith(b + '\\') || b.startsWith(r + '\\'));
  if (hit) return '시스템·프로그램 폴더(또는 그 상위)는 검색할 수 없습니다. 사진·다운로드·문서 같은 개인 폴더를 고르세요.';
  return null;
}

// 지우려는 파일이 마지막 검색 결과에 있고, 묶음마다 최소 하나는 남는지 확인. 문제가 있으면 이유
function validateDelete(groups, paths) {
  const want = new Set(paths.map((p) => String(p).toLowerCase()));
  const known = new Set();
  for (const g of groups || []) {
    const files = g.files.map((f) => f.path.toLowerCase());
    files.forEach((f) => known.add(f));
    if (files.every((f) => want.has(f))) return '같은 파일 묶음을 모두 지울 수는 없습니다. 묶음마다 하나는 남겨 두세요.';
  }
  if ([...want].some((p) => !known.has(p))) return '검색 결과에 없는 파일은 지울 수 없습니다. 다시 검색하세요.';
  return null;
}

module.exports = { DUPES_SCAN, DUPES_DELETE, validateRoot, validateDelete };
