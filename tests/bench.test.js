const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, frameStats } = require('../src/bench-stats');

const HEAD = 'Application,ProcessID,SwapChainAddress,Runtime,MsBetweenPresents';
const row = (app, pid, sc, ft) => `${app},${pid},${sc},DXGI,${ft}`;

test('parseCsv: 선택한 프로세스만, 프레임이 가장 많은 스왑체인 사용, 이상값 제외', () => {
  const lines = [HEAD];
  for (let i = 0; i < 50; i++) lines.push(row('game.exe', 100, '0xA', 16.6));
  for (let i = 0; i < 5; i++) lines.push(row('game.exe', 100, '0xB', 33.3)); // 런처 등 보조 스왑체인
  for (let i = 0; i < 80; i++) lines.push(row('other.exe', 200, '0xC', 8)); // 다른 프로세스
  lines.push(row('game.exe', 100, '0xA', 0), row('game.exe', 100, '0xA', 9000), row('game.exe', 100, '0xA', 'NA'));
  const r = parseCsv(lines.join('\r\n') + '\r\n', 100);
  assert.equal(r.appName, 'game.exe');
  assert.equal(r.ft.length, 50);
  assert.ok(r.ft.every((x) => x === 16.6));
});

test('parseCsv: PresentMon 2.x 열 이름(소문자 msBetweenPresents, FrameTime)도 해석 (실제 게임 PC 에서 0프레임이던 원인)', () => {
  const v1 = 'Application,ProcessID,SwapChainAddress,PresentRuntime,msBetweenPresents\n' + Array(40).fill('game.exe,1,0xA,DXGI,8.3').join('\n');
  assert.equal(parseCsv(v1, 1).ft.length, 40);
  const v2 = '﻿"Application","ProcessId","SwapChainAddress","FrameTime"\n' + Array(35).fill('game.exe,1,0xA,4.2').join('\n');
  const r = parseCsv(v2);
  assert.equal(r.ft.length, 35);
  assert.equal(r.ft[0], 4.2);
});

test('parseCsv: 헤더만 있거나 필요한 열이 없으면 null', () => {
  assert.equal(parseCsv(HEAD + '\n', 1), null);
  assert.equal(parseCsv('Application,ProcessID\nx,1\n', 1), null);
  assert.equal(parseCsv('', 1), null);
});

test('frameStats: 평균·1% Low·0.1% Low·99% 프레임 시간·스터터', () => {
  // 990 프레임 10ms + 10 프레임 50ms → 1% 최악 = 50ms
  const ft = [...Array(990).fill(10), ...Array(10).fill(50)];
  const s = frameStats(ft);
  assert.equal(s.frames, 1000);
  assert.equal(s.avgFps, +(1000 / ((990 * 10 + 500) / 1000)).toFixed(1));
  assert.equal(s.low1, 20);
  assert.equal(s.low01, 20);
  assert.equal(s.ftAvg, 10.4);
  assert.equal(s.ftP99, 50);
  assert.equal(s.stutters, 10);
  assert.ok(s.series.length <= 240);
  assert.equal(Math.max(...s.series), 50, '다운샘플 그래프에도 끊김이 보여야 함');
});

test('frameStats: 프레임 수가 적어도 오류 없이 계산', () => {
  const s = frameStats([16, 17, 18]);
  assert.equal(s.frames, 3);
  assert.equal(s.series.length, 3);
  assert.equal(s.low1, +(1000 / 18).toFixed(1));
});

test('그래픽 테스트: 60 FPS 제한 회귀 방지 (desynchronized 캔버스 금지, 프레임 제한 해제는 테스트 프로세스에만)', () => {
  const fs = require('fs');
  const path = require('path');
  const gpu = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'gpu-bench.js'), 'utf8');
  assert.ok(!/desynchronized:\s*true/.test(gpu), 'desynchronized: true 는 60 FPS 로 묶는다');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const unlock = main.indexOf("appendSwitch('disable-frame-rate-limit')");
  assert.ok(unlock > main.indexOf('if (GPU_CHILD) {'), '프레임 제한 해제는 GPU_CHILD 블록 안에서만');
  assert.ok(main.includes("appendSwitch('force_high_performance_gpu')"), '노트북에서 게임용 GPU 로 측정');
});
