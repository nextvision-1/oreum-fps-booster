// PowerShell 실행기 + 공용 함수 라이브러리
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 주의: 이 문자열 안에서는 JS 보간(달러+중괄호)과 백틱을 쓰지 않는다.
const PSLIB = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Emit($o) { Write-Output ('@@JSON@@' + (ConvertTo-Json -InputObject $o -Depth 10 -Compress)) }

function RG($path, $name) {
  try { $k = Get-Item -LiteralPath $path -ErrorAction Stop } catch { return @{ exists = $false } }
  if (-not ($k.GetValueNames() -contains $name)) { return @{ exists = $false } }
  $kind = $k.GetValueKind($name).ToString()
  $v = $k.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
  if ($v -is [byte[]]) { $v = [Convert]::ToBase64String($v) }
  return @{ exists = $true; kind = $kind; value = $v }
}

function RS($path, $name, $kind, $value) {
  if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
  switch ($kind) {
    'DWord'       { $n = [int64]$value; if ($n -gt 2147483647) { $n -= 4294967296 }; $value = [int32]$n }
    'QWord'       { $value = [int64]$value }
    'Binary'      { $value = [Convert]::FromBase64String([string]$value) }
    'MultiString' { $value = [string[]]@($value) }
    default       { $value = [string]$value }
  }
  New-ItemProperty -LiteralPath $path -Name $name -PropertyType $kind -Value $value -Force | Out-Null
}

# 주의: RD 는 PowerShell 내장 별칭(Remove-Item)이 함수보다 우선하므로 쓰면 안 된다
function RDel($path, $name) {
  if (Test-Path -LiteralPath $path) { Remove-ItemProperty -LiteralPath $path -Name $name -ErrorAction SilentlyContinue }
}

function SG($name) {
  $s = Get-Service -Name $name -ErrorAction SilentlyContinue
  if (-not $s) { return @{ exists = $false } }
  $p = Get-ItemProperty -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\' + $name) -ErrorAction SilentlyContinue
  $d = 0; if ($p.DelayedAutostart) { $d = [int]$p.DelayedAutostart }
  return @{ exists = $true; start = [int]$p.Start; delayed = $d; status = $s.Status.ToString() }
}

function SS($name, $start, $delayed) {
  if (-not (Get-Service -Name $name -ErrorAction SilentlyContinue)) { return }
  $map = @{ 0 = 'boot'; 1 = 'system'; 2 = 'auto'; 3 = 'demand'; 4 = 'disabled' }
  $m = $map[[int]$start]
  if ([int]$start -eq 2 -and [int]$delayed -eq 1) { $m = 'delayed-auto' }
  & sc.exe config $name start= $m | Out-Null
  # sc.exe 는 실패해도 예외를 내지 않으므로 종료 코드로 확인 (5 = 권한 없음)
  if ($LASTEXITCODE -ne 0) { throw ('서비스 ' + $name + ' 설정 실패 (코드 ' + $LASTEXITCODE + ')') }
  if ([int]$start -eq 4) { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue }
}

# powercfg 실행: 실패 시 예외. -Quiet 이면 실패를 무시하고 $false 반환
# (Stop 모드에서 네이티브 stderr 를 2>&1 로 받으면 PS 5.1 이 곧바로 예외를 던지므로 이 함수 안에서만 Continue)
function PC {
  $quiet = $false
  $a = @()
  foreach ($x in $args) { if ([string]$x -eq '-Quiet') { $quiet = $true } else { $a += $x } }
  $ErrorActionPreference = 'Continue'
  $o = (@(& powercfg.exe @a 2>&1) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) {
    if ($quiet) { return $false }
    throw ('powercfg ' + $a[0] + ' 실패: ' + $o.Trim())
  }
  return $o
}

$script:GUIDRX = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'

function PG() {
  $o = [string](PC /getactivescheme)
  $g = $null
  if ($o -match $script:GUIDRX) { $g = $matches[1] }
  return @{ exists = $true; guid = $g; line = $o.Trim() }
}

function PApply() {
  $existing = @((PC /list) -split '\r?\n') | Where-Object { $_ -match 'Oreum FPS Ultimate' } | Select-Object -First 1
  if ($existing -and ($existing -match $script:GUIDRX)) { $g = $matches[1]; PC -setactive $g | Out-Null; return $g }
  # "최고의 성능" 계획이 없는 에디션(일부 노트북·Modern Standby)은 고성능 계획으로 대체
  $o = PC -Quiet -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61
  if ($o -and ($o -match $script:GUIDRX)) {
    $g = $matches[1]
    PC -changename $g 'Oreum FPS Ultimate' | Out-Null
    PC -setactive $g | Out-Null
    return $g
  }
  PC -setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c | Out-Null
  return '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
}

# 전원 계획 세부 설정. 읽을 때 어느 계획의 값인지(scheme)도 기록해, 복원할 때 그 계획에 되돌린다.
# (전원 계획을 바꾼 뒤 세부 설정을 복원하면 엉뚱한 계획에 원래 값이 들어가는 문제 방지)
function PCG($sub, $set) {
  # 조회 실패는 "값 없음"이 아니라 오류로 처리한다. 그래야 적용 전 값이 null 로 남아 적용 자체를 건너뛰고,
  # 원래 값을 모른 채 바꿔 버려 복원할 수 없게 되는 일을 막는다.
  $g = (PG).guid
  if (-not $g) { throw '현재 전원 계획을 확인할 수 없습니다.' }
  $o = PC /query $g $sub $set
  $m = [regex]::Matches($o, '0x([0-9a-fA-F]{8})')
  if ($m.Count -ge 2) {
    return @{ exists = $true; scheme = $g; ac = [Convert]::ToInt64($m[$m.Count - 2].Groups[1].Value, 16); dc = [Convert]::ToInt64($m[$m.Count - 1].Groups[1].Value, 16) }
  }
  return @{ exists = $false; scheme = $g }
}
function PCS($scheme, $sub, $set, $ac, $dc) {
  if (-not $scheme) { $scheme = 'SCHEME_CURRENT' }
  PC /setacvalueindex $scheme $sub $set $ac | Out-Null
  PC /setdcvalueindex $scheme $sub $set $dc | Out-Null
  PC /setactive SCHEME_CURRENT | Out-Null
}

# 네트워크 어댑터 DNS (어댑터 GUID 기준). NameServer 가 비어 있으면 DHCP(자동) 상태
function DnsKey($guid) { return ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\' + $guid) }
function DnsIdx($guid) {
  $a = @(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.InterfaceGuid -eq $guid })
  if (-not $a.Count) { throw ('네트워크 어댑터를 찾을 수 없습니다: ' + $guid) }
  return $a[0].ifIndex
}
function DnsSet($guid, $servers) {
  $i = DnsIdx $guid
  if (@($servers).Count) { Set-DnsClientServerAddress -InterfaceIndex $i -ServerAddresses @($servers) -ErrorAction Stop }
  else { Set-DnsClientServerAddress -InterfaceIndex $i -ResetServerAddresses -ErrorAction Stop }
  Clear-DnsClientCache -ErrorAction SilentlyContinue
}

# JSON 설정 파일의 최상위 값 하나 (예: Discord settings.json). 프로그램이 실행 중이면 종료할 때 파일을 덮어쓰므로 거부
function JPath($p) { return [Environment]::ExpandEnvironmentVariables($p) }
function JLoad($p) { return ([IO.File]::ReadAllText((JPath $p)) | ConvertFrom-Json) }
function JSave($p, $obj) { [IO.File]::WriteAllText((JPath $p), (ConvertTo-Json -InputObject $obj -Depth 20), (New-Object Text.UTF8Encoding($false))) }
function JGuard($o) { if ($o.proc -and (Get-Process -Name $o.proc -ErrorAction SilentlyContinue)) { throw ($o.proc + ' 을(를) 완전히 종료한 뒤 다시 적용하세요. (실행 중이면 설정이 덮어써집니다)') } }

function OpPrepare($o) {
  # 숨겨진 전원 설정(코어 파킹 등)은 표시 상태로 바꿔야 조회/변경 가능. 실패해도 진행
  if ($o.t -eq 'pcfg') { PC -Quiet -attributes $o.sub $o.set -ATTRIB_HIDE | Out-Null }
}

function OpRead($o) {
  switch ($o.t) {
    'reg'   { return (RG $o.path $o.name) }
    'svc'   { return (SG $o.name) }
    'power' { return (PG) }
    'pcfg'  { return (PCG $o.sub $o.set) }
    'key'   { return @{ exists = (Test-Path -LiteralPath $o.root); leaf = (Test-Path -LiteralPath $o.path) } }
    'dns'   { return @{ exists = $true; value = [string](RG (DnsKey $o.guid) 'NameServer').value } }
    'json'  {
      if (-not (Test-Path -LiteralPath (JPath $o.path))) { return @{ exists = $false; file = $false } }
      $j = JLoad $o.path
      if ($j.PSObject.Properties.Name -contains $o.key) { return @{ exists = $true; file = $true; value = $j.($o.key) } }
      return @{ exists = $false; file = $true }
    }
  }
}

function OpApply($o) {
  switch ($o.t) {
    'reg'   { RS $o.path $o.name $o.kind $o.value }
    'svc'   { SS $o.name $o.start 0 }
    'power' { PApply | Out-Null }
    'pcfg'  { PCS 'SCHEME_CURRENT' $o.sub $o.set $o.value $o.value }
    'key'   { if (-not (Test-Path -LiteralPath $o.path)) { New-Item -Path $o.path -Force | Out-Null }; Set-Item -LiteralPath $o.path -Value ([string]$o.value) }
    'dns'   { DnsSet $o.guid @($o.servers) }
    'json'  {
      JGuard $o
      $j = JLoad $o.path
      $j | Add-Member -NotePropertyName $o.key -NotePropertyValue $o.value -Force
      JSave $o.path $j
    }
  }
}

function OpRestore($o, $b) {
  switch ($o.t) {
    'reg'   {
      if ($b.exists) { RS $o.path $o.name $b.kind $b.value }
      else {
        RDel $o.path $o.name
        # cleanup: 값을 지운 뒤 비게 된 키를 위로 N단계까지 정리 (이 프로그램이 만든 키만 남지 않도록)
        $p = $o.path
        for ($i = 0; $i -lt [int]$o.cleanup -and $p; $i++) {
          $k = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue
          if (-not $k -or $k.ValueCount -gt 0 -or $k.SubKeyCount -gt 0) { break }
          Remove-Item -LiteralPath $p -Force
          # (PS 5.1 의 Split-Path 는 -LiteralPath 와 -Parent 를 함께 못 쓴다)
          $p = $p.Substring(0, [Math]::Max(0, $p.LastIndexOf('\')))
        }
      }
    }
    'svc'   { if ($b.exists) { SS $o.name $b.start $b.delayed } }
    'power' { if ($b.guid) { PC -setactive $b.guid | Out-Null } }
    'pcfg'  { if ($b.exists) { PCS $b.scheme $o.sub $o.set $b.ac $b.dc } }
    'dns'   { DnsSet $o.guid @(([string]$b.value) -split '[,\s]+' | Where-Object { $_ }) }
    'json'  {
      if (-not $b.file -or -not (Test-Path -LiteralPath (JPath $o.path))) { return }
      $j = JLoad $o.path
      # 이미 원래 값이면 (예: 프로그램이 실행 중이라 적용이 거부됐던 경우) 아무것도 하지 않는다
      $has = $j.PSObject.Properties.Name -contains $o.key
      if ((-not $b.exists -and -not $has) -or ($b.exists -and $has -and (ConvertTo-Json $j.($o.key) -Compress) -eq (ConvertTo-Json $b.value -Compress))) { return }
      JGuard $o
      if ($b.exists) { $j | Add-Member -NotePropertyName $o.key -NotePropertyValue $b.value -Force }
      else { $j.PSObject.Properties.Remove($o.key) }
      JSave $o.path $j
    }
    'key'   {
      # 상위 키가 원래 없었으면 통째로, 있었으면 새로 만든 하위 키만 지운다
      if (-not $b.exists) { if (Test-Path -LiteralPath $o.root) { Remove-Item -LiteralPath $o.root -Recurse -Force } }
      elseif (-not $b.leaf -and (Test-Path -LiteralPath $o.path)) { Remove-Item -LiteralPath $o.path -Recurse -Force }
    }
  }
}
`;

const OP_READ = String.raw`
$out = @()
foreach ($o in @($A.ops)) {
  try { $out += ,@{ ok = $true; cur = (OpRead $o) } } catch { $out += ,@{ ok = $false; err = $_.Exception.Message } }
}
Emit @{ results = $out }
`;

const OP_APPLY = String.raw`
$out = @()
foreach ($o in @($A.ops)) {
  $before = $null
  try {
    OpPrepare $o
    $before = OpRead $o
    OpApply $o
    $out += ,@{ ok = $true; before = $before }
  } catch { $out += ,@{ ok = $false; before = $before; err = $_.Exception.Message } }
}
Emit @{ results = $out }
`;

const OP_RESTORE = String.raw`
$out = @()
foreach ($i in @($A.items)) {
  # 적용 전 값을 읽지 못한 연산은 건드리지 않는다 (없던 값으로 오인해 지우는 사고 방지)
  if ($null -eq $i.before) { $out += ,@{ ok = $true; skipped = $true }; continue }
  try { OpRestore $i.op $i.before; $out += ,@{ ok = $true } } catch { $out += ,@{ ok = $false; err = $_.Exception.Message } }
}
Emit @{ results = $out }
`;

function argsBlock(args) {
  const b64 = Buffer.from(JSON.stringify(args ?? {}), 'utf8').toString('base64');
  return `$A = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))\n`;
}

/**
 * PowerShell 스크립트를 실행하고 Emit 으로 내보낸 JSON 을 돌려준다.
 */
function runPS(body, args = {}, { timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      return reject(new Error('이 프로그램은 Windows 에서만 동작합니다.'));
    }
    const file = path.join(os.tmpdir(), `ofb_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
    const script = PSLIB + '\n' + argsBlock(args) + body;
    // PowerShell 5.1 은 BOM 이 있어야 UTF-8 로 인식한다
    fs.writeFileSync(file, '﻿' + script, 'utf8');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout, encoding: 'utf8' },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(file); } catch (_) {}
        const line = String(stdout || '')
          .split(/\r?\n/)
          .reverse()
          .find((l) => l.startsWith('@@JSON@@'));
        if (line) {
          try { return resolve(JSON.parse(line.slice(8))); }
          catch (e) { return reject(new Error('결과 해석 실패: ' + e.message)); }
        }
        const msg = (stderr || (err && err.message) || '알 수 없는 오류').toString().trim();
        reject(new Error(msg.split(/\r?\n/).slice(0, 4).join(' ')));
      }
    );
  });
}

module.exports = { runPS, PSLIB, OP_READ, OP_APPLY, OP_RESTORE };
