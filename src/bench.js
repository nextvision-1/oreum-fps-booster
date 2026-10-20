// 최적화 전/후 성능 비교: 시스템 벤치마크 + 게임 FPS 측정(PresentMon)
const { app, BrowserWindow, ipcMain, net } = require('electron');
const { Worker } = require('worker_threads');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runPS } = require('./ps');
const { parseCsv, frameStats } = require('./bench-stats');

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

// 측정 방식이 바뀌면 올린다. 다른 버전끼리의 그래픽 수치는 비교하지 않는다.
// 2: 60 FPS 제한 해제(desynchronized 끔) + 별도 프로세스에서 게임용 GPU 로 측정
const GPU_BENCH_VER = 2;

// 메인 프로세스 쪽: 앱 exe 를 --gpu-bench 로 한 번 더 띄워 결과 파일을 받아 온다
function gpuTestIsolated(seconds, onSpawn) {
  return new Promise((resolve) => {
    const out = path.join(os.tmpdir(), `ofb_gpu_${Date.now()}.json`);
    const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--gpu-bench', `--seconds=${seconds}`, `--out=${out}`];
    let p;
    try { p = spawn(process.execPath, args, { stdio: 'ignore' }); } catch (e) { return resolve({ error: '그래픽 테스트를 시작하지 못했습니다: ' + e.message }); }
    if (onSpawn) onSpawn(p.pid);
    const kill = setTimeout(() => { try { p.kill(); } catch (_) {} }, (seconds + 60) * 1000);
    const done = () => {
      clearTimeout(kill);
      try { resolve(JSON.parse(fs.readFileSync(out, 'utf8'))); }
      catch (_) { resolve({ error: '그래픽 테스트 결과가 없습니다 (중간에 종료됨)' }); }
      try { fs.unlinkSync(out); } catch (_) {}
    };
    p.once('error', (e) => { clearTimeout(kill); resolve({ error: '그래픽 테스트를 시작하지 못했습니다: ' + e.message }); });
    p.once('exit', done);
  });
}

// 하위 프로세스 쪽 (main.js 가 --gpu-bench 일 때 호출): 측정하고 결과 파일을 쓴 뒤 종료
async function runGpuChild() {
  const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
  const seconds = Math.min(120, Math.max(3, Number(arg('seconds')) || 15));
  let r;
  try {
    r = await gpuTest(seconds);
    const info = await app.getGPUInfo('complete').catch(() => null);
    const gl = String(info?.auxAttributes?.glRenderer || '');
    // 예: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Laptop GPU (0x00002D59) Direct3D11 ..." → GPU 이름만
    r.gpu = (gl.match(/^ANGLE \([^,]+, (.+?) \(0x/) || [])[1] || gl.slice(0, 80);
  } catch (e) { r = { error: e.message }; }
  try { fs.writeFileSync(arg('out'), JSON.stringify(r)); } catch (_) {}
  app.exit(0);
}

// ───────── 시스템 벤치마크 ─────────
let running = false;
async function runSystemBench({ label, getIdle, progress }) {
  if (running || gameRunning) throw new Error('이미 측정 중입니다.');
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
    const g = await gpuTestIsolated(15);
    if (!g.error) { m.gpuFps = g.avgFps; m.gpuLow1 = g.low1; m.ftStd = g.ftStd; }

    progress(100, '완료');
    const run = {
      id: Date.now().toString(36), kind: 'system', time: new Date().toISOString(), label: label || '측정',
      metrics: m, gpuError: g.error || null,
      env: { cpu: os.cpus()[0]?.model?.trim(), threads: os.cpus().length, ramGB: Math.round(os.totalmem() / 1073741824), gpu: g.gpu || null, benchVer: GPU_BENCH_VER },
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

// 이 앱은 관리자 권한으로 실행되므로, 내려받았거나 사용자 폴더에 있는 exe 를 그대로 실행하면
// 바꿔치기된 파일이 관리자 권한을 얻을 수 있다. 실행·저장 전에 유효한 Intel 서명인지 확인한다.
async function pmVerify(file) {
  const r = await runPS(String.raw`
$s = Get-AuthenticodeSignature -LiteralPath $A.f
Emit @{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject }`, { f: file });
  if (r.status !== 'Valid' || !/^CN=Intel Corporation,/.test(r.subject || '')) {
    throw new Error(`PresentMon.exe 의 디지털 서명을 확인할 수 없습니다 (${r.status || '서명 없음'}). 안전을 위해 실행하지 않습니다: ${file}`);
  }
  return file;
}

async function pmEnsure(progress) {
  const found = pmFind();
  if (found) return pmVerify(found);
  const dest = path.join(app.getPath('userData'), 'tools', 'PresentMon.exe');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (const v of PM_VERSIONS) {
    const tmp = dest + '.download';
    try {
      progress && progress(5, `FPS 측정 도구(Intel PresentMon ${v}) 내려받는 중…`);
      const res = await net.fetch(`https://github.com/GameTechDev/PresentMon/releases/download/v${v}/PresentMon-${v}-x64.exe`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100000) throw new Error('파일이 올바르지 않습니다');
      fs.writeFileSync(tmp, buf);
      await pmVerify(tmp);
      fs.renameSync(tmp, dest);
      return dest;
    } catch (e) {
      lastErr = e;
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
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

let gameRunning = false;
async function runGameBench(opts) {
  // 다운로드 대기 중에도 중복 실행을 막도록 시작하자마자 표시
  if (gameRunning || running) throw new Error('이미 측정 중입니다.');
  gameRunning = true;
  try { return await measureGame(opts); } finally { gameRunning = false; }
}

// PresentMon 으로 한 번 측정해 프레임 시간을 돌려준다 (게임 측정·자가진단 공용)
// target: { name: 'game.exe' } (같은 이름의 모든 프로세스) 또는 { pid }
// 실패하면 원인을 알 수 있도록 종료 코드·PresentMon 출력·잡힌 프레임 수를 담아 오류를 던진다.
async function pmCapture({ target, seconds, delay = 0, onTick }) {
  const pm = await pmEnsure();
  const base = `ofb_pm_${Date.now()}`;
  const csv = path.join(os.tmpdir(), base + '.csv');
  // 실행 파일 이름으로 지정하면 런처·재시작 등으로 PID 가 바뀌거나 렌더링 프로세스가 따로 있어도 잡힌다
  const tgt = target.name ? ['--process_name', target.name] : ['--process_id', String(target.pid)];
  const args = [...tgt, '--output_file', csv, '--timed', String(seconds), '--terminate_after_timed',
    '--stop_existing_session', '--no_console_stats', '--v1_metrics', '--session_name', 'OreumFPSBooster'];
  if (delay > 0) args.push('--delay', String(delay));
  const { code, out } = await new Promise((resolve, reject) => {
    const p = spawn(pm, args, { windowsHide: true });
    let o = '';
    p.stderr.on('data', (d) => { o += d; });
    p.stdout.on('data', (d) => { o += d; });
    const t0 = Date.now();
    const tick = onTick && setInterval(() => onTick((Date.now() - t0) / 1000), 500);
    const kill = setTimeout(() => { try { p.kill(); } catch (_) {} }, (seconds + delay + 40) * 1000);
    p.on('error', (e) => { clearInterval(tick); clearTimeout(kill); reject(new Error('PresentMon 을 실행하지 못했습니다: ' + e.message)); });
    p.on('exit', (c) => { clearInterval(tick); clearTimeout(kill); resolve({ code: c, out: o }); });
  });
  // PresentMon 은 경우에 따라 파일 이름 뒤에 번호를 붙여 저장하므로 같은 이름으로 시작하는 CSV 를 모두 찾는다
  const files = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(base) && f.toLowerCase().endsWith('.csv')).map((f) => path.join(os.tmpdir(), f));
  const msg = String(out).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!files.length) {
    const hint = /access denied|elevat|administrat/i.test(out) ? '관리자 권한으로 실행해야 합니다.'
      : /not find|no process|could not|unknown/i.test(out) ? '게임이 실행 중인지, 목록에서 올바른 게임을 골랐는지 확인하세요.'
      : '게임이 실행 중이고 화면에 표시된 상태(최소화 X)인지 확인하세요.';
    throw new Error(`측정 데이터가 만들어지지 않았습니다. ${hint} (PresentMon 종료 코드 ${code}${msg ? ': ' + msg : ''})`);
  }
  let parsed = null;
  try {
    // 여러 파일이면 프레임이 가장 많은 것을 쓴다
    for (const f of files) { const p = parseCsv(fs.readFileSync(f, 'utf8')); if (p && (!parsed || p.ft.length > parsed.ft.length)) parsed = p; }
  } finally { files.forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} }); }
  const n = parsed ? parsed.ft.length : 0;
  if (n < 30) throw new Error(`프레임이 ${n}개만 기록됐습니다. 측정하는 동안 게임 화면이 표시돼 있어야 합니다 (다른 창·최소화 X). 게임이 아닌 런처를 골랐는지도 확인하세요. (PresentMon 종료 코드 ${code})`);
  return parsed;
}

// 결과를 게시할 때 측정 조건으로 쓰는 PC 사양 (외장 그래픽 우선)
let envCache = null;
async function pcEnv() {
  if (envCache) return envCache;
  let gpu = null;
  try {
    const r = await runPS(String.raw`Emit @{ list = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Remote|Virtual|Parsec|Basic|Meta' } | ForEach-Object { $_.Name }) }`);
    const l = [].concat(r.list || []);
    gpu = l.find((x) => /NVIDIA|Radeon RX|Arc/i.test(x)) || l[0] || null;
  } catch (_) {}
  envCache = { cpu: os.cpus()[0]?.model?.trim(), threads: os.cpus().length, ramGB: Math.round(os.totalmem() / 1073741824), gpu };
  return envCache;
}

async function measureGame({ pid, name, seconds, delay, label, scene, progress }) {
  progress(3, 'FPS 측정 도구 확인 중…');
  const parsed = await pmCapture({
    target: name ? { name: name.toLowerCase().endsWith('.exe') ? name : name + '.exe' } : { pid },
    seconds, delay,
    onTick: (el) => {
      if (el < delay) progress(Math.round((el / (delay + seconds)) * 100), `${Math.ceil(delay - el)}초 뒤 측정 시작 — 지금 게임 화면으로 돌아가 평소처럼 플레이하세요`);
      else progress(Math.min(99, Math.round((el / (delay + seconds)) * 100)), `${name} 측정 중… ${Math.max(0, Math.ceil(delay + seconds - el))}초 남음`);
    },
  });
  const st = frameStats(parsed.ft);
  const run = {
    id: Date.now().toString(36), kind: 'game', time: new Date().toISOString(), label: label || '측정',
    env: await pcEnv(), app: parsed.appName || name + '.exe', scene: scene || '', seconds, metrics: { avgFps: st.avgFps, low1: st.low1, low01: st.low01, ftAvg: st.ftAvg, ftP99: st.ftP99, stutters: st.stutters },
    frames: st.frames, series: st.series,
  };
  const runs = loadRuns();
  runs.unshift(run);
  saveRuns(runs);
  return run;
}

module.exports = {
  SYSTEM_METRICS, GAME_METRICS, loadRuns, saveRuns,
  runSystemBench, runGameBench, listGameProcs, pmFind, pmVerify, pmCapture,
  runGpuChild, gpuTestIsolated, GPU_BENCH_VER,
  isRunning: () => running || gameRunning,
};
