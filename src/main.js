const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { runPS } = require('./ps');
const { CATEGORIES, TWEAKS, ACTIONS, reg } = require('./tweaks');
const { CLEAN_GROUPS, CLEAN_ITEMS, CLEAN_LIB, CLEAN_SCAN, CLEAN_RUN, DRIVES } = require('./cleaner');
const { CHECK_SCRIPT } = require('./checks');
const { BLOAT, BLOAT_LIST, BLOAT_REMOVE } = require('./bloat');
const monitor = require('./monitor');
const bench = require('./bench');

// 그래픽 테스트가 모니터 주사율(수직 동기화)에 묶이지 않도록 프레임 제한 해제
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

let win;
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

// ───────── 유틸 ─────────
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

function opMatches(op, cur) {
  if (!cur) return false;
  switch (op.t) {
    case 'reg': return !!cur.exists && normVal(op.kind, op.value) === normVal(cur.kind, cur.value);
    case 'svc': return !cur.exists || Number(cur.start) === op.start; // 서비스가 없으면 목적 달성
    case 'power': return /Oreum FPS Ultimate|8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c|e9a42b02-d5df-448d-aa00-03f14749eb61/i.test(cur.line || '');
    case 'pcfg': return !!cur.exists && Number(cur.ac) === op.value;
    case 'key': return !!cur.leaf;
    default: return false;
  }
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

const READ_SCRIPT = String.raw`
$out = @()
foreach ($o in @($A.ops)) {
  try { $out += ,@{ ok = $true; cur = (OpRead $o) } } catch { $out += ,@{ ok = $false; err = $_.Exception.Message } }
}
Emit @{ results = $out }
`;

const APPLY_SCRIPT = String.raw`
$out = @()
foreach ($o in @($A.ops)) {
  $before = $null
  try {
    OpPrepare $o
    $before = OpRead $o
    OpApply $o
    $out += ,@{ ok = $true; before = $before }
  } catch { $out += ,@{ ok = $false; before = $before; err = $_.Exception.Message } }
}
Emit @{ results = $out }
`;

const RESTORE_SCRIPT = String.raw`
$out = @()
foreach ($i in @($A.items)) {
  try { OpRestore $i.op $i.before; $out += ,@{ ok = $true } } catch { $out += ,@{ ok = $false; err = $_.Exception.Message } }
}
Emit @{ results = $out }
`;

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
  const res = arr((await runPS(READ_SCRIPT, { ops: allOps })).results);
  const out = {};
  for (const { t, start, count, ops } of list) {
    let hit = 0;
    for (let i = 0; i < count; i++) if (res[start + i]?.ok && opMatches(ops[i], res[start + i].cur)) hit++;
    out[t.id] = {
      status: count === 0 ? 'na' : hit === count ? 'on' : hit === 0 ? 'off' : 'partial',
      backedUp: !!state.tweaks[t.id],
    };
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
  const res = arr((await runPS(APPLY_SCRIPT, { ops: allOps })).results);
  const applied = [];
  const errors = [];
  for (const { t, start, ops } of plan) {
    const originals = ops.map((op, i) => ({ op, before: res[start + i]?.before ?? { exists: false } }));
    if (!state.tweaks[t.id]) state.tweaks[t.id] = { name: t.name, appliedAt: new Date().toISOString(), originals };
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
  const items = [];
  const done = [];
  const missing = [];
  for (const id of ids) {
    const b = state.tweaks[id];
    if (!b) { missing.push(TWEAKS.find((x) => x.id === id)?.name || id); continue; }
    items.push(...[...b.originals].reverse());
    done.push(id);
  }
  const errors = [];
  if (items.length) {
    const r = await runPS(RESTORE_SCRIPT, { items });
    arr(r.results).forEach((x) => { if (!x.ok) errors.push(x.err); });
  }
  for (const id of done) delete state.tweaks[id];
  saveState(state, 'restore');
  if (done.length) addHistory('restore', `${done.length}개 항목을 원래대로 복원`);
  return { reverted: done, missing, errors };
}

// ───────── 설정 유지 감시 ─────────
// Windows 업데이트 등으로 설정이 되돌아가면, 이 프로그램이 적용했던 항목을 다시 적용한다.
let guardBusy = false;
async function runGuard() {
  if (guardBusy || !loadSettings().guard || bench.isRunning()) return { reapplied: [] };
  guardBusy = true;
  try {
    const st = await getStatus();
    const drift = TWEAKS.filter((t) => st[t.id]?.backedUp && (st[t.id].status === 'off' || st[t.id].status === 'partial')).map((t) => t.id);
    if (!drift.length) return { reapplied: [] };
    await applyTweaks(drift, { silent: true });
    const names = TWEAKS.filter((t) => drift.includes(t.id)).map((t) => t.name);
    addHistory('guard', `되돌아간 설정 ${names.length}개 자동 재적용: ${names.join(', ')}`);
    send('guard', names);
    return { reapplied: names };
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
New-ItemProperty -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore' -Name SystemRestorePointCreationFrequency -PropertyType DWord -Value 0 -Force | Out-Null
Checkpoint-Computer -Description 'Oreum FPS Booster' -RestorePointType MODIFY_SETTINGS
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

const STARTUP_SRCS = [
  { src: 'HKCU', run: 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', ap: 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' },
  { src: 'HKLM', run: 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', ap: 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' },
  { src: 'HKLM32', run: 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', ap: 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32' },
];

const STARTUP_LIST_SCRIPT = String.raw`
$res = @()
foreach ($s in @($A.srcs)) {
  if (-not (Test-Path -LiteralPath $s.run)) { continue }
  $k = Get-Item -LiteralPath $s.run
  foreach ($n in $k.GetValueNames()) {
    if ($n -eq '') { continue }
    $en = $true
    $a = RG $s.ap $n
    if ($a.exists -and $a.kind -eq 'Binary') { $b = [Convert]::FromBase64String($a.value); if ($b.Length -gt 0 -and ($b[0] % 2) -eq 1) { $en = $false } }
    $res += ,@{ src = $s.src; name = $n; cmd = [string]$k.GetValue($n); enabled = $en; ap = $s.ap }
  }
}
Emit @{ items = $res }
`;

const STARTUP_SET_SCRIPT = String.raw`
$b = New-Object byte[] 12
if ($A.enabled) { $b[0] = 2 } else { $b[0] = 3; [BitConverter]::GetBytes([DateTime]::Now.ToFileTime()).CopyTo($b, 4) }
RS $A.ap $A.name 'Binary' ([Convert]::ToBase64String($b))
Emit @{ ok = $true }
`;

// ───────── 관리자 재실행 ─────────
async function relaunchAsAdmin() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const args = app.isPackaged ? [] : [app.getAppPath()];
  const argList = args.map((a) => `'"${a.replace(/'/g, "''")}"'`).join(',');
  await runPS(`Start-Process -FilePath '${exe.replace(/'/g, "''")}' ${argList ? '-ArgumentList ' + argList : ''} -Verb RunAs\nEmit @{ ok = $true }`);
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
handle('apply', (ids) => applyTweaks(arr(ids)));
handle('revert', (ids) => revertTweaks(arr(ids)));
handle('revertAll', () => revertTweaks(Object.keys(loadState().tweaks)));
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
  const res = arr((await runPS(BLOAT_REMOVE, { list: arr(fulls) }, { timeout: 15 * 60 * 1000 })).results);
  const ok = res.filter((r) => r.ok).length;
  if (ok) addHistory('bloat', `기본 앱 ${ok}개 제거`);
  return res;
});

handle('startup:list', async () => arr((await runPS(STARTUP_LIST_SCRIPT, { srcs: STARTUP_SRCS })).items));
handle('startup:set', async (item, enabled) => {
  await runPS(STARTUP_SET_SCRIPT, { ap: item.ap, name: item.name, enabled: !!enabled });
  addHistory('startup', `시작 프로그램 "${item.name}" ${enabled ? '켜기' : '끄기'}`);
  return true;
});

handle('backup:info', () => Object.entries(loadState().tweaks).map(([id, v]) => ({ id, name: v.name, appliedAt: v.appliedAt, count: v.originals.length })));
handle('backup:open', () => { fs.mkdirSync(SNAP_DIR(), { recursive: true }); return shell.openPath(DIR()); });
handle('history', () => readJSON(HISTORY_FILE(), []).slice(0, 50));
handle('settings:get', () => loadSettings());
handle('settings:set', (patch) => { const s = { ...loadSettings(), ...patch }; writeJSON(SETTINGS_FILE(), s); return s; });
handle('guard:run', () => runGuard());
handle('admin:relaunch', () => relaunchAsAdmin());
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

handle('bench:meta', () => ({ system: bench.SYSTEM_METRICS, game: bench.GAME_METRICS, presentmon: !!bench.pmFind() }));
handle('bench:list', () => bench.loadRuns());
handle('bench:delete', (id) => { bench.saveRuns(bench.loadRuns().filter((r) => r.id !== id)); return true; });
handle('bench:system', async (label) => {
  const run = await bench.runSystemBench({ label, getIdle: idleSnapshot, progress: benchProgress });
  addHistory('bench', `시스템 벤치마크 (${run.label}): 그래픽 ${run.metrics.gpuFps ?? '-'} FPS · CPU ${run.metrics.cpuMulti}점`);
  return run;
});
handle('bench:procs', () => bench.listGameProcs());
handle('bench:game', async (opt) => {
  const run = await bench.runGameBench({ ...opt, progress: benchProgress });
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    monitor.start((m) => {
      monBuf.push(m);
      if (monBuf.length > 10) monBuf.shift();
      send('monitor', m);
    });
    // 시작 30초 뒤 한 번, 이후 10분마다 설정 유지 감시
    setTimeout(() => runGuard().catch(() => {}), 30 * 1000);
    setInterval(() => runGuard().catch(() => {}), 10 * 60 * 1000);
  });
}

app.whenReady().then(createWindow);
app.on('before-quit', () => monitor.stop());
app.on('window-all-closed', () => { monitor.stop(); app.quit(); });
