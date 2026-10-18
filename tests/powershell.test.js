// PowerShell 스크립트 문법 검사 + 실제 Windows 에서의 통합 테스트
// 시스템 설정은 바꾸지 않는다. 쓰기 테스트는 HKCU\Software\OreumFPSBoosterTest 안에서만 하고 끝나면 지운다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runPS, PSLIB, OP_READ, OP_APPLY, OP_RESTORE } = require('../src/ps');
const { opMatches, tweakStatus } = require('../src/logic');
const { TWEAKS } = require('../src/tweaks');
const { CLEAN_ITEMS, CLEAN_LIB, CLEAN_SCAN, CLEAN_RUN, DRIVES } = require('../src/cleaner');
const { CHECK_SCRIPT } = require('../src/checks');
const { BLOAT, BLOAT_LIST, BLOAT_REMOVE } = require('../src/bloat');
const { STARTUP_SRCS, STARTUP_LIST_SCRIPT, STARTUP_SET_SCRIPT } = require('../src/startup');

const WIN = process.platform === 'win32';
const SRC = path.join(__dirname, '..', 'src');
const rawBlocks = (file) => [...fs.readFileSync(path.join(SRC, file), 'utf8').matchAll(/String\.raw`([\s\S]*?)`/g)].map((m) => m[1]);

test('모든 PowerShell 스크립트 문법 오류 없음', { skip: !WIN }, () => {
  const scripts = {
    PSLIB, OP_READ, OP_APPLY, OP_RESTORE, CLEAN_SCAN: CLEAN_LIB + CLEAN_SCAN, CLEAN_RUN: CLEAN_LIB + CLEAN_RUN, DRIVES,
    CHECK_SCRIPT, BLOAT_LIST, BLOAT_REMOVE, STARTUP_LIST_SCRIPT, STARTUP_SET_SCRIPT,
  };
  rawBlocks('main.js').forEach((s, i) => { scripts['main#' + i] = s; });
  rawBlocks('monitor.js').forEach((s, i) => { scripts['monitor#' + i] = s; });
  rawBlocks('bench.js').forEach((s, i) => { scripts['bench#' + i] = s; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofb-parse-'));
  try {
    for (const [k, v] of Object.entries(scripts)) fs.writeFileSync(path.join(dir, k.replace(/#/g, '_') + '.ps1'), '﻿' + v, 'utf8');
    const ps = String.raw`
$r = @()
foreach ($f in Get-ChildItem -LiteralPath $args[0] -Filter *.ps1) {
  $t = $null; $e = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e)
  foreach ($x in $e) { $r += ($f.BaseName + ':' + $x.Extent.StartLineNumber + ' ' + $x.Message) }
}
[Console]::OutputEncoding = [Text.Encoding]::UTF8
($r -join [Environment]::NewLine)`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `& { ${ps} } '${dir}'`], { encoding: 'utf8' }).trim();
    assert.equal(out, '', out);
    assert.ok(Object.keys(scripts).length >= 20, '검사한 스크립트 수');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PowerShell 함수 이름이 내장 별칭과 겹치지 않음 (별칭이 함수보다 우선 실행됨)', { skip: !WIN }, () => {
  const all = [PSLIB, CLEAN_LIB, CHECK_SCRIPT].join('\n');
  const names = [...all.matchAll(/^\s*function\s+([A-Za-z]\w*)/gm)].map((m) => m[1]);
  assert.ok(names.length > 10);
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(${names.map((n) => `'${n}'`).join(',')}) | Where-Object { Get-Alias -Name $_ -ErrorAction SilentlyContinue }`], { encoding: 'utf8' }).trim();
  assert.equal(out, '', '별칭과 겹치는 함수: ' + out);
});

// ───── 레지스트리 적용 → 확인 → 복원 왕복 (테스트 키 안에서만) ─────
const TK = 'Registry::HKEY_CURRENT_USER\\Software\\OreumFPSBoosterTest';
const cleanupKey = () => runPS(`if (Test-Path -LiteralPath '${TK}') { Remove-Item -LiteralPath '${TK}' -Recurse -Force }\nEmit @{ ok = $true }`);

test('reg/key 연산: 적용 후 상태 on, 복원 후 원래 값 그대로', { skip: !WIN }, async () => {
  await cleanupKey();
  try {
    // 원래 상태 준비: 기존 String 값 하나, ExpandString 하나, 상위 키만 있는 key 연산
    await runPS(String.raw`
RS $A.k 'Existing' 'String' 'orig'
New-ItemProperty -LiteralPath $A.k -Name 'Expand' -PropertyType ExpandString -Value '%TEMP%\x' -Force | Out-Null
New-Item -Path ($A.k + '\Root2') -Force | Out-Null
Emit @{ ok = $true }`, { k: TK });

    const ops = [
      { t: 'reg', path: TK, name: 'NewDword', kind: 'DWord', value: 0xffffffff },
      { t: 'reg', path: TK, name: 'Big', kind: 'DWord', value: 0x80000001 },
      { t: 'reg', path: TK, name: 'Existing', kind: 'String', value: 'changed' },
      { t: 'reg', path: TK, name: 'Expand', kind: 'String', value: 'plain' },
      { t: 'reg', path: TK, name: 'Bin', kind: 'Binary', value: Buffer.from([0x90, 0x12, 0x03, 0x80]).toString('base64') },
      { t: 'reg', path: TK + '\\Sub\\Deep', name: 'Q', kind: 'QWord', value: 5 },
      { t: 'key', root: TK + '\\Root1', path: TK + '\\Root1\\Leaf', value: '' },
      { t: 'key', root: TK + '\\Root2', path: TK + '\\Root2\\Leaf', value: '' },
    ];
    const before = (await runPS(OP_READ, { ops })).results;
    const applied = (await runPS(OP_APPLY, { ops })).results;
    applied.forEach((r, i) => assert.ok(r.ok, `apply ${i}: ${r.err}`));
    const after = (await runPS(OP_READ, { ops })).results;
    assert.equal(tweakStatus(ops, after), 'on', JSON.stringify(after));

    const items = ops.map((op, i) => ({ op, before: applied[i].before })).reverse();
    const restored = (await runPS(OP_RESTORE, { items })).results;
    restored.forEach((r, i) => assert.ok(r.ok, `restore ${i}: ${r.err}`));

    const back = (await runPS(OP_READ, { ops })).results;
    ops.forEach((op, i) => assert.deepEqual(back[i].cur, before[i].cur, `${op.name || op.path} 복원 불일치`));
    const exp = (await runPS(`Emit (RG $A.k 'Expand')`, { k: TK }));
    assert.deepEqual(exp, { exists: true, kind: 'ExpandString', value: '%TEMP%\\x' }, 'ExpandString 은 펼치지 않은 원래 값으로 복원');
    const keys = await runPS(String.raw`Emit @{ r1 = (Test-Path -LiteralPath ($A.k + '\Root1')); r2 = (Test-Path -LiteralPath ($A.k + '\Root2')); leaf2 = (Test-Path -LiteralPath ($A.k + '\Root2\Leaf')) }`, { k: TK });
    assert.deepEqual(keys, { r1: false, r2: true, leaf2: false }, '원래 있던 상위 키는 남기고 새로 만든 키만 삭제');
  } finally {
    await cleanupKey();
  }
});

test('복원: 적용 전 값을 모르는(before=null) 연산은 건드리지 않음', { skip: !WIN }, async () => {
  await cleanupKey();
  try {
    await runPS(`RS $A.k 'Keep' 'DWord' 7\nEmit @{ ok = $true }`, { k: TK });
    const op = { t: 'reg', path: TK, name: 'Keep', kind: 'DWord', value: 1 };
    const r = (await runPS(OP_RESTORE, { items: [{ op, before: null }] })).results;
    assert.equal(r[0].skipped, true);
    const cur = (await runPS(OP_READ, { ops: [op] })).results[0].cur;
    assert.equal(cur.value, 7);
  } finally {
    await cleanupKey();
  }
});

test('PC: powercfg 실패는 예외, -Quiet 이면 false (PS 5.1 stderr 문제 회귀 방지)', { skip: !WIN }, async () => {
  const r = await runPS(String.raw`
$q = PC -Quiet -attributes 11111111-1111-1111-1111-111111111111 22222222-2222-2222-2222-222222222222 -ATTRIB_HIDE
$threw = $false
try { PC /query SCHEME_CURRENT 11111111-1111-1111-1111-111111111111 22222222-2222-2222-2222-222222222222 | Out-Null } catch { $threw = $true }
Emit @{ quiet = $q; threw = $threw; pg = (PG) }`);
  assert.equal(r.quiet, false);
  assert.equal(r.threw, true);
  assert.match(r.pg.guid, /^[0-9a-f-]{36}$/i);
});

test('SS: sc.exe 실패를 오류로 보고 (권한 없을 때)', { skip: !WIN }, async (t) => {
  const admin = await runPS(`Emit @{ a = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }`);
  if (admin.a) return t.skip('관리자 권한에서는 실제 서비스가 바뀌므로 건너뜀');
  const r = await runPS(`try { SS 'Fax' 3 0; Emit @{ threw = $false } } catch { Emit @{ threw = $true; msg = $_.Exception.Message } }`);
  // Fax 서비스가 없는 PC 에서는 SS 가 아무 것도 하지 않는다
  const exists = await runPS(`Emit (SG 'Fax')`);
  if (exists.exists) assert.equal(r.threw, true, '권한 없이 서비스 변경이 성공으로 기록되면 안 됨');
});

// ───── 읽기 전용 스크립트를 실제로 실행 ─────
test('모든 최적화 항목의 현재 값 읽기 성공 (pcfg 는 계획 GUID 포함)', { skip: !WIN }, async () => {
  const ops = TWEAKS.flatMap((t) => t.ops);
  const res = (await runPS(OP_READ, { ops })).results;
  assert.equal(res.length, ops.length);
  res.forEach((r, i) => assert.ok(r.ok, `${JSON.stringify(ops[i])}: ${r.err}`));
  ops.forEach((o, i) => {
    if (o.t === 'pcfg') assert.match(String(res[i].cur.scheme), /^[0-9a-f-]{36}$/i, '전원 세부 설정에 계획 GUID 기록');
    opMatches(o, res[i].cur); // 예외 없이 판정
  });
});

test('정밀 시스템 검사 실행', { skip: !WIN, timeout: 5 * 60 * 1000 }, async () => {
  const res = (await runPS(CHECK_SCRIPT, {}, { timeout: 5 * 60 * 1000 })).results;
  assert.ok(res.length >= 12, `결과 ${res.length}개`);
  for (const r of res) {
    assert.ok(['ok', 'warn', 'bad', 'info'].includes(r.status), JSON.stringify(r));
    assert.ok(r.group && r.name, JSON.stringify(r));
    if (r.fix) assert.ok(['tweak', 'page', 'action'].includes(r.fix.type));
    if (r.fix?.type === 'tweak') assert.ok(TWEAKS.some((t) => t.id === r.fix.id), r.fix.id);
  }
});

test('파일 청소 스캔 (삭제 없음) / 드라이브 목록', { skip: !WIN, timeout: 10 * 60 * 1000 }, async () => {
  const res = (await runPS(CLEAN_LIB + CLEAN_SCAN, { items: CLEAN_ITEMS }, { timeout: 10 * 60 * 1000 })).results;
  assert.equal(res.length, CLEAN_ITEMS.length);
  for (const r of res) assert.ok(Number(r.size) >= 0 && Number(r.count) >= 0, JSON.stringify(r));
  const d = await runPS(DRIVES);
  assert.ok([].concat(d.drives).some((x) => x.size > 0));
});

test('파일 청소 실행: 지정 시간보다 새 파일은 남기고 빈 하위 폴더 정리', { skip: !WIN }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofb-clean-'));
  try {
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'old.tmp'), 'x'.repeat(100));
    fs.writeFileSync(path.join(dir, 'a', 'b', 'old2.tmp'), 'y'.repeat(50));
    fs.writeFileSync(path.join(dir, 'new.tmp'), 'z');
    fs.mkdirSync(path.join(dir, 'fresh')); // 방금 만든 빈 폴더 (다른 프로그램이 쓰는 중일 수 있음)
    const old = new Date(Date.now() - 5 * 3600 * 1000);
    for (const p of ['old.tmp', 'a/b/old2.tmp', 'a/b', 'a']) fs.utimesSync(path.join(dir, p), old, old);
    const items = [{ id: 't', paths: [dir + '\\*'], olderH: 2 }];
    const scan = (await runPS(CLEAN_LIB + CLEAN_SCAN, { items })).results[0];
    assert.equal(scan.count, 2);
    assert.equal(scan.size, 150);
    const run = (await runPS(CLEAN_LIB + CLEAN_RUN, { items })).results[0];
    assert.equal(run.count, 2);
    assert.equal(run.freed, 150);
    assert.ok(fs.existsSync(path.join(dir, 'new.tmp')), '새 파일은 남아야 함');
    assert.ok(!fs.existsSync(path.join(dir, 'a')), '비게 된 오래된 하위 폴더는 정리');
    assert.ok(fs.existsSync(path.join(dir, 'fresh')), '최근 만든 빈 폴더는 유지');
    assert.ok(fs.existsSync(dir), '대상 폴더 자체는 유지');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('기본 앱 목록 / 시작 프로그램 목록 조회', { skip: !WIN, timeout: 3 * 60 * 1000 }, async () => {
  const b = [].concat((await runPS(BLOAT_LIST, { list: BLOAT })).items ?? []);
  for (const x of b) assert.ok(x.full && x.pkg, JSON.stringify(x));
  const s = [].concat((await runPS(STARTUP_LIST_SCRIPT, { srcs: STARTUP_SRCS })).items ?? []);
  for (const x of s) {
    assert.ok(STARTUP_SRCS.some((y) => y.src === x.src), x.src);
    assert.equal(typeof x.enabled, 'boolean');
    assert.ok(x.name && x.label);
  }
});

test('기본 앱 제거: 목록에 없는 패키지는 거부', { skip: !WIN }, async () => {
  const r = [].concat((await runPS(BLOAT_REMOVE, { list: ['Microsoft.WindowsCalculator_0.0.0.0_x64__8wekyb3d8bbwe', 'Not.A.Package'], patterns: BLOAT.map((x) => x.pattern) })).results);
  assert.equal(r.length, 2);
  r.forEach((x) => assert.equal(x.ok, false));
});

test('시작 프로그램 켜기/끄기 값 형식 (테스트 키에 기록)', { skip: !WIN }, async () => {
  await cleanupKey();
  try {
    await runPS(STARTUP_SET_SCRIPT, { ap: TK, name: 'X', enabled: false });
    const off = await runPS(`Emit (RG $A.k 'X')`, { k: TK });
    const b = Buffer.from(off.value, 'base64');
    assert.equal(off.kind, 'Binary');
    assert.equal(b.length, 12);
    assert.equal(b[0], 3);
    await runPS(STARTUP_SET_SCRIPT, { ap: TK, name: 'X', enabled: true });
    const on = Buffer.from((await runPS(`Emit (RG $A.k 'X')`, { k: TK })).value, 'base64');
    assert.equal(on[0], 2);
  } finally {
    await cleanupKey();
  }
});

test('runPS: 한글·따옴표가 든 인자를 그대로 전달, 오류는 reject', { skip: !WIN }, async () => {
  const v = "오름 'FPS' \"부스터\" $env:TEMP `n";
  const r = await runPS('Emit @{ v = $A.v }', { v });
  assert.equal(r.v, v);
  await assert.rejects(runPS('throw "일부러 낸 오류"'), /일부러 낸 오류/);
});
