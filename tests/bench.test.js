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
