// 실시간 성능 모니터: 상주 PowerShell 하나가 1.5초마다 지표를 출력한다.
// (성능 카운터 이름은 언어별로 달라서 언어와 무관한 WMI 클래스를 사용)
const { spawn } = require('child_process');
const os = require('os');

const LOOP = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $o = @{}
  $c = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
  if ($c) { $o.cpu = [int]$c.PercentProcessorTime }
  $d = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
  if ($d) { $o.disk = [int][math]::Max(0, 100 - [int]$d.PercentIdleTime) }
  $n = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface)
  if ($n.Count) { $o.rx = [int64](($n | Measure-Object BytesReceivedPersec -Sum).Sum); $o.tx = [int64](($n | Measure-Object BytesSentPersec -Sum).Sum) }
  $g = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like '*engtype_3D*' })
  if ($g.Count) { $o.gpu = [int][math]::Min(100, (($g | Measure-Object UtilizationPercentage -Sum).Sum)) }
  Write-Output ('@@M@@' + (ConvertTo-Json -InputObject $o -Compress))
  Start-Sleep -Milliseconds 1500
}
`;

let proc = null;
let stopped = false;
let restartTimer = null;

function start(onData) {
  if (proc || process.platform !== 'win32') return;
  stopped = false;
  const encoded = Buffer.from(LOOP, 'utf16le').toString('base64');
  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('@@M@@')) continue;
      try {
        const m = JSON.parse(line.slice(5));
        m.memTotal = os.totalmem();
        m.memUsed = os.totalmem() - os.freemem();
        m.t = Date.now();
        onData(m);
      } catch (_) {}
    }
  });
  // PowerShell 이 죽거나 아예 시작되지 못하면(백신·정책 차단 등) 5초 뒤 다시 띄워 그래프가 멈추지 않게 한다.
  // 'error' 를 처리하지 않으면 메인 프로세스가 죽고, 시작 실패 시에는 'exit' 가 오지 않을 수 있다.
  const me = proc;
  const ended = () => {
    if (proc !== me) return; // 이미 정리됐거나 새 프로세스로 바뀜
    proc = null;
    if (!stopped) { clearTimeout(restartTimer); restartTimer = setTimeout(() => start(onData), 5000); }
  };
  me.on('error', ended);
  me.on('exit', ended);
}

function stop() {
  stopped = true;
  clearTimeout(restartTimer);
  if (proc) { try { proc.kill(); } catch (_) {} proc = null; }
}

module.exports = { start, stop };
