// 루티미제 비교 후 추가한 기능들: 새 연산(json·dns·레지스트리 정리), 동적 항목, 게임 프로필, 중복 찾기, 모니터, 시작 프로그램 확장
// 시스템 설정은 바꾸지 않는다. 쓰기는 테스트 키(HKCU\Software\OreumFPSBoosterTest2)와 임시 폴더에서만.
// (테스트 파일들은 동시에 실행되므로 powershell.test.js 와 다른 키를 쓴다)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runPS, OP_READ, OP_APPLY, OP_RESTORE } = require('../src/ps');
const { opMatches, tweakStatus, dnsList } = require('../src/logic');
const { TWEAKS } = require('../src/tweaks');
const { DYNAMIC } = require('../src/dynamic');
const { profileOps, validateExe } = require('../src/profiles');
const { DUPES_SCAN, validateRoot, validateDelete } = require('../src/dupes');
const { DISPLAY_LIST } = require('../src/display');
const { TASKS_LIST_SCRIPT, SVC_LIST_SCRIPT } = require('../src/startup');

const WIN = process.platform === 'win32';
const TK = 'Registry::HKEY_CURRENT_USER\\Software\\OreumFPSBoosterTest2';
const cleanupKey = () => runPS(`if (Test-Path -LiteralPath '${TK}') { Remove-Item -LiteralPath '${TK}' -Recurse -Force }\nEmit @{ ok = $true }`);

test('logic: dns·json 상태 판정', () => {
  assert.deepEqual(dnsList('1.1.1.1,1.0.0.1'), ['1.1.1.1', '1.0.0.1']);
  assert.deepEqual(dnsList('8.8.8.8 8.8.4.4'), ['8.8.8.8', '8.8.4.4']);
  assert.deepEqual(dnsList(''), []);
  assert.equal(opMatches({ t: 'dns', servers: ['1.1.1.1', '1.0.0.1'] }, { value: '1.1.1.1 1.0.0.1' }), true);
  assert.equal(opMatches({ t: 'dns', servers: ['1.1.1.1', '1.0.0.1'] }, { value: '' }), false);
  assert.equal(opMatches({ t: 'json', value: false }, { exists: true, value: false }), true);
  assert.equal(opMatches({ t: 'json', value: false }, { exists: true, value: true }), false);
  assert.equal(opMatches({ t: 'json', value: false }, { exists: false }), false);
});

test('새 최적화 항목 정의: 동적 항목은 DYNAMIC 에 있고 권장 항목은 안전 등급', () => {
  for (const t of TWEAKS.filter((x) => x.dynamic)) assert.ok(DYNAMIC[t.dynamic], `${t.id}: dynamic '${t.dynamic}' 없음`);
  for (const id of ['swapfx', 'discordhw', 'hidpower', 'nicpower', 'dns', 'autologger', 'noreinstall', 'cortana']) assert.ok(TWEAKS.some((t) => t.id === id), id);
  assert.ok(TWEAKS.filter((t) => t.cat !== 'personal').length >= 49, '성능 최적화 49개 이상');
});

test('동적 항목: build 가 대상이 없거나 조건이 안 맞으면 빈 목록', () => {
  assert.deepEqual(DYNAMIC.swapfx.build({ build: 19045, value: '' }), [], 'Windows 10 은 해당 없음');
  const sw = DYNAMIC.swapfx.build({ build: 26100, value: 'VRROptimizeEnable=0;SwapEffectUpgradeEnable=0;' })[0];
  assert.equal(sw.value, 'VRROptimizeEnable=0;SwapEffectUpgradeEnable=1;', '기존 전역 설정은 유지하고 해당 값만 바꾼다');
  // DNS: 지금 DNS 보다 10ms 이상 빠를 때만, 응답 없으면 바꾸지 않음
  assert.deepEqual(DYNAMIC.dns.build({ list: ['{a}'], cur: 20, cf: 15, gg: 30 }), []);
  assert.deepEqual(DYNAMIC.dns.build({ list: ['{a}'], cur: 60, cf: 9999, gg: 9999 }), []);
  assert.deepEqual(DYNAMIC.dns.build({ list: ['{a}'], cur: 60, cf: 30, gg: 12 }), [{ t: 'dns', guid: '{a}', servers: ['8.8.8.8', '8.8.4.4'] }]);
  assert.deepEqual(DYNAMIC.discord.build({ exists: false }), []);
  // 입력장치: Binary 로 저장된 값은 Binary 로 유지
  const hid = DYNAMIC.hidpower.build({ list: [{ key: 'K', ssKind: 'Binary' }, { key: 'L', ssKind: 'DWord' }] });
  assert.equal(hid.find((o) => o.path === 'K' && o.name === 'SelectiveSuspendEnabled').kind, 'Binary');
  assert.equal(hid.find((o) => o.path === 'L' && o.name === 'SelectiveSuspendEnabled').kind, 'DWord');
});

test('게임 프로필: exe 검증과 연산', () => {
  assert.match(validateExe('C:\\Games\\x.txt', {}), /실행 파일/);
  assert.match(validateExe('C:\\Games\\svchost.exe', {}), /Windows/);
  assert.match(validateExe((process.env.WINDIR || 'C:\\Windows') + '\\notepad.exe', {}), /Windows 폴더/);
  assert.match(validateExe('D:\\B\\game.exe', { 'C:\\A\\game.exe': {} }), /같은 이름/);
  assert.equal(validateExe('C:\\Games\\Valorant\\VALORANT.exe', {}), null);
  const ops = profileOps('C:\\Games\\a b\\Game.exe');
  assert.equal(ops[0].name, 'C:\\Games\\a b\\Game.exe');
  assert.equal(ops[0].value, 'GpuPreference=2;');
  assert.match(ops[1].path, /Image File Execution Options\\Game\.exe\\PerfOptions$/);
  assert.equal(ops[1].cleanup, 2);
});

test('중복 찾기: 검색 위치와 삭제 대상 검증', () => {
  assert.ok(validateRoot('C:\\'));
  assert.ok(validateRoot(process.env.WINDIR || 'C:\\Windows'));
  assert.ok(validateRoot(os.homedir()), '사용자 폴더 최상위(AppData 포함)는 거부');
  assert.equal(validateRoot(path.join(os.homedir(), 'Downloads')), null);
  const groups = [{ files: [{ path: 'C:\\a\\1.jpg' }, { path: 'C:\\b\\1.jpg' }] }];
  assert.ok(validateDelete(groups, ['C:\\a\\1.jpg', 'C:\\b\\1.jpg']), '묶음 전체 삭제 거부');
  assert.ok(validateDelete(groups, ['C:\\x\\other.jpg']), '검색 결과 밖 거부');
  assert.equal(validateDelete(groups, ['c:\\B\\1.JPG']), null, '대소문자 무시');
});

// ───── PowerShell 통합 ─────
test('json 연산: 적용·복원 왕복, 다른 키 보존, 실행 중이면 거부', { skip: !WIN }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofb-json-'));
  const file = path.join(dir, 'settings.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ keep: { a: 1 }, other: 'x' }));
    const op = { t: 'json', path: file, key: 'enableHardwareAcceleration', value: false };
    const before = (await runPS(OP_READ, { ops: [op] })).results;
    assert.deepEqual([].concat(before)[0].cur, { exists: false, file: true });
    const ap = [].concat((await runPS(OP_APPLY, { ops: [op] })).results);
    assert.ok(ap[0].ok, ap[0].err);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(j.enableHardwareAcceleration, false);
    assert.deepEqual(j.keep, { a: 1 });
    assert.equal(tweakStatus([op], [].concat((await runPS(OP_READ, { ops: [op] })).results)), 'on');
    const rs = [].concat((await runPS(OP_RESTORE, { items: [{ op, before: ap[0].before }] })).results);
    assert.ok(rs[0].ok, rs[0].err);
    const back = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal('enableHardwareAcceleration' in back, false);
    assert.equal(back.other, 'x');
    // 실행 중인 프로그램(여기서는 PowerShell 자신)의 설정은 바꾸지 않는다
    const guarded = [].concat((await runPS(OP_APPLY, { ops: [{ ...op, proc: 'powershell' }] })).results);
    assert.equal(guarded[0].ok, false);
    assert.match(guarded[0].err, /종료한 뒤/);
    // 적용이 거부돼 값이 그대로면, 되돌리기는 실행 중이어도 성공(할 일 없음)
    const rs2 = [].concat((await runPS(OP_RESTORE, { items: [{ op: { ...op, proc: 'powershell' }, before: guarded[0].before }] })).results);
    assert.ok(rs2[0].ok, rs2[0].err);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('레지스트리 복원 cleanup: 새로 만든 빈 키만 정리', { skip: !WIN }, async () => {
  await cleanupKey();
  try {
    await runPS(`New-Item -Path ($A.k + '\\Keep') -Force | Out-Null\nRS ($A.k + '\\Keep') 'v' 'DWord' 1\nEmit @{ ok = $true }`, { k: TK });
    const op = { t: 'reg', path: TK + '\\Game.exe\\PerfOptions', name: 'CpuPriorityClass', kind: 'DWord', value: 3, cleanup: 2 };
    const ap = [].concat((await runPS(OP_APPLY, { ops: [op] })).results);
    assert.ok(ap[0].ok, ap[0].err);
    const rs = [].concat((await runPS(OP_RESTORE, { items: [{ op, before: ap[0].before }] })).results);
    assert.ok(rs[0].ok, rs[0].err);
    const st = await runPS(String.raw`Emit @{ game = (Test-Path -LiteralPath ($A.k + '\Game.exe')); root = (Test-Path -LiteralPath $A.k); keep = (Test-Path -LiteralPath ($A.k + '\Keep')) }`, { k: TK });
    assert.deepEqual(st, { game: false, root: true, keep: true }, '2단계만 지우고, 값이 있는 상위 키는 남긴다');
  } finally { await cleanupKey(); }
});

test('동적 항목 스크립트가 실제 PC 에서 오류 없이 연산을 만들고, 그 연산을 읽을 수 있음', { skip: !WIN, timeout: 5 * 60 * 1000 }, async () => {
  for (const [k, d] of Object.entries(DYNAMIC)) {
    const r = await runPS(d.script, {}, { timeout: 120000 });
    const ops = d.build(r);
    assert.ok(Array.isArray(ops), k);
    if (!ops.length) continue;
    const res = [].concat((await runPS(OP_READ, { ops })).results);
    res.forEach((x, i) => assert.ok(x.ok, `${k} 읽기 실패: ${JSON.stringify(ops[i])} ${x.err}`));
    for (const o of ops) if (o.t === 'reg') assert.match(o.path, /^Registry::HKEY_/, `${k}: 경로 형식`);
  }
});

test('모니터·예약 작업·서비스 목록 조회 (읽기 전용)', { skip: !WIN, timeout: 3 * 60 * 1000 }, async () => {
  const d = [].concat((await runPS(DISPLAY_LIST)).list ?? []);
  for (const m of d) assert.ok(m.device && Number(m.max) >= Number(m.current), JSON.stringify(m));
  const t = [].concat((await runPS(TASKS_LIST_SCRIPT)).items ?? []);
  for (const x of t) { assert.ok(!x.path.startsWith('\\Microsoft\\'), x.path); assert.equal(typeof x.enabled, 'boolean'); }
  const s = [].concat((await runPS(SVC_LIST_SCRIPT, { known: [] })).items ?? []);
  for (const x of s) {
    assert.ok(!/^"?[A-Z]:\\WINDOWS\\/i.test(x.cmd), 'Windows 폴더 서비스 제외: ' + x.cmd);
    assert.ok(!/Defender|chromoting|Remote Desktop|NVDisplay|Audio/i.test(x.name + ' ' + x.display), '보호 서비스 제외: ' + x.name);
  }
});

test('중복 찾기 스크립트: 내용이 같은 파일만 묶음', { skip: !WIN }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofb-dup-'));
  try {
    const big = Buffer.alloc(150000, 1);
    const near = Buffer.from(big); near[120000] = 9;
    fs.writeFileSync(path.join(dir, 'a.bin'), big);
    fs.writeFileSync(path.join(dir, 'b.bin'), big);
    fs.writeFileSync(path.join(dir, 'near.bin'), near);
    fs.writeFileSync(path.join(dir, 'other.bin'), Buffer.alloc(150000, 2));
    const r = await runPS(DUPES_SCAN, { root: dir, minSize: 1024 });
    const g = [].concat(r.groups);
    assert.equal(g.length, 1);
    assert.deepEqual([].concat(g[0].files).map((f) => path.basename(f.path)).sort(), ['a.bin', 'b.bin']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('새 모듈 PowerShell 문법 검사', { skip: !WIN }, () => {
  const blocks = ['dynamic.js', 'display.js', 'dupes.js', 'startup.js'].flatMap((f) =>
    [...fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').matchAll(/String\.raw`([\s\S]*?)`/g)].map((m) => [f, m[1]]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofb-parse2-'));
  try {
    blocks.forEach(([f, s], i) => fs.writeFileSync(path.join(dir, `${f}_${i}.ps1`), '\ufeff' + s, 'utf8'));
    const ps = String.raw`
$r = @()
foreach ($f in Get-ChildItem -LiteralPath $args[0] -Filter *.ps1) {
  $t = $null; $e = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e)
  foreach ($x in $e) { $r += ($f.BaseName + ':' + $x.Extent.StartLineNumber + ' ' + $x.Message) }
}
($r -join [Environment]::NewLine)`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `& { ${ps} } '${dir}'`], { encoding: 'utf8' }).trim();
    assert.equal(out, '', out);
    assert.ok(blocks.length >= 12);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
