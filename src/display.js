// 모니터 최대 주사율: 같은 해상도에서 지원하는 가장 높은 주사율로 바꾼다 (예: 144Hz 모니터가 60Hz 로 묶여 있을 때)
// 화면이 나오지 않을 수 있으므로, 사용자가 일정 시간 안에 "유지"를 누르지 않으면 자동으로 원래 주사율로 되돌린다.
const DISPLAY_LIB = String.raw`
if (-not ('OFBDisp' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class OFBDisp {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplayDevices(string dev, int i, ref DISPLAY_DEVICE dd, int flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);
  public static DEVMODE NewMode() { DEVMODE d = new DEVMODE(); d.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); return d; }
  public static DISPLAY_DEVICE NewDevice() { DISPLAY_DEVICE d = new DISPLAY_DEVICE(); d.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE)); return d; }
}
'@
}

# 바탕화면에 연결된 모니터마다 현재 모드와, 같은 해상도·색 깊이에서 가능한 최고 주사율
function DispList() {
  $res = @()
  for ($i = 0; $i -lt 16; $i++) {
    $dd = [OFBDisp]::NewDevice()
    # PowerShell 은 $null 문자열 인자를 "" 로 바꾸므로 진짜 null 을 넘긴다
    if (-not [OFBDisp]::EnumDisplayDevices([NullString]::Value, $i, [ref]$dd, 0)) { break }
    if (($dd.StateFlags -band 1) -eq 0) { continue }
    $cur = [OFBDisp]::NewMode()
    if (-not [OFBDisp]::EnumDisplaySettings($dd.DeviceName, -1, [ref]$cur)) { continue }
    $max = $cur.dmDisplayFrequency
    for ($m = 0; $m -lt 2000; $m++) {
      $dm = [OFBDisp]::NewMode()
      if (-not [OFBDisp]::EnumDisplaySettings($dd.DeviceName, $m, [ref]$dm)) { break }
      if ($dm.dmPelsWidth -eq $cur.dmPelsWidth -and $dm.dmPelsHeight -eq $cur.dmPelsHeight -and $dm.dmBitsPerPel -eq $cur.dmBitsPerPel -and $dm.dmDisplayFrequency -gt $max) { $max = $dm.dmDisplayFrequency }
    }
    $res += ,@{ device = $dd.DeviceName; name = $dd.DeviceString; width = $cur.dmPelsWidth; height = $cur.dmPelsHeight; current = $cur.dmDisplayFrequency; max = $max }
  }
  return $res
}

function DispSet($device, $hz) {
  $dm = [OFBDisp]::NewMode()
  if (-not [OFBDisp]::EnumDisplaySettings($device, -1, [ref]$dm)) { throw ('모니터를 찾을 수 없습니다: ' + $device) }
  $dm.dmDisplayFrequency = [int]$hz
  $dm.dmFields = 0x400000  # DM_DISPLAYFREQUENCY
  $r = [OFBDisp]::ChangeDisplaySettingsEx($device, [ref]$dm, [IntPtr]::Zero, 1, [IntPtr]::Zero)  # CDS_UPDATEREGISTRY
  if ($r -ne 0) { throw ('주사율 변경 실패 (코드 ' + $r + ')') }
}
`;

const DISPLAY_LIST = DISPLAY_LIB + String.raw`
Emit @{ list = @(DispList) }
`;

// $A.items: [{ device, hz }]
const DISPLAY_SET = DISPLAY_LIB + String.raw`
$out = @()
foreach ($it in @($A.items)) {
  try { DispSet $it.device $it.hz; $out += ,@{ device = $it.device; ok = $true } } catch { $out += ,@{ device = $it.device; ok = $false; err = $_.Exception.Message } }
}
Emit @{ results = $out }
`;

module.exports = { DISPLAY_LIST, DISPLAY_SET };
