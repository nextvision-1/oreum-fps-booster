// 게임 프로필: 게임 실행 파일마다 게임용(고성능) GPU 지정 + CPU 우선순위 "높음"
// - GPU: Windows 설정 > 그래픽과 같은 값 (HKCU\...\DirectX\UserGpuPreferences, 값 이름 = exe 전체 경로)
// - CPU: Image File Execution Options\<exe 이름>\PerfOptions\CpuPriorityClass = 3 (높음)
// 변경 전 값은 backup.json 의 profiles 에 저장하고, 제거하면 원래대로 되돌린다.
const path = require('path');

const IFEO = 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options';
const GPUPREF = 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\DirectX\\UserGpuPreferences';

// 우선순위를 바꾸면 안 되는 Windows·보안 프로그램
const BLOCKED = new Set(['svchost.exe', 'explorer.exe', 'csrss.exe', 'lsass.exe', 'winlogon.exe', 'services.exe', 'smss.exe', 'wininit.exe', 'dwm.exe',
  'system', 'audiodg.exe', 'conhost.exe', 'msmpeng.exe', 'powershell.exe', 'cmd.exe', 'taskmgr.exe', 'oreum fps booster.exe']);

function profileOps(exePath) {
  const exe = path.win32.basename(exePath);
  return [
    { t: 'reg', path: GPUPREF, name: exePath, kind: 'String', value: 'GpuPreference=2;' },
    // cleanup 2: 되돌릴 때 비게 된 PerfOptions·<exe> 키까지 지운다
    { t: 'reg', path: `${IFEO}\\${exe}\\PerfOptions`, name: 'CpuPriorityClass', kind: 'DWord', value: 3, cleanup: 2 },
  ];
}

// 추가할 수 있는 exe 인지 확인. 문제가 있으면 이유(문자열), 없으면 null
function validateExe(exePath, profiles) {
  if (!/\.exe$/i.test(exePath || '')) return '실행 파일(.exe)만 추가할 수 있습니다.';
  const exe = path.win32.basename(exePath).toLowerCase();
  if (BLOCKED.has(exe)) return `${exe} 는 Windows·보안 프로그램이라 우선순위를 바꿀 수 없습니다.`;
  const win = (process.env.WINDIR || 'C:\\Windows').toLowerCase() + '\\';
  if (exePath.toLowerCase().startsWith(win)) return 'Windows 폴더의 프로그램은 추가할 수 없습니다.';
  // CPU 우선순위는 exe 이름 단위로 적용되므로 같은 이름의 다른 경로는 받지 않는다
  const same = Object.keys(profiles || {}).find((p) => path.win32.basename(p).toLowerCase() === exe);
  if (same) return same.toLowerCase() === exePath.toLowerCase() ? '이미 추가된 게임입니다.' : `같은 이름의 게임이 이미 있습니다: ${same}`;
  return null;
}

module.exports = { profileOps, validateExe, IFEO, GPUPREF };
