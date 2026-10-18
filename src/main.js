const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runPS, OP_READ, OP_APPLY, OP_RESTORE } = require('./ps');
const { arr, fmtMB, tweakStatus, driftIds, mergeOriginals, restoreOrder, createQueue } = require('./logic');
const { CATEGORIES, TWEAKS, ACTIONS, reg } = require('./tweaks');
const { CLEAN_GROUPS, CLEAN_ITEMS, CLEAN_LIB, CLEAN_SCAN, CLEAN_RUN, DRIVES } = require('./cleaner');
const { CHECK_SCRIPT } = require('./checks');
const { BLOAT, BLOAT_LIST, BLOAT_REMOVE } = require('./bloat');
const { STARTUP_SRCS, STARTUP_LIST_SCRIPT, STARTUP_SET_SCRIPT } = require('./startup');
const monitor = require('./monitor');
const bench = require('./bench');

// 그래픽 테스트가 모니터 주사율(수직 동기화)에 묶이지 않도록 프레임 제한 해제
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

// 스모크 테스트 모드: 실제 데이터 폴더·설정 감시를 건드리지 않고 화면이 오류 없이 뜨는지만 확인
const SMOKE = process.env.OFB_SMOKE === '1';
if (SMOKE) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ofb-smoke-')));

let win;
// 적용·복원·감시는 한 번에 하나씩. 진행 중에는 창을 닫지 못하게 해 백업 저장 전에 종료되는 것을 막는다
const queue = createQueue();
let pendingOps = 0;
let relaunching = false;
const exclusive = (fn) => { pendingOps++; return queue(fn).finally(() => { pendingOps--; }); };
const DIR = () => app.getPath('userData');
const STATE_FILE = () => path.join(DIR(), 'backup.json');
const SNAP_DIR = () => path.join(DIR(), 'backups');
const HISTORY_FILE = () => path.join(DIR(), 'history.json');
const SETTINGS_FILE = () => path.join(DIR(), 'settings.json');

// ───────── 저장소 ─────────
function readJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return def; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
const loadState = () => readJSON(STATE_FILE(), { tweaks: {} });
function saveState(state, label) {
  writeJSON(STATE_FILE(), state);
  if (label) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeJSON(path.join(SNAP_DIR(), `${stamp}_${label}.json`), state);
  }
}
const loadSettings = () => ({ guard: true, ...readJSON(SETTINGS_FILE(), {}) });

function addHistory(type, text) {
  const h = readJSON(HISTORY_FILE(), []);
  h.unshift({ time: new Date().toISOString(), type, text });
  writeJSON(HISTORY_FILE(), h.slice(0, 200));
  send('history', h[0]);
}
function send(ch, data) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, data);
}

let nagleCache = null;
async function resolveOps(t) {
  if (t.dynamic === 'nagle') {
    if (!nagleCache) {
      const r = await runPS(String.raw`
$l = @()
Get-ChildItem -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces' | ForEach-Object {
  $p = Get-ItemProperty -LiteralPath $_.PSPath
  $ips = @()
  if ($p.DhcpIPAddress) { $ips += $p.DhcpIPAddress }
  if ($p.IPAddress) { $ips += @($p.IPAddress) }
  if (@($ips | Where-Object { $_ -and $_ -ne '0.0.0.0' }).Count -gt 0) { $l += $_.Name }
}
Emit @{ list = $l }
`);
      nagleCache = arr(r.list);
    }
    return nagleCache.flatMap((k) => [
      reg('Registry::' + k, 'TcpAckFrequency', 'DWord', 1),
      reg('Registry::' + k, 'TCPNoDelay', 'DWord', 1),
    ]);
  }
  return t.ops;
}

// ───────── 최적화 적용/복원 ─────────
async function getStatus() {
  const state = loadState();
  const list = [];
  const allOps = [];
  for (const t of TWEAKS) {
    let ops = [];
    try { ops = await resolveOps(t); } catch (_) {}
    list.push({ t, start: allOps.length, count: ops.length, ops });
    allOps.push(...ops);
  }
  const res = arr((await runPS(OP_READ, { ops: allOps })).results);
  const out = {};
  for (const { t, start, count, ops } of list) {
    out[t.id] = { status: tweakStatus(ops, res.slice(start, start + count)), backedUp: !!state.tweaks[t.id] };
  }
  return out;
}

async function applyTweaks(ids, { silent = false } = {}) {
  const state = loadState();
  const set = new Set(ids);
  // 전원 계획을 새로 만들면 세부 전원 설정이 초기화되므로, 이미 적용했던 세부 설정을 함께 다시 적용
  if (set.has('powerplan')) {
    TWEAKS.filter((t) => t.ops.some((o) => o.t === 'pcfg') && state.tweaks[t.id]).forEach((t) => set.add(t.id));
  }
  const ordered = TWEAKS.filter((t) => set.has(t.id)); // 정의 순서대로 (전원 계획이 먼저)
  const plan = [];
  const allOps = [];
  for (const t of ordered) {
    const ops = await resolveOps(t);
    plan.push({ t, start: allOps.length, ops });
    allOps.push(...ops);
  }
  if (!allOps.length) return { applied: [], errors: ['적용할 항목이 없습니다.'] };
  const res = arr((await runPS(OP_APPLY, { ops: allOps })).results);
  const applied = [];
  const errors = [];
  for (const { t, start, ops } of plan) {
    // 적용 전 값을 읽지 못했으면 null 로 남겨 복원 시 건너뛴다
    const originals = ops.map((op, i) => ({ op, before: res[start + i]?.before ?? null }));
    const prev = state.tweaks[t.id];
    if (!prev) state.tweaks[t.id] = { name: t.name, appliedAt: new Date().toISOString(), originals };
    else {
      prev.originals = mergeOriginals(prev.originals, originals);
      if (!silent) delete prev.stuck; // 사용자가 직접 다시 적용하면 감시 대상으로 복귀
    }
    ops.forEach((_, i) => { if (!res[start + i]?.ok) errors.push(`${t.name}: ${res[start + i]?.err || '실패'}`); });
    applied.push(t.id);
  }
  saveState(state, 'apply');
  if (!silent) addHistory('optimize', `최적화 ${applied.length}개 적용` + (applied.length <= 3 ? ` (${plan.map((p) => p.t.name).join(', ')})` : ''));
  return {
    applied, errors,
    reboot: plan.some((p) => p.t.reboot || p.t.relogin),
    explorer: plan.some((p) => p.t.explorer),
  };
}

async function revertTweaks(ids) {
  const state = loadState();
  let items = [];
  const missing = [];
  for (const id of ids) {
    const b = state.tweaks[id];
    if (!b) { missing.push(TWEAKS.find((x) => x.id === id)?.name || id); continue; }
    items.push(...[...b.originals].reverse().map((o) => ({ ...o, id })));
  }
  items = restoreOrder(items);
  const errors = [];
  const failed = {}; // id → 복원에 실패한 원래 값들 (백업에서 지우지 않고 남긴다)
  if (items.length) {
    const res = arr((await runPS(OP_RESTORE, { items: items.map(({ op, before }) => ({ op, before })) })).results);
    items.forEach((it, i) => {
      if (res[i]?.ok) return;
      errors.push(`${state.tweaks[it.id].name}: ${res[i]?.err || '실패'}`);
      (failed[it.id] ||= []).push({ op: it.op, before: it.before });
    });
  }
  const done = [...new Set(ids)].filter((id) => state.tweaks[id] && !failed[id]);
  for (const id of done) delete state.tweaks[id];
  for (const id of Object.keys(failed)) state.tweaks[id].originals = failed[id].reverse();
  saveState(state, 'restore');
  if (done.length) addHistory('restore', `${done.length}개 항목을 원래대로 복원`);
  return { reverted: done, missing, errors };
}

// ───────── 설정 유지 감시 ─────────
// Windows 업데이트 등으로 설정이 되돌아가면, 이 프로그램이 적용했던 항목을 다시 적용한다.
// 재적용해도 적용되지 않는 항목(권한 부족, Windows 가 값을 바꿔 저장하는 경우 등)은 stuck 으로 표시해
// 10분마다 같은 항목을 끝없이 재적용·기록하지 않게 한다. 사용자가 직접 다시 적용하면 해제된다.
let guardBusy = false;
async function runGuard() {
  if (guardBusy || !loadSettings().guard || bench.isRunning()) return { reapplied: [] };
  guardBusy = true;
  try {
    return await exclusive(async () => {
      const drift = driftIds(TWEAKS, loadState().tweaks, await getStatus());
      if (!drift.length) return { reapplied: [] };
      await applyTweaks(drift, { silent: true });
      const after = await getStatus();
      const fixed = drift.filter((id) => after[id]?.status === 'on');
      const stuck = drift.filter((id) => after[id]?.status !== 'on');
      if (stuck.length) {
        const state = loadState();
        stuck.forEach((id) => { if (state.tweaks[id]) state.tweaks[id].stuck = true; });
        saveState(state);
      }
      const names = TWEAKS.filter((t) => fixed.includes(t.id)).map((t) => t.name);
      if (names.length) {
        addHistory('guard', `되돌아간 설정 ${names.length}개 자동 재적용: ${names.join(', ')}`);
        send('guard', names);
      }
      return { reapplied: names, stuck };
    });
  } finally {
    guardBusy = false;
  }
}

// ───────── 단일 작업 ─────────
const ACTION_SCRIPTS = {
  trimMemory: String.raw`
Add-Type -Namespace OFB -Name Psapi -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(System.IntPtr hProcess);'
$before = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
$n = 0
foreach ($p in Get-Process) { try { if ([OFB.Psapi]::EmptyWorkingSet($p.Handle)) { $n++ } } catch {} }
Start-Sleep -Milliseconds 800
$after = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
Emit @{ msg = ('프로세스 ' + $n + '개 정리, 사용 가능 메모리 ' + [math]::Round($before / 1024) + ' MB → ' + [math]::Round($after / 1024) + ' MB') }
`,
  flushDns: String.raw`
ipconfig /flushdns | Out-Null
Emit @{ msg = 'DNS 캐시를 비웠습니다.' }
`,
  resetNet: String.raw`
netsh winsock reset | Out-Null
netsh int ip reset | Out-Null
ipconfig /flushdns | Out-Null
Emit @{ msg = '네트워크 스택을 초기화했습니다. PC를 재부팅해야 적용됩니다.'; reboot = $true }
`,
  restartExplorer: String.raw`
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }
Emit @{ msg = '탐색기를 다시 시작했습니다.' }
`,
  restorePoint: String.raw`
try { Enable-ComputerRestore -Drive ($env:SystemDrive + '\') -ErrorAction SilentlyContinue } catch {}
# 24시간에 1개 제한을 잠시 풀었다가 원래 값으로 돌려 놓는다
$k = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore'
$prev = RG $k 'SystemRestorePointCreationFrequency'
RS $k 'SystemRestorePointCreationFrequency' 'DWord' 0
try { Checkpoint-Computer -Description 'Oreum FPS Booster' -RestorePointType MODIFY_SETTINGS }
finally { if ($prev.exists) { RS $k 'SystemRestorePointCreationFrequency' $prev.kind $prev.value } else { RDel $k 'SystemRestorePointCreationFrequency' } }
Emit @{ msg = '시스템 복원 지점을 만들었습니다.' }
`,
  sfc: String.raw`
$p = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\sfc.exe') -ArgumentList '/scannow' -Wait -PassThru -WindowStyle Hidden
Emit @{ msg = ('시스템 파일 검사 완료 (종료 코드 ' + $p.ExitCode + '). 자세한 결과: ' + $env:WINDIR + '\Logs\CBS\CBS.log') }
`,
  dism: String.raw`
$p = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\dism.exe') -ArgumentList '/Online','/Cleanup-Image','/RestoreHealth' -Wait -PassThru -WindowStyle Hidden
if ($p.ExitCode -eq 0) { Emit @{ msg = 'Windows 이미지 복구가 정상적으로 끝났습니다.' } } else { Emit @{ msg = ('DISM 종료 코드 ' + $p.ExitCode + ' — 인터넷 연결을 확인하고 다시 시도하세요.') } }
`,
};

const SYSINFO_SCRIPT = String.raw`
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1)
$gpu = (@(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Remote|Virtual|Parsec' } | ForEach-Object { $_.Name }) -join ', ')
$os = Get-CimInstance Win32_OperatingSystem
$board = Get-CimInstance Win32_BaseBoard
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$up = (Get-Date) - $os.LastBootUpTime
Emit @{
  cpu = $cpu.Name.Trim(); cores = ([string]$cpu.NumberOfCores + '코어 ' + [string]$cpu.NumberOfLogicalProcessors + '스레드')
  gpu = $gpu; ramGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  os = ($os.Caption + ' (빌드 ' + $os.BuildNumber + ')'); board = ($board.Manufacturer + ' ' + $board.Product)
  uptime = ('{0}일 {1}시간 {2}분' -f $up.Days, $up.Hours, $up.Minutes)
  admin = $admin; plan = (PG).line
}
`;

// ───────── 관리자 재실행 ─────────
async function relaunchAsAdmin() {
  // 새로 뜨는 관리자 창이 단일 실행 잠금에 막히지 않도록 먼저 잠금을 푼다
  app.releaseSingleInstanceLock();
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const args = app.isPackaged ? [] : ['"' + app.getAppPath() + '"'];
  try {
    await runPS(String.raw`
if (@($A.args).Count) { Start-Process -FilePath $A.exe -ArgumentList @($A.args) -Verb RunAs } else { Start-Process -FilePath $A.exe -Verb RunAs }
Emit @{ ok = $true }`, { exe, args });
  } catch (e) {
    app.requestSingleInstanceLock(); // UAC 취소 등으로 실패하면 잠금을 되찾는다
    throw new Error('관리자 권한으로 다시 실행하지 못했습니다. (' + e.message + ')');
  }
  relaunching = true;
  app.quit();
}

// ───────── IPC ─────────
function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, ...a) => {
    try { return { ok: true, data: await fn(...a) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

handle('meta', () => ({
  version: app.getVersion(),
  categories: CATEGORIES,
  tweaks: TWEAKS.map(({ ops, ...rest }) => rest),
  actions: ACTIONS,
  cleanGroups: CLEAN_GROUPS,
  cleanItems: CLEAN_ITEMS.map(({ paths, ...rest }) => rest),
}));
handle('sysinfo', () => runPS(SYSINFO_SCRIPT));
handle('status', () => getStatus());
handle('apply', (ids) => exclusive(() => applyTweaks(arr(ids))));
handle('revert', (ids) => exclusive(() => revertTweaks(arr(ids))));
handle('revertAll', () => exclusive(() => revertTweaks(Object.keys(loadState().tweaks))));
handle('action', async (id) => {
  const s = ACTION_SCRIPTS[id];
  if (!s) throw new Error('알 수 없는 작업');
  const r = await runPS(s, {}, { timeout: 45 * 60 * 1000 });
  addHistory('action', r.msg || id);
  return r;
});

handle('clean:scan', async () => arr((await runPS(CLEAN_LIB + CLEAN_SCAN, { items: CLEAN_ITEMS }, { timeout: 10 * 60 * 1000 })).results));
handle('clean:run', async (ids) => {
  const items = CLEAN_ITEMS.filter((c) => arr(ids).includes(c.id));
  const res = arr((await runPS(CLEAN_LIB + CLEAN_RUN, { items }, { timeout: 20 * 60 * 1000 })).results);
  const freed = res.reduce((s, r) => s + Number(r.freed || 0), 0);
  const count = res.reduce((s, r) => s + Number(r.count || 0), 0);
  addHistory('clean', `파일 청소: ${count.toLocaleString()}개, ${fmtMB(freed)} 확보`);
  return { results: res, freed, count };
});
handle('drives', async () => arr((await runPS(DRIVES)).drives));

handle('check:run', async () => {
  const res = arr((await runPS(CHECK_SCRIPT, {}, { timeout: 5 * 60 * 1000 })).results);
  const c = { ok: 0, warn: 0, bad: 0, info: 0 };
  res.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
  addHistory('check', `시스템 검사: 정상 ${c.ok} · 주의 ${c.warn} · 위험 ${c.bad}`);
  return res;
});

handle('bloat:list', async () => arr((await runPS(BLOAT_LIST, { list: BLOAT })).items));
handle('bloat:remove', async (fulls) => {
  const patterns = BLOAT.map((x) => x.pattern);
  const res = arr((await runPS(BLOAT_REMOVE, { list: arr(fulls).map(String), patterns }, { timeout: 15 * 60 * 1000 })).results);
  const ok = res.filter((r) => r.ok).length;
  if (ok) addHistory('bloat', `기본 앱 ${ok}개 제거`);
  return res;
});

handle('startup:list', async () => arr((await runPS(STARTUP_LIST_SCRIPT, { srcs: STARTUP_SRCS })).items));
handle('startup:set', async (item, enabled) => {
  // 렌더러가 넘긴 경로를 그대로 쓰지 않고, 알려진 위치에서만 고른다
  const src = STARTUP_SRCS.find((x) => x.src === item?.src);
  if (!src || !item.name) throw new Error('알 수 없는 시작 프로그램');
  await runPS(STARTUP_SET_SCRIPT, { ap: src.ap, name: String(item.name), enabled: !!enabled });
  addHistory('startup', `시작 프로그램 "${item.name}" ${enabled ? '켜기' : '끄기'}`);
  return true;
});

handle('backup:info', () => Object.entries(loadState().tweaks).map(([id, v]) => ({ id, name: v.name, appliedAt: v.appliedAt, count: v.originals.length })));
handle('backup:open', () => { fs.mkdirSync(SNAP_DIR(), { recursive: true }); return shell.openPath(DIR()); });
handle('history', () => readJSON(HISTORY_FILE(), []).slice(0, 50));
handle('settings:get', () => loadSettings());
handle('settings:set', (patch) => {
  const s = loadSettings();
  if (patch && typeof patch.guard === 'boolean') s.guard = patch.guard;
  writeJSON(SETTINGS_FILE(), s);
  return s;
});
handle('guard:run', () => runGuard());
handle('admin:relaunch', () => exclusive(() => relaunchAsAdmin()));
handle('confirm', async (msg) => {
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['확인', '취소'], defaultId: 0, cancelId: 1, title: 'Oreum FPS Booster', message: msg });
  return r.response === 0;
});
handle('reboot', () => runPS('shutdown /r /t 5 /c "Oreum FPS Booster: 설정 적용을 위해 재부팅합니다."\nEmit @{ ok = $true }'));

// ───────── 전/후 비교 ─────────
const monBuf = [];
function idleSnapshot() {
  const recent = monBuf.slice(-3).filter((m) => m.cpu != null);
  return { cpu: recent.length ? +(recent.reduce((a, m) => a + m.cpu, 0) / recent.length).toFixed(1) : null };
}
const benchProgress = (pct, text) => send('bench:progress', { pct, text });
const benchLabel = (v) => String(v ?? '').trim().slice(0, 40) || '측정';
const clampInt = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

handle('bench:meta', () => ({ system: bench.SYSTEM_METRICS, game: bench.GAME_METRICS, presentmon: !!bench.pmFind() }));
handle('bench:list', () => bench.loadRuns());
handle('bench:delete', (id) => { bench.saveRuns(bench.loadRuns().filter((r) => r.id !== id)); return true; });
handle('bench:system', async (label) => {
  const run = await bench.runSystemBench({ label: benchLabel(label), getIdle: idleSnapshot, progress: benchProgress });
  addHistory('bench', `시스템 벤치마크 (${run.label}): 그래픽 ${run.metrics.gpuFps ?? '-'} FPS · CPU ${run.metrics.cpuMulti}점`);
  return run;
});
handle('bench:procs', () => bench.listGameProcs());
handle('bench:game', async (opt) => {
  // 렌더러 값은 범위를 제한해서 넘긴다 (빈 값이면 NaN 이 되어 진행률·시간 제한이 깨짐)
  const pid = clampInt(opt?.pid, 1, 2 ** 31, 0);
  if (!pid) throw new Error('측정할 게임을 선택하세요.');
  const run = await bench.runGameBench({
    pid, name: String(opt.name || 'game').slice(0, 80), label: benchLabel(opt.label),
    seconds: clampInt(opt.seconds, 5, 600, 60), delay: clampInt(opt.delay, 0, 60, 10), progress: benchProgress,
  });
  addHistory('bench', `게임 FPS (${run.label}) ${run.app}: 평균 ${run.metrics.avgFps} · 1% Low ${run.metrics.low1}`);
  return run;
});

// ───────── 창 ─────────
function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#0b0f14',
    title: 'Oreum FPS Booster',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 외부 페이지로 이동하거나 새 창을 여는 것을 막는다
  win.on('close', (e) => {
    if (pendingOps > 0 && !relaunching && !SMOKE) {
      e.preventDefault();
      dialog.showMessageBox(win, { type: 'warning', title: 'Oreum FPS Booster', message: '설정을 적용·복원하는 중입니다. 끝난 뒤에 닫아 주세요.' });
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    monitor.start((m) => {
      monBuf.push(m);
      if (monBuf.length > 10) monBuf.shift();
      send('monitor', m);
    });
    if (SMOKE) return runSmoke();
    // 시작 30초 뒤 한 번, 이후 10분마다 설정 유지 감시
    setTimeout(() => runGuard().catch(() => {}), 30 * 1000);
    setInterval(() => runGuard().catch(() => {}), 10 * 60 * 1000);
  });
}

// ───────── 스모크 테스트 (npm run smoke) ─────────
// 화면을 띄워 모든 페이지를 한 번씩 열어 보고 렌더러 오류가 없는지 확인한 뒤 종료한다. 설정은 바꾸지 않는다.
const smokeErrors = [];
function smokeExit(report) {
  process.stdout.write('@@SMOKE@@' + JSON.stringify({ report, errors: smokeErrors }) + '\n');
  app.exit(smokeErrors.length || !report || report.toastErr ? 1 : 0);
}
async function runSmoke() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  let report = null;
  try {
    const ready = 'typeof META !== "undefined" && !!META && document.getElementById("busy").classList.contains("hidden")';
    for (let i = 0; i < 120 && !(await js(ready)); i++) await wait(500);
    for (const p of ['optimize', 'bench', 'cleaner', 'check', 'startup', 'bloat', 'personal', 'backup', 'history', 'dash']) {
      await js(`goto('${p}')`);
      await wait(p === 'bloat' || p === 'startup' ? 6000 : 800);
    }
    await wait(3000);
    report = await js(`({
      version: META.version,
      tweakCards: document.querySelectorAll('#optList .item').length,
      personalCards: document.querySelectorAll('#personalList .item').length,
      cleanItems: document.querySelectorAll('#cleanGroups .cb').length,
      statusKeys: Object.keys(STATUS).length,
      startupRows: document.querySelectorAll('#startupList .item').length,
      startupLabels: [...new Set([...document.querySelectorAll('#startupList .badge')].map((b) => b.textContent))],
      bloatText: document.getElementById('bloatList').innerText.slice(0, 80),
      cpuTile: document.querySelector('#monitor .tile[data-m=cpu] .v').innerText,
      sysCpu: document.getElementById('sCpu').innerText,
      score: document.getElementById('scoreText').innerText,
      benchText: document.getElementById('benchRuns').innerText.slice(0, 60),
      toastErr: document.getElementById('toast').classList.contains('err') && !document.getElementById('toast').classList.contains('hidden') ? document.getElementById('toast').innerText : '',
    })`);
  } catch (e) {
    smokeErrors.push('smoke: ' + e.message);
  }
  smokeExit(report);
}

// 두 번 실행되면 감시·모니터가 중복되므로 기존 창을 앞으로 가져온다
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    createWindow();
    if (SMOKE) {
      win.webContents.on('console-message', (_e, level, message, line, sourceId) => { if (level >= 3) smokeErrors.push(`${message} (${sourceId}:${line})`); });
      win.webContents.on('render-process-gone', (_e, d) => smokeErrors.push('renderer gone: ' + d.reason));
      setTimeout(() => { smokeErrors.push('timeout'); smokeExit(null); }, 150 * 1000);
    }
  });
}
app.on('before-quit', () => monitor.stop());
app.on('window-all-closed', () => { monitor.stop(); app.quit(); });
