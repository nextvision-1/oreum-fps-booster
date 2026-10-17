const test = require('node:test');
const assert = require('node:assert/strict');
const { normVal, opMatches, tweakStatus, driftIds, mergeOriginals, restoreOrder, createQueue, arr } = require('../src/logic');

test('arr: null/단일값/배열 정규화', () => {
  assert.deepEqual(arr(null), []);
  assert.deepEqual(arr(undefined), []);
  assert.deepEqual(arr(3), [3]);
  assert.deepEqual(arr([1, 2]), [1, 2]);
});

test('normVal: DWord 는 부호 있는 32비트로 비교', () => {
  assert.equal(normVal('DWord', 0xffffffff), '-1');
  assert.equal(normVal('DWord', 0x80000001), '-2147483647');
  assert.equal(normVal('DWord', -1), '-1');
  assert.equal(normVal('DWord', 38), '38');
  assert.equal(normVal('QWord', 0xffffffff), '4294967295');
  assert.equal(normVal('MultiString', ['a', 'b']), 'a\nb');
  assert.equal(normVal('String', 0), '0');
});

test('opMatches: reg', () => {
  const op = { t: 'reg', kind: 'DWord', value: 0xffffffff };
  assert.equal(opMatches(op, { exists: true, kind: 'DWord', value: -1 }), true);
  assert.equal(opMatches(op, { exists: true, kind: 'DWord', value: 10 }), false);
  assert.equal(opMatches(op, { exists: false }), false);
  assert.equal(opMatches(op, null), false);
  assert.equal(opMatches({ t: 'reg', kind: 'String', value: '0' }, { exists: true, kind: 'String', value: '0' }), true);
});

test('opMatches: svc — 서비스가 없으면 목적 달성으로 본다', () => {
  assert.equal(opMatches({ t: 'svc', start: 4 }, { exists: false }), true);
  assert.equal(opMatches({ t: 'svc', start: 4 }, { exists: true, start: 4 }), true);
  assert.equal(opMatches({ t: 'svc', start: 4 }, { exists: true, start: 2 }), false);
});

test('opMatches: power / pcfg / key', () => {
  assert.equal(opMatches({ t: 'power' }, { line: '전원 구성표 GUID: 1234 (Oreum FPS Ultimate)' }), true);
  assert.equal(opMatches({ t: 'power' }, { line: 'GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c (고성능)' }), true);
  assert.equal(opMatches({ t: 'power' }, { line: 'GUID: 381b4222-f694-41f0-9685-ff5bb260df2e (균형 조정)' }), false);
  assert.equal(opMatches({ t: 'pcfg', value: 100 }, { exists: true, ac: 100, dc: 5 }), true);
  assert.equal(opMatches({ t: 'pcfg', value: 100 }, { exists: false }), false);
  assert.equal(opMatches({ t: 'key' }, { exists: true, leaf: true }), true);
  assert.equal(opMatches({ t: 'key' }, { exists: true, leaf: false }), false);
  assert.equal(opMatches({ t: 'unknown' }, {}), false);
});

test('tweakStatus: on / off / partial / na, 읽기 실패는 미적용으로', () => {
  const ops = [{ t: 'svc', start: 4 }, { t: 'svc', start: 4 }];
  assert.equal(tweakStatus([], []), 'na');
  assert.equal(tweakStatus(ops, [{ ok: true, cur: { exists: true, start: 4 } }, { ok: true, cur: { exists: false } }]), 'on');
  assert.equal(tweakStatus(ops, [{ ok: true, cur: { exists: true, start: 4 } }, { ok: false }]), 'partial');
  assert.equal(tweakStatus(ops, [{ ok: false }, undefined]), 'off');
});

test('driftIds: 백업이 있고 stuck 이 아닌, 풀린 항목만', () => {
  const tweaks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const backups = { a: {}, b: {}, c: { stuck: true }, e: {} };
  const status = { a: { status: 'off' }, b: { status: 'on' }, c: { status: 'off' }, d: { status: 'off' }, e: { status: 'partial' } };
  assert.deepEqual(driftIds(tweaks, backups, status), ['a', 'e']);
});

test('mergeOriginals: 다른 전원 계획에 다시 적용하면 그 계획의 원래 값도 백업, 같은 계획·일반 값은 처음 값 유지', () => {
  const op = { t: 'pcfg', sub: 's', set: 'x', value: 100 };
  const reg = { t: 'reg', path: 'p', name: 'n', kind: 'DWord', value: 1 };
  const existing = [{ op, before: { exists: true, scheme: 'BAL', ac: 5 } }, { op: reg, before: { exists: true, value: 0 } }];
  // 같은 계획에 재적용 → 변화 없음 (재적용 시점의 값은 이미 바뀐 값이므로 무시)
  assert.deepEqual(mergeOriginals(existing, [{ op, before: { exists: true, scheme: 'BAL', ac: 100 } }, { op: reg, before: { exists: true, value: 1 } }]), existing);
  // 다른 계획 → 추가
  const m = mergeOriginals(existing, [{ op, before: { exists: true, scheme: 'ULT', ac: 30 } }]);
  assert.equal(m.length, 3);
  assert.equal(m[2].before.scheme, 'ULT');
  // 원래 값을 못 읽은 경우는 추가하지 않음
  assert.equal(mergeOriginals(existing, [{ op, before: null }]).length, 2);
});

test('restoreOrder: 전원 계획 전환은 마지막, 나머지 순서 유지', () => {
  const items = [{ op: { t: 'power' }, k: 1 }, { op: { t: 'pcfg' }, k: 2 }, { op: { t: 'reg' }, k: 3 }];
  assert.deepEqual(restoreOrder(items).map((i) => i.k), [2, 3, 1]);
});

test('createQueue: 작업을 순서대로 하나씩 실행하고, 실패해도 다음 작업은 진행', async () => {
  const q = createQueue();
  const log = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const p1 = q(async () => { log.push('1s'); await wait(30); log.push('1e'); return 1; });
  const p2 = q(async () => { log.push('2s'); throw new Error('x'); });
  const p3 = q(async () => { log.push('3s'); return 3; });
  assert.equal(await p1, 1);
  await assert.rejects(p2, /x/);
  assert.equal(await p3, 3);
  assert.deepEqual(log, ['1s', '1e', '2s', '3s']);
});
