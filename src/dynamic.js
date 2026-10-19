// PC 마다 대상이 달라지는 최적화 항목의 연산 만들기 (어댑터·장치·설치 프로그램 등)
// 각 항목: script(PowerShell, Emit 으로 결과) + build(결과) → 연산 목록. 결과는 실행 중 한 번만 계산해 캐시한다.
// 대상이 없으면 빈 목록 → 화면에 "해당 없음".
const { runPS } = require('./ps');
const { arr } = require('./logic');

const reg = (path, name, kind, value) => ({ t: 'reg', path, name, kind, value });
const dw = (path, name, value) => reg(path, name, 'DWord', value);
const HKLM = 'Registry::HKEY_LOCAL_MACHINE';

const DYNAMIC = {
  // 사용 중인 네트워크 인터페이스마다 Nagle 끄기
  nagle: {
    script: String.raw`
$l = @()
Get-ChildItem -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces' | ForEach-Object {
  $p = Get-ItemProperty -LiteralPath $_.PSPath
  $ips = @()
  if ($p.DhcpIPAddress) { $ips += $p.DhcpIPAddress }
  if ($p.IPAddress) { $ips += @($p.IPAddress) }
  if (@($ips | Where-Object { $_ -and $_ -ne '0.0.0.0' }).Count -gt 0) { $l += $_.Name }
}
Emit @{ list = $l }
`,
    build: (r) => arr(r.list).flatMap((k) => [dw('Registry::' + k, 'TcpAckFrequency', 1), dw('Registry::' + k, 'TCPNoDelay', 1)]),
  },

  // Windows 11 22H2+ "창 모드 게임 최적화": 기존 DirectX 전역 설정 문자열에 SwapEffectUpgradeEnable=1 만 더한다
  swapfx: {
    script: String.raw`
$b = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
$v = RG 'Registry::HKEY_CURRENT_USER\Software\Microsoft\DirectX\UserGpuPreferences' 'DirectXUserGlobalSettings'
Emit @{ build = $b; value = [string]$v.value }
`,
    build: (r) => {
      if (Number(r.build) < 22621) return [];
      const parts = String(r.value || '').split(';').map((x) => x.trim()).filter((x) => x && !/^SwapEffectUpgradeEnable=/i.test(x));
      parts.push('SwapEffectUpgradeEnable=1');
      return [reg('Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\DirectX\\UserGpuPreferences', 'DirectXUserGlobalSettings', 'String', parts.join(';') + ';')];
    },
  },

  // USB 마우스·키보드·입력장치의 "전원 절약을 위해 장치 끄기" 해제.
  // USB 입력장치는 그 자체가 USB\VID_… 형태의 HIDClass 장치로 등록되므로 한 번의 조회로 찾는다 (부모 장치 추적은 너무 느림)
  // (WMI 장치 조회는 수십 초가 걸려 레지스트리를 직접 읽는다. 연결된 장치만: 드라이버 서비스가 HidUsb 이고 현재 연결 상태)
  hidpower: {
    script: String.raw`
$present = @{}
try { foreach ($v in (Get-ItemProperty -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\HidUsb\Enum' -ErrorAction Stop).PSObject.Properties) { if ($v.Name -match '^\d+$') { $present[[string]$v.Value] = $true } } } catch {}
$l = @()
foreach ($id in $present.Keys) {
  if ($id -notlike 'USB\VID_*') { continue }
  $k = 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\' + $id + '\Device Parameters'
  if (-not (Test-Path -LiteralPath $k)) { continue }
  $ss = RG $k 'SelectiveSuspendEnabled'
  $l += ,@{ key = $k; ssKind = [string]$ss.kind }
}
Emit @{ list = $l }
`,
    build: (r) => arr(r.list).flatMap((d) => [
      dw(d.key, 'EnhancedPowerManagementEnabled', 0),
      dw(d.key, 'AllowIdleIrpInD3', 0),
      // 장치에 따라 1바이트 Binary 로 저장돼 있으므로 원래 형식을 유지한다
      d.ssKind === 'Binary' ? reg(d.key, 'SelectiveSuspendEnabled', 'Binary', 'AA==') : dw(d.key, 'SelectiveSuspendEnabled', 0),
    ]),
  },

  // 실제 네트워크 어댑터의 절전 기능(에너지 효율 이더넷·그린 이더넷 등) 끄기. 드라이버가 지원하는 값만 바꾼다
  nicpower: {
    script: String.raw`
$cls = 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}'
$names = @('*EEE', 'AdvancedEEE', 'EEELinkAdvertisement', 'EnableGreenEthernet', 'GreenEthernet', 'PowerSavingMode', 'ULPMode', 'EnablePowerManagement')
$guids = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -or $_.MediaConnectionState -eq 'Connected' } | ForEach-Object { $_.InterfaceGuid })
$l = @()
foreach ($k in @(Get-ChildItem -LiteralPath $cls -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\d{4}$' })) {
  $id = (RG $k.PSPath 'NetCfgInstanceId').value
  if (-not ($guids -contains $id)) { continue }
  $vals = @($names | Where-Object { (RG $k.PSPath $_).exists })
  $l += ,@{ key = ($k.PSPath -replace '^Microsoft\.PowerShell\.Core\\', ''); vals = $vals }
}
Emit @{ list = $l }
`,
    build: (r) => arr(r.list).flatMap((a) => [
      // 장치 관리자 "전원을 절약하기 위해 컴퓨터가 이 장치를 끌 수 있음" 해제
      dw(a.key, 'PnPCapabilities', 24),
      ...arr(a.vals).map((n) => reg(a.key, n, 'String', '0')),
    ]),
  },

  // DNS: 자동(DHCP) DNS 를 쓰는 어댑터만, Cloudflare·Google 중 이 네트워크에서 더 빠른 쪽이 현재보다 빠를 때만 바꾼다.
  // 회사·학교 도메인 PC, VPN·가상 어댑터, 사용자가 직접 지정한 DNS 는 건드리지 않는다.
  dns: {
    script: String.raw`
if ((Get-CimInstance Win32_ComputerSystem).PartOfDomain) { Emit @{ skip = '회사·학교 도메인에 가입된 PC'; list = @() }; return }
$ads = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'VPN|TAP|WireGuard|Tunnel|Virtual|Hyper-V|VMware|VirtualBox' })
$l = @(); $cur = $null
foreach ($a in $ads) {
  if ([string](RG (DnsKey $a.InterfaceGuid) 'NameServer').value) { continue }
  $l += $a.InterfaceGuid
  if (-not $cur) { $cur = @((Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)[0] }
}
function Lat($s) {
  if (-not $s) { return 9999 }
  $best = 9999
  foreach ($n in @('www.google.com', 'www.microsoft.com', 'www.naver.com')) {
    try { $ms = (Measure-Command { Resolve-DnsName -Name $n -Server $s -DnsOnly -Type A -QuickTimeout -ErrorAction Stop | Out-Null }).TotalMilliseconds; if ($ms -lt $best) { $best = $ms } } catch {}
  }
  return [int]$best
}
Emit @{ list = $l; current = $cur; cur = (Lat $cur); cf = (Lat '1.1.1.1'); gg = (Lat '8.8.8.8') }
`,
    build: (r) => {
      const best = Number(r.cf) <= Number(r.gg) ? { ms: Number(r.cf), servers: ['1.1.1.1', '1.0.0.1'] } : { ms: Number(r.gg), servers: ['8.8.8.8', '8.8.4.4'] };
      // 공용 DNS 가 응답하지 않거나, 지금 DNS 보다 10ms 이상 빠르지 않으면 바꾸지 않는다
      if (!(best.ms < 9999) || !(best.ms + 10 < Number(r.cur))) return [];
      return arr(r.list).map((guid) => ({ t: 'dns', guid, servers: best.servers }));
    },
  },

  // Discord 하드웨어 가속 끄기 (settings.json). Discord 가 설치돼 있을 때만
  discord: {
    script: String.raw`
Emit @{ exists = (Test-Path -LiteralPath ([Environment]::ExpandEnvironmentVariables('%APPDATA%\discord\settings.json'))) }
`,
    build: (r) => (r.exists ? [{ t: 'json', path: '%APPDATA%\\discord\\settings.json', key: 'enableHardwareAcceleration', value: false, proc: 'Discord' }] : []),
  },
};

const cache = {};
// backup: 이 항목을 이미 적용했다면 그때 쓴 연산(백업의 op 목록). 상태 확인·되돌리기는 그 연산 기준으로 한다
async function resolveDynamic(t, backup) {
  if (backup?.originals?.length) return backup.originals.map((o) => o.op);
  const d = DYNAMIC[t.dynamic];
  if (!d) return t.ops;
  if (!cache[t.dynamic]) cache[t.dynamic] = d.build(await runPS(d.script, {}, { timeout: 120000 }));
  return cache[t.dynamic];
}
const clearDynamicCache = () => { for (const k of Object.keys(cache)) delete cache[k]; };

module.exports = { DYNAMIC, resolveDynamic, clearDynamicCache };
