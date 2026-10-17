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

function RD($path, $name) {
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
  if ([int]$start -eq 4) { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue }
}

function PG() {
  $o = (powercfg /getactivescheme) | Out-String
  $g = $null
  if ($o -match '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') { $g = $matches[1] }
  return @{ exists = $true; guid = $g; line = $o.Trim() }
}

function PApply() {
  $rx = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'
  $existing = (powercfg /list) | Where-Object { $_ -match 'Oreum FPS Ultimate' } | Select-Object -First 1
  if ($existing -and ($existing -match $rx)) { $g = $matches[1]; powercfg -setactive $g | Out-Null; return $g }
  $o = (powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>&1) | Out-String
  if ($o -match $rx) {
    $g = $matches[1]
    powercfg -changename $g 'Oreum FPS Ultimate' | Out-Null
    powercfg -setactive $g | Out-Null
    return $g
  }
  powercfg -setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c | Out-Null
  return '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
}

# 전원 계획 세부 설정 (현재 활성 계획)
function PCG($sub, $set) {
  $o = (powercfg /query SCHEME_CURRENT $sub $set) | Out-String
  $m = [regex]::Matches($o, '0x([0-9a-fA-F]{8})')
  if ($m.Count -ge 2) {
    return @{ exists = $true; ac = [Convert]::ToInt64($m[$m.Count - 2].Groups[1].Value, 16); dc = [Convert]::ToInt64($m[$m.Count - 1].Groups[1].Value, 16) }
  }
  return @{ exists = $false }
}
function PCS($sub, $set, $ac, $dc) {
  powercfg /setacvalueindex SCHEME_CURRENT $sub $set $ac | Out-Null
  powercfg /setdcvalueindex SCHEME_CURRENT $sub $set $dc | Out-Null
  powercfg /setactive SCHEME_CURRENT | Out-Null
}

function OpPrepare($o) {
  # 숨겨진 전원 설정(코어 파킹 등)은 표시 상태로 바꿔야 조회/변경 가능
  if ($o.t -eq 'pcfg') { powercfg -attributes $o.sub $o.set -ATTRIB_HIDE 2>&1 | Out-Null }
}

function OpRead($o) {
  switch ($o.t) {
    'reg'   { return (RG $o.path $o.name) }
    'svc'   { return (SG $o.name) }
    'power' { return (PG) }
    'pcfg'  { return (PCG $o.sub $o.set) }
    'key'   { return @{ exists = (Test-Path -LiteralPath $o.root); leaf = (Test-Path -LiteralPath $o.path) } }
  }
}

function OpApply($o) {
  switch ($o.t) {
    'reg'   { RS $o.path $o.name $o.kind $o.value }
    'svc'   { SS $o.name $o.start 0 }
    'power' { PApply | Out-Null }
    'pcfg'  { PCS $o.sub $o.set $o.value $o.value }
    'key'   { if (-not (Test-Path -LiteralPath $o.path)) { New-Item -Path $o.path -Force | Out-Null }; Set-Item -LiteralPath $o.path -Value ([string]$o.value) }
  }
}

function OpRestore($o, $b) {
  switch ($o.t) {
    'reg'   { if ($b.exists) { RS $o.path $o.name $b.kind $b.value } else { RD $o.path $o.name } }
    'svc'   { if ($b.exists) { SS $o.name $b.start $b.delayed } }
    'power' { if ($b.guid) { powercfg -setactive $b.guid | Out-Null } }
    'pcfg'  { if ($b.exists) { PCS $o.sub $o.set $b.ac $b.dc } }
    'key'   { if (-not $b.exists -and (Test-Path -LiteralPath $o.root)) { Remove-Item -LiteralPath $o.root -Recurse -Force } }
  }
}
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

module.exports = { runPS };
