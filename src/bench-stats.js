// PresentMon CSV 해석과 프레임 통계 (Electron 없이 테스트 가능한 순수 함수)
function parseCsv(text, pid) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  // 열 이름은 대소문자를 구분하지 않고 찾는다. PresentMon 2.x 는 --v1_metrics 에서도
  // 1.x 의 "MsBetweenPresents" 가 아니라 "msBetweenPresents" 를 써서, 정확히 일치로 찾으면 항상 0프레임이 됐다.
  const head = lines[0].replace(/^﻿/, '').split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const col = (...names) => { for (const n of names) { const i = head.indexOf(n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const iFt = col('MsBetweenPresents', 'FrameTime', 'MsBetweenAppStart'); // 1.x 이름, 2.x(--v2_metrics) 이름 순
  const iPid = col('ProcessID');
  const iSc = col('SwapChainAddress');
  const iApp = col('Application');
  if (iFt < 0) return null;
  // 스왑체인별로 모은 뒤 프레임이 가장 많은 것을 사용
  const chains = new Map();
  let appName = '';
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(',');
    if (iPid >= 0 && pid && Number(c[iPid]) !== Number(pid)) continue;
    const ft = parseFloat(c[iFt]);
    if (!(ft > 0) || ft > 5000) continue;
    const key = iSc >= 0 ? c[iSc] : 'x';
    if (!chains.has(key)) chains.set(key, []);
    chains.get(key).push(ft);
    if (!appName && iApp >= 0) appName = c[iApp];
  }
  let ft = [];
  for (const v of chains.values()) if (v.length > ft.length) ft = v;
  return ft.length ? { ft, appName } : null;
}

function frameStats(ft) {
  const n = ft.length;
  const total = ft.reduce((a, b) => a + b, 0);
  const sorted = [...ft].sort((a, b) => b - a); // 느린 순
  const worst = (p) => { const k = Math.max(1, Math.round(n * p)); return sorted.slice(0, k).reduce((a, b) => a + b, 0) / k; };
  const asc = [...ft].sort((a, b) => a - b);
  const median = asc[Math.floor(n / 2)];
  // 그래프용 다운샘플 (구간별 최대값을 남겨 끊김이 보이게)
  const B = 240, series = [];
  for (let b = 0; b < Math.min(B, n); b++) {
    const s = Math.floor((b * n) / Math.min(B, n)), e = Math.floor(((b + 1) * n) / Math.min(B, n));
    let mx = 0; for (let i = s; i < e; i++) if (ft[i] > mx) mx = ft[i];
    series.push(+mx.toFixed(2));
  }
  return {
    frames: n,
    avgFps: +((n / total) * 1000).toFixed(1),
    low1: +(1000 / worst(0.01)).toFixed(1),
    low01: +(1000 / worst(0.001)).toFixed(1),
    ftAvg: +(total / n).toFixed(2),
    ftP99: +asc[Math.min(n - 1, Math.floor(n * 0.99))].toFixed(2),
    stutters: ft.filter((x) => x > median * 2.5).length,
    series,
  };
}

module.exports = { parseCsv, frameStats };
