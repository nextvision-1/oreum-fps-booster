// 최적화 전/후 성능 비교: 시스템 벤치마크 + 게임 FPS 측정(PresentMon)
const { app, BrowserWindow, ipcMain, net } = require('electron');
const { Worker } = require('worker_threads');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runPS } = require('./ps');

const BENCH_FILE = () => path.join(app.getPath('userData'), 'bench.json');
const loadRuns = () => { try { return JSON.parse(fs.readFileSync(BENCH_FILE(), 'utf8')); } catch (_) { return []; } };
const saveRuns = (r) => { fs.mkdirSync(path.dirname(BENCH_FILE()), { recursive: true }); fs.writeFileSync(BENCH_FILE(), JSON.stringify(r.slice(0, 60), null, 2), 'utf8'); };

// 비교 화면에 쓰는 지표 정의 (better: 'up' 높을수록 좋음, 'down' 낮을수록 좋음)
const SYSTEM_METRICS = [
  { key: 'gpuFps', name: '그래픽 테스트 평균 FPS', unit: 'FPS', better: 'up', digits: 0 },
  { key: 'gpuLow1', name: '그래픽 테스트 1% Low FPS', unit: 'FPS', better: 'up', digits: 0 },
  { key: 'ftStd', name: '프레임 시간 흔들림(표준편차)', unit: 'ms', better: 'down', digits: 2 },
  { key: 'cpuSingle', name: 'CPU 싱글코어 점수', unit: '점', better: 'up', digits: 0 },
  { key: 'cpuMulti', name: 'CPU 멀티코어 점수', unit: '점', better: 'up', digits: 0 },
  { key: 'spikes', name: '시스템 끊김 횟수 (0.5ms 이상, 5초)', unit: '회', better: 'down', digits: 0 },
  { key: 'maxGap', name: '최대 끊김 시간', unit: 'ms', better: 'down', digits: 2 },
  { key: 'idleCpu', name: '대기 중 CPU 사용률', unit: '%', better: 'down', digits: 1 },
  { key: 'procs', name: '실행 중 프로세스 수', unit: '개', better: 'down', digits: 0 },
  { key: 'memUsed', name: '대기 중 메모리 사용량', unit: 'GB', better: 'down', digits: 2 },
  { key: 'ping', name: '평균 핑 (8.8.8.8)', unit: 'ms', better: 'down', digits: 0 },
  { key: 'jitter', name: '핑 흔들림', unit: 'ms', better: 'down', digits: 0 },
];
const GAME_METRICS = [
  { key: 'avgFps', name: '평균 FPS', unit: 'FPS', better: 'up', digits: 1 },
  { key: 'low1', name: '1% Low FPS', unit: 'FPS', better: 'up', digits: 1 },
  { key: 'low01', name: '0.1% Low FPS', unit: 'FPS', better: 'up', digits: 1 },
  { key: 'ftAvg', name: '평균 프레임 시간', unit: 'ms', better: 'down', digits: 2 },
  { key: 'ftP99', name: '99% 프레임 시간', unit: 'ms', better: 'down', digits: 2 },
  { key: 'stutters', name: '스터터 (중앙값 2.5배 초과 프레임)', unit: '회', better: 'down', digits: 0 },
];

// ───────── 워커 (CPU 점수 / 끊김 측정) ─────────
const WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
const { performance } = require('perf_hooks');
function cpu(ms) {
  const end = performance.now() + ms;
  let x = 123456789 + workerData.seed, n = 0, acc = 0;
  for (;;) {
    for (let i = 0; i < 20000; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; acc += Math.sqrt((x >>> 0) % 10007) * 1.0001; }
    n++;
    if (performance.now() >= end) break;
  }
  return { iters: n, ms, acc };
}
function jitter(ms) {
  const start = performance.now(), end = start + ms;
  let last = start, spikes = 0, max = 0;
  for (;;) {
    const t = performance.now(), g = t - last;
    if (g > 0.5) spikes++;
    if (g > max) max = g;
    last = t;
    if (t >= end) break;
  }
  return { spikes, max };
}
parentPort.postMessage(workerData.type === 'cpu' ? cpu(workerData.ms) : jitter(workerData.ms));
`;
function runWorker(data) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_CODE, { eval: true, workerData: data });
    w.once('message', (m) => { resolve(m); w.terminate(); });
    w.once('error', reject);
  });
}
async function cpuScore(threads, ms) {
  const res = await Promise.all(Array.from({ length: threads }, (_, i) => runWorker({ type: 'cpu', ms, seed: i })));
  // 1초당 반복 블록 수를 점수로 환산
  return Math.round(res.reduce((s, r) => s + (r.iters / r.ms) * 1000, 0) / 10);
}

// ───────── 그래픽 테스트 (WebGL2) ─────────
function gpuTest(seconds) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      width: 1280, height: 720, useContentSize: true, resizable: false, frame: false,
      alwaysOnTop: true, center: true, backgroundColor: '#000000', show: false,
      webPreferences: { preload: path.join(__dirname, 'bench-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      ipcMain.removeListener('gpu:done', onDone);
      clearTimeout(timer);
      if (!w.isDestroyed()) w.close();
      resolve(r);
    };
    const onDone = (e, r) => { if (e.sender === w.webContents) finish(r); };
    ipcMain.on('gpu:done', onDone);
    const timer = setTimeout(() => finish({ error: '시간 초과' }), (seconds + 20) * 1000);
    w.once('ready-to-show', () => w.show());
    w.on('closed', () => finish({ error: '창이 닫혔습니다' }));
    w.loadFile(path.join(__dirname, 'renderer', 'bench.html'), { query: { s: String(seconds) } });
  });
}

// ───────── 시스템 벤치마크 ─────────
let running = false;
async function runSystemBench({ label, getIdle, progress }) {
  if (running) throw new Error('이미 측정 중입니다.');
  running = true;
  try {
    const m = {};
    progress(5, '대기 상태 측정 중… (3초)');
    await new Promise((r) => setTimeout(r, 3000));
    const idle = getIdle();
    m.idleCpu = idle.cpu;
    m.memUsed = +((os.totalmem() - os.freemem()) / 1073741824).toFixed(2);

    progress(12, '프로세스·네트워크 확인 중…');
    try {
      const r = await runPS(String.raw`
$p = @()
try { $p = @(Test-Connection -ComputerName 8.8.8.8 -Count 8 -ErrorAction Stop | ForEach-Object { [int]$_.ResponseTime }) } catch {}
Emit @{ pings = $p; procs = @(Get-Process).Count }
`);
      m.procs = r.procs;
      const pings = (Array.isArray(r.pings) ? r.pings : [r.pings]).filter((x) => x != null);
      if (pings.length) {
        m.ping = pings.reduce((a, b) => a + b, 0) / pings.length;
        m.jitter = Math.max(...pings) - Math.min(...pings);
      }
    } catch (_) {}

    progress(25, 'CPU 싱글코어 측정 중… (4초)');
    m.cpuSingle = await cpuScore(1, 4000);
    progress(38, 'CPU 멀티코어 측정 중… (4초)');
    m.cpuMulti = await cpuScore(os.cpus().length, 4000);
    progress(50, '시스템 끊김 측정 중… (5초)');
    const j = await runWorker({ type: 'jitter', ms: 5000 });
    m.spikes = j.spikes;
    m.maxGap = +j.max.toFixed(3);

    progress(60, '그래픽 테스트 중… (약 20초, 화면을 건드리지 마세요)');
    const g = await gpuTest(15);
    if (!g.error) { m.gpuFps = g.avgFps; m.gpuLow1 = g.low1; m.ftStd = g.ftStd; }

    progress(100, '완료');
    const run = {
      id: Date.now().toString(36), kind: 'system', time: new Date().toISOString(), label: label || '측정',
      metrics: m, gpuError: g.error || null,
      env: { cpu: os.cpus()[0]?.model?.trim(), threads: os.cpus().length, ramGB: Math.round(os.totalmem() / 1073741824) },
    };
    const runs = loadRuns();
    runs.unshift(run);
    saveRuns(runs);
    return run;
  } finally {
    running = false;
  }
}

// ───────── 게임 FPS (PresentMon) ─────────
const PM_VERSIONS = ['2.6.0', '2.3.1'];
function pmCandidates() {
  return [
    path.join(process.resourcesPath || '', 'tools', 'PresentMon.exe'),
    path.join(app.getAppPath(), 'tools', 'PresentMon.exe'),
    path.join(app.getPath('userData'), 'tools', 'PresentMon.exe'),
  ];
}
const pmFind = () => pmCandidates().find((p) => { try { return fs.statSync(p).size > 100000; } catch (_) { return false; } });

async function pmEnsure(progress) {
  const found = pmFind();
  if (found) return found;
  const dest = path.join(app.getPath('userData'), 'tools', 'PresentMon.exe');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (const v of PM_VERSIONS) {
    try {
      progress && progress(5, `FPS 측정 도구(Intel PresentMon ${v}) 내려받는 중…`);
      const res = await net.fetch(`https://github.com/GameTechDev/PresentMon/releases/download/v${v}/PresentMon-${v}-x64.exe`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100000) throw new Error('파일이 올바르지 않습니다');
      fs.writeFileSync(dest, buf);
      return dest;
    } catch (e) { lastErr = e; }
  }
  throw new Error('PresentMon 다운로드 실패: ' + (lastErr?.message || '') + ' — 인터넷 연결을 확인하거나 PresentMon.exe 를 ' + path.dirname(dest) + ' 에 넣어 주세요.');
}

async function listGameProcs() {
  const r = await runPS(String.raw`
$me = $PID
$skip = 'explorer|ApplicationFrameHost|SystemSettings|TextInputHost|ShellExperienceHost|StartMenuExperienceHost|SearchHost|LockApp|electron|Oreum FPS Booster|powershell|WindowsTerminal|cmd'
$l = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.Id -ne $me -and $_.ProcessName -notmatch $skip } | Sort-Object WorkingSet64 -Descending | ForEach-Object {
  @{ pid = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle; memMB = [int]($_.WorkingSet64 / 1MB) }
})
Emit @{ list = $l }
`);
  return Array.isArray(r.list) ? r.list : r.list ? [r.list] : [];
}

function parseCsv(file, pid) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const head = lines[0].split(',');
  const iFt = head.indexOf('MsBetweenPresents');
  const iPid = head.indexOf('ProcessID');
  const iSc = head.indexOf('SwapChainAddress');
  const iApp = head.indexOf('Application');
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

let gameRunning = null;
async function runGameBench({ pid, name, seconds, delay, label, progress }) {
  if (gameRunning) throw new Error('이미 측정 중입니다.');
  const pm = await pmEnsure(progress);
  const csv = path.join(os.tmpdir(), `ofb_pm_${Date.now()}.csv`);
  const args = ['--process_id', String(pid), '--output_file', csv, '--timed', String(seconds), '--terminate_after_timed',
    '--stop_existing_session', '--no_console_stats', '--v1_metrics', '--session_name', 'OreumFPSBooster'];
  if (delay > 0) args.push('--delay', String(delay));
  await new Promise((resolve, reject) => {
    const p = spawn(pm, args, { windowsHide: true });
    gameRunning = p;
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.stdout.on('data', (d) => { err += d; });
    const t0 = Date.now();
    const tick = setInterval(() => {
      const el = (Date.now() - t0) / 1000;
      if (el < delay) progress(Math.round((el / (delay + seconds)) * 100), `${Math.ceil(delay - el)}초 뒤 측정 시작 — 지금 게임 화면으로 돌아가 평소처럼 플레이하세요`);
      else progress(Math.min(99, Math.round((el / (delay + seconds)) * 100)), `${name} 측정 중… ${Math.max(0, Math.ceil(delay + seconds - el))}초 남음`);
    }, 500);
    const kill = setTimeout(() => { try { p.kill(); } catch (_) {} }, (seconds + delay + 40) * 1000);
    p.on('error', (e) => { clearInterval(tick); clearTimeout(kill); gameRunning = null; reject(e); });
    p.on('exit', () => { clearInterval(tick); clearTimeout(kill); gameRunning = null; fs.existsSync(csv) ? resolve() : reject(new Error('측정 데이터가 없습니다. 관리자 권한으로 실행했는지, 게임이 실행 중인지 확인하세요. ' + err.slice(0, 200))); });
  });
  const parsed = parseCsv(csv, pid);
  try { fs.unlinkSync(csv); } catch (_) {}
  if (!parsed || parsed.ft.length < 30) throw new Error('프레임이 거의 기록되지 않았습니다. 게임이 화면에 표시된 상태(최소화 X)에서 측정하세요.');
  const st = frameStats(parsed.ft);
  const run = {
    id: Date.now().toString(36), kind: 'game', time: new Date().toISOString(), label: label || '측정',
    app: parsed.appName || name + '.exe', seconds, metrics: { avgFps: st.avgFps, low1: st.low1, low01: st.low01, ftAvg: st.ftAvg, ftP99: st.ftP99, stutters: st.stutters },
    frames: st.frames, series: st.series,
  };
  const runs = loadRuns();
  runs.unshift(run);
  saveRuns(runs);
  return run;
}

module.exports = { __parseCsv: parseCsv, __frameStats: frameStats,
  SYSTEM_METRICS, GAME_METRICS, loadRuns, saveRuns,
  runSystemBench, runGameBench, listGameProcs, pmFind,
  isRunning: () => running || !!gameRunning,
};
