// Electron 없이 테스트할 수 있는 순수 로직
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const fmtMB = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB');

function normVal(kind, v) {
  if (kind === 'DWord' || kind === 'QWord') {
    let n = Number(v);
    if (kind === 'DWord' && n > 2147483647) n -= 4294967296;
    return String(n);
  }
  if (Array.isArray(v)) return v.join('\n');
  return String(v);
}

// 레지스트리 NameServer 값("1.1.1.1,1.0.0.1" 또는 공백 구분) → 배열
const dnsList = (v) => String(v || '').split(/[,\s]+/).filter(Boolean);

const POWER_RX = /Oreum FPS Ultimate|8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c|e9a42b02-d5df-448d-aa00-03f14749eb61/i;

function opMatches(op, cur) {
  if (!cur) return false;
  switch (op.t) {
    case 'reg': return !!cur.exists && normVal(op.kind, op.value) === normVal(cur.kind, cur.value);
    case 'svc': return !cur.exists || Number(cur.start) === op.start; // 서비스가 없으면 목적 달성
    case 'power': return POWER_RX.test(cur.line || '');
    case 'pcfg': return !!cur.exists && Number(cur.ac) === op.value;
    case 'key': return !!cur.leaf;
    case 'dns': return dnsList(cur.value).join(',') === [].concat(op.servers).join(',');
    case 'json': return !!cur.exists && JSON.stringify(cur.value) === JSON.stringify(op.value);
    default: return false;
  }
}

// ops 읽기 결과로 항목 상태 계산: on | off | partial | na
function tweakStatus(ops, results) {
  if (!ops.length) return 'na';
  let hit = 0;
  ops.forEach((op, i) => { if (results[i]?.ok && opMatches(op, results[i].cur)) hit++; });
  return hit === ops.length ? 'on' : hit === 0 ? 'off' : 'partial';
}

// 설정 유지 감시 대상: 이 프로그램으로 적용했고(백업 있음), 재적용해도 안 되는 항목(stuck)이 아니며, 지금 풀려 있는 것
function driftIds(tweaks, backups, status) {
  return tweaks
    .filter((t) => backups[t.id] && !backups[t.id].stuck)
    .filter((t) => status[t.id]?.status === 'off' || status[t.id]?.status === 'partial')
    .map((t) => t.id);
}

// 이미 백업이 있는 항목을 다시 적용할 때: 처음 값은 그대로 두되, 전원 세부 설정을 "다른 전원 계획"에 적용했다면
// 그 계획의 원래 값도 백업에 추가한다 (계획을 바꾼 뒤 재적용하면 그 계획이 백업 없이 바뀌는 문제 방지)
function mergeOriginals(existing, fresh) {
  const out = [...existing];
  for (const f of fresh) {
    if (f.op.t !== 'pcfg' || !f.before?.scheme) continue;
    const known = out.some((e) => e.op.t === 'pcfg' && e.op.sub === f.op.sub && e.op.set === f.op.set && e.before?.scheme === f.before.scheme);
    if (!known) out.push(f);
  }
  return out;
}

// 복원 순서: 전원 계획 전환(power)은 맨 마지막에. 계획 정보(scheme)가 없는 예전 백업의 세부 설정이
// 계획을 되돌리기 전에 복원되도록 한다. 나머지는 순서 유지.
function restoreOrder(items) {
  return [...items.filter((i) => i.op.t !== 'power'), ...items.filter((i) => i.op.t === 'power')];
}

// 같은 시점에 하나의 작업만 실행 (적용·복원·감시가 겹쳐 백업이 꼬이는 것을 방지)
function createQueue() {
  let chain = Promise.resolve();
  return (fn) => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };
}

module.exports = { dnsList, arr, fmtMB, normVal, opMatches, tweakStatus, driftIds, mergeOriginals, restoreOrder, createQueue, POWER_RX };
