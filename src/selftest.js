// 자가진단 모드: OreumFPSBooster.exe --self-test
// 실제 PC(관리자 권한)에서 최적화 적용 → 확인 → 모두 되돌리기 왕복이 원래 값으로 정확히 돌아오는지 검사하고,
// 검사·청소 스캔·벤치마크·업데이트 확인을 실행해 바탕화면에 보고서를 남긴다. 창은 띄우지 않는다.
// 이미 이 프로그램으로 적용해 둔 항목은 사용자의 설정이므로 건드리지 않는다.
const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPS, OP_READ } = require('./ps');
const { arr } = require('./logic');

// 상태 비교에서 의미 있는 값만 남긴다 (서비스 실행 상태처럼 되돌리기 대상이 아닌 값은 제외)
function essence(op, cur) {
  if (!cur) return null;
  switch (op.t) {
    case 'reg': return { exists: !!cur.exists, kind: cur.kind ?? null, value: cur.value ?? null };
    case 'svc': return { exists: !!cur.exists, start: cur.start ?? null, delayed: cur.delayed ?? 0 };
    case 'power': return { guid: cur.guid ?? null };
    case 'pcfg': return { exists: !!cur.exists, scheme: cur.scheme ?? null, ac: cur.ac ?? null, dc: cur.dc ?? null };
    case 'key': return { exists: !!cur.exists, leaf: !!cur.leaf };
    default: return cur;
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const describe = (op) => op.t === 'reg' ? `${op.path.replace('Registry::', '')}\\${op.name}` : op.t === 'svc' ? `서비스 ${op.name}` : op.t === 'pcfg' ? `전원 설정 ${op.set}` : op.t === 'key' ? op.path.replace('Registry::', '') : '전원 계획';

async function readAll(tweaks, resolveOps) {
  const list = [];
  for (const t of tweaks) list.push({ t, ops: await resolveOps(t) });
  const ops = list.flatMap((x) => x.ops);
  const res = arr((await runPS(OP_READ, { ops })).results);
  let i = 0;
  return list.map(({ t, ops: o }) => ({ t, ops: o, reads: o.map(() => res[i++]) }));
}

async function runSelfTest(d) {
  const lines = [];
  const say = (s = '') => { lines.push(s); process.stdout.write(s + '\n'); };
  const section = (s) => { say(''); say('■ ' + s); };
  const t0 = Date.now();
  let failures = 0;
  const fail = (s) => { failures++; say('  ✖ ' + s); };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(app.getPath('desktop'), `OreumFPSBooster-자가진단-${stamp}.txt`);
  const flush = () => { try { fs.writeFileSync(outFile, '﻿' + lines.join('\r\n'), 'utf8'); } catch (_) {} };

  say(`Oreum FPS Booster v${app.getVersion()} 자가진단 — ${new Date().toLocaleString('ko-KR')}`);
  try {
    const info = await runPS(String.raw`
$os = Get-CimInstance Win32_OperatingSystem
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Emit @{ os = ($os.Caption + ' ' + $os.BuildNumber); admin = $admin; cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim(); gpu = ((@(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })) -join ', ') }`);
    say(`OS: ${info.os} · CPU: ${info.cpu} · GPU: ${info.gpu}`);
    say(`관리자 권한: ${info.admin ? '예' : '아니오'}`);
    if (!info.admin && !process.argv.includes('--no-apply')) fail('관리자 권한이 아닙니다. 최적화 왕복 검사는 관리자 권한이 필요합니다.');
  } catch (e) { fail('시스템 정보 확인 실패: ' + e.message); }
  flush();

  // ───── 1. 최적화 적용 → 되돌리기 왕복 ─────
  section('최적화 적용 → 되돌리기 왕복 검사');
  if (process.argv.includes('--no-apply')) say('  (--no-apply: 건너뜀)');
  else await roundTrip(d, say, fail, outFile);
  flush();
  return finishRest(d, { say, section, fail, flush, outFile, t0, failures: () => failures });
}

async function roundTrip(d, say, fail, outFile) {
  const backedUp = d.loadState().tweaks;
  const skip = d.TWEAKS.filter((t) => backedUp[t.id]);
  const targets = d.TWEAKS.filter((t) => !backedUp[t.id]);
  if (skip.length) say(`  (이미 적용해 둔 ${skip.length}개는 건드리지 않음: ${skip.map((t) => t.name).join(', ')})`);
  try {
    say('  시스템 복원 지점 만드는 중…');
    try { await runPS(d.ACTION_SCRIPTS.restorePoint, {}, { timeout: 10 * 60 * 1000 }); say('  ✔ 복원 지점 생성'); }
    catch (e) { say('  ! 복원 지점을 만들지 못함 (계속 진행): ' + e.message); }

    const before = await readAll(targets, d.resolveOps);
    // 시작 전 값을 먼저 파일로 남겨, 도중에 멈춰도 원래 값을 알 수 있게 한다
    fs.writeFileSync(outFile.replace(/\.txt$/, '-원래값.json'), JSON.stringify(before.map((x) => ({ id: x.t.id, ops: x.ops, reads: x.reads })), null, 1));
    const ids = targets.map((t) => t.id);
    say(`  ${ids.length}개 항목 적용 중…`);
    const ap = await d.exclusive(() => d.applyTweaks(ids, { silent: true }));
    ap.errors.forEach((e) => fail('적용 오류: ' + e));
    const st = await d.getStatus();
    const notOn = targets.filter((t) => st[t.id]?.status !== 'on' && st[t.id]?.status !== 'na');
    say(`  적용 후 상태: ${targets.length - notOn.length}/${targets.length}개 적용됨`);
    notOn.forEach((t) => fail(`적용 후에도 "${t.name}" 상태가 ${st[t.id]?.status}`));

    say('  모두 되돌리는 중…');
    const rv = await d.exclusive(() => d.revertTweaks(ids));
    rv.errors.forEach((e) => fail('되돌리기 오류: ' + e));
    const after = await readAll(targets, d.resolveOps);
    let ok = 0, total = 0;
    after.forEach((x, i) => x.ops.forEach((op, j) => {
      total++;
      const a = essence(op, before[i].reads[j]?.cur), b = essence(op, x.reads[j]?.cur);
      if (same(a, b)) ok++;
      else fail(`"${x.t.name}" ${describe(op)} 원래 값과 다름: 전 ${JSON.stringify(a)} → 후 ${JSON.stringify(b)}`);
    }));
    say(`  되돌린 뒤 원래 값과 일치: ${ok}/${total}개 값`);
    const left = Object.keys(d.loadState().tweaks).filter((id) => ids.includes(id));
    if (left.length) fail(`백업에 남은 항목(복원 실패분): ${left.join(', ')}`);
  } catch (e) { fail('왕복 검사 중단: ' + e.stack); }
}

async function finishRest(d, { say, section, fail, flush, outFile, t0, failures }) {
  // ───── 2. 시스템 검사 ─────
  section('정밀 시스템 검사');
  try {
    const t = Date.now();
    const res = arr((await runPS(d.CHECK_SCRIPT, {}, { timeout: 5 * 60 * 1000 })).results);
    const c = { ok: 0, warn: 0, bad: 0, info: 0 };
    res.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    say(`  ${res.length}개 항목 (${Math.round((Date.now() - t) / 1000)}초) — 정상 ${c.ok} · 주의 ${c.warn} · 위험 ${c.bad} · 참고 ${c.info}`);
    res.filter((r) => r.status !== 'ok').forEach((r) => say(`  [${r.status}] ${r.group} / ${r.name}: ${r.value}`));
  } catch (e) { fail('시스템 검사 실패: ' + e.message); }
  flush();

  // ───── 3. 청소 스캔 (삭제 없음) ─────
  section('파일 청소 스캔 (삭제하지 않음)');
  try {
    const res = arr((await runPS(d.CLEAN_LIB + d.CLEAN_SCAN, { items: d.CLEAN_ITEMS }, { timeout: 10 * 60 * 1000 })).results);
    const sum = res.reduce((s, r) => s + Number(r.size || 0), 0);
    say(`  ${res.length}개 항목, 정리 가능 ${(sum / 1048576).toFixed(0)} MB`);
    res.filter((r) => r.count > 0).forEach((r) => say(`  ${r.id}: ${(r.size / 1048576).toFixed(1)} MB (${r.count}개)`));
  } catch (e) { fail('청소 스캔 실패: ' + e.message); }
  flush();

  // ───── 4. PresentMon · 업데이트 ─────
  section('게임 FPS 측정 도구 · 업데이트');
  try {
    const pm = d.bench.pmFind();
    if (!pm) say('  PresentMon.exe 없음 (첫 측정 때 내려받음)');
    else { await d.bench.pmVerify(pm); say('  ✔ PresentMon 서명 확인: ' + pm); }
  } catch (e) { fail('PresentMon: ' + e.message); }
  try {
    await new Promise((r) => { d.updater.init(() => {}); r(); });
    const st = await d.updater.check();
    say(`  업데이트 확인: ${st.status}${st.version ? ' v' + st.version : ''}${st.error ? ' — ' + st.error : ''}`);
  } catch (e) { say('  업데이트 확인 실패: ' + e.message); }
  flush();

  // ───── 5. 시스템 벤치마크 ─────
  section('시스템 벤치마크 (약 45초, 그래픽 창이 잠시 뜹니다)');
  try {
    const run = await d.bench.runSystemBench({ label: '자가진단', getIdle: () => ({ cpu: null }), progress: () => {} });
    const m = run.metrics;
    say(`  그래픽 ${m.gpuFps ?? '-'} FPS (1% Low ${m.gpuLow1 ?? '-'}, ${run.env.gpu || 'GPU 확인 불가'}) · CPU 싱글 ${m.cpuSingle} / 멀티 ${m.cpuMulti} · 끊김 ${m.spikes}회 · 핑 ${m.ping ? Math.round(m.ping) : '-'}ms`);
    if (run.gpuError) fail('그래픽 테스트: ' + run.gpuError);
  } catch (e) { fail('벤치마크 실패: ' + e.message); }

  section(`결과: ${failures() ? `문제 ${failures()}건` : '문제 없음'} (${Math.round((Date.now() - t0) / 1000)}초)`);
  say('보고서: ' + outFile);
  flush();
  // 창이 없는 모드라 끝난 것을 알 수 있도록 보고서를 연다 (--no-open 이면 열지 않음)
  if (!process.argv.includes('--no-open')) { try { await shell.openPath(outFile); } catch (_) {} }
  return failures();
}

module.exports = { runSelfTest };
