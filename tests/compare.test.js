// 전/후 비교 계산. 게임 PC(i5-10400 / GTX 1660 SUPER) 서든어택 실측값으로 검사한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/renderer/compare-lib');

const run = (label, m, app = 'suddenattack.exe') => ({ kind: 'game', label, app, metrics: m });
const BEFORE = [
  run('최적화 전', { avgFps: 196.1, low1: 52.5, stutters: 59 }),
  run('최적화 전', { avgFps: 192.7, low1: 19.7, stutters: 62 }),
  run('최적화 전', { avgFps: 199.8, low1: 117.2, stutters: 6 }),
];
const AFTER1 = [run('최적화 후', { avgFps: 198.1, low1: 81.8, stutters: 25 })];
const UP = { better: 'up' }, DOWN = { better: 'down' };

test('묶음: 같은 이름·같은 게임끼리, 게임 이름 대소문자 무시', () => {
  const g = C.groupRuns([...BEFORE, ...AFTER1, run('최적화 전', { avgFps: 100 }, 'SuddenAttack.EXE'), run('최적화 전', { avgFps: 300 }, 'valorant.exe')]);
  assert.deepEqual(g.map((x) => x.runs.length), [4, 1, 1]);
  const s = C.metricOf(g[0], 'low1');
  assert.equal(s.n, 3);
  assert.equal(s.min, 19.7);
  assert.equal(s.max, 117.2);
});

test('상한 감지: 서든어택 200 FPS 상한', () => {
  const a = C.metricOf({ runs: BEFORE }, 'avgFps').mean; // 196.2
  const b = C.metricOf({ runs: AFTER1 }, 'avgFps').mean; // 198.1
  assert.equal(C.detectCap(a, b), 200);
  assert.equal(C.detectCap(143.2, 143.9), 144);
  assert.equal(C.detectCap(180, 230), null, '상한이 아닌 곳은 감지 안 함');
  assert.equal(C.detectCap(250, 260), null);
  assert.equal(C.detectCap(), null);
});

test('판정: 범위가 겹치면 불확실, 1% 미만은 비슷, 낮을수록 좋은 지표는 방향 반대', () => {
  const A = C.summarize([52.5, 19.7, 117.2]);
  assert.equal(C.verdict(UP, A, C.summarize([70, 85, 95])).kind, 'uncertain');
  assert.equal(C.verdict(UP, A, C.summarize([130, 140, 150])).kind, 'good', '범위가 안 겹치면 개선');
  assert.equal(C.verdict(UP, C.summarize([200, 199]), C.summarize([199.5, 199.6])).kind, 'same');
  assert.equal(C.verdict(DOWN, C.summarize([59, 62, 50]), C.summarize([10, 12, 8])).kind, 'good', '스터터는 줄면 개선');
  // 한쪽이 1회뿐이면 겹침 판정을 할 수 없어 개선/저하로 표시하고, 화면은 "측정 횟수 적음" 안내를 띄운다
  assert.equal(C.verdict(UP, A, C.summarize([81.8])).kind, 'good');
  assert.equal(C.verdict(UP, null, A).kind, 'na');
});

test('summarize: 빈 값·숫자 아닌 값 무시', () => {
  assert.equal(C.summarize([]), null);
  assert.deepEqual(C.summarize([1, null, undefined, '', 'x', 3]), { n: 2, mean: 2, min: 1, max: 3 });
});

test('묶음: 같은 게임이라도 장면(맵)이 다르면 따로, 장면 없는 예전 기록도 따로', () => {
  const g = C.groupRuns([
    { ...run('최적화 전', { avgFps: 199 }), scene: '제3보급창고' },
    { ...run('최적화 전', { avgFps: 198 }), scene: ' 제3보급창고 ' },
    { ...run('최적화 전', { avgFps: 137 }), scene: '프로방스' },
    run('최적화 전', { avgFps: 190 }),
  ]);
  assert.deepEqual(g.map((x) => [x.scene.trim(), x.runs.length]), [['제3보급창고', 2], ['프로방스', 1], ['', 1]]);
});
