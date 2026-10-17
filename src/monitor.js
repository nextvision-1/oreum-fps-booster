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

function start(onData) {
  if (proc || process.platform !== 'win32') return;
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
  proc.on('exit', () => { proc = null; });
}

function stop() {
  if (proc) { try { proc.kill(); } catch (_) {} proc = null; }
}

module.exports = { start, stop };
