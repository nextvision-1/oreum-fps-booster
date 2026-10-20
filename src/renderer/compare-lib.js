// 전/후 비교 계산 (화면과 Node 테스트에서 함께 쓰는 순수 함수)
// - 같은 측정 이름(게임은 같은 게임까지)의 기록을 묶어 평균·최저·최고를 낸다
// - 양쪽 다 2회 이상이고 범위가 겹치면 "차이 불확실"로 본다 (한두 번 측정의 흔들림을 개선·저하로 오판하지 않도록)
// - 평균 FPS 가 흔한 상한값 바로 아래에 몰려 있으면 상한에 걸린 것으로 본다 (평균으로는 비교 불가)
(function (root) {
  const CAPS = [30, 60, 75, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 300, 360, 480, 500];

  function summarize(values) {
    const v = values.filter((x) => x != null && x !== '' && !Number.isNaN(Number(x))).map(Number);
    if (!v.length) return null;
    return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v) };
  }

  // 묶음 키: 게임은 "측정 이름 + 게임 + 장면(맵)", 시스템은 "측정 이름 + 측정 방식 버전"(이전 방식과 섞이지 않게)
  function groupKey(r) {
    return r.kind === 'game' ? `game|${r.label}|${String(r.app || '').toLowerCase()}|${String(r.scene || '').trim().toLowerCase()}` : `system|${r.label}|${r.env?.benchVer || 1}`;
  }

  function groupRuns(runs) {
    const map = new Map();
    for (const r of runs) {
      const k = groupKey(r);
      if (!map.has(k)) map.set(k, { id: k, label: r.label, app: r.app, scene: r.scene || '', kind: r.kind, runs: [] });
      map.get(k).runs.push(r);
    }
    return [...map.values()];
  }

  const metricOf = (unit, key) => summarize(unit.runs.map((r) => r.metrics?.[key]));

  // 두 쪽 평균 FPS 가 같은 상한값의 97~100.5% 안에 있으면 그 상한값을 돌려준다
  function detectCap(...avgs) {
    for (const c of CAPS) if (avgs.length && avgs.every((a) => a != null && a >= c * 0.97 && a <= c * 1.005)) return c;
    return null;
  }

  // 변화 판정. kind: same(1% 미만) | uncertain(범위 겹침) | good | bad | na
  function verdict(def, A, B) {
    if (!A || !B || !Number(A.mean)) return { kind: 'na' };
    const raw = ((B.mean - A.mean) / Math.abs(A.mean)) * 100;
    const good = def.better === 'up' ? raw : -raw;
    if (Math.abs(good) < 1) return { kind: 'same', raw };
    if (A.n >= 2 && B.n >= 2 && A.min <= B.max && B.min <= A.max) return { kind: 'uncertain', raw, good };
    return { kind: good > 0 ? 'good' : 'bad', raw, good };
  }

  const api = { CAPS, summarize, groupKey, groupRuns, metricOf, detectCap, verdict };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompareLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
