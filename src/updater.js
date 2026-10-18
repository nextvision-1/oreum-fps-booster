// 자동 업데이트 (GitHub Releases, electron-updater)
// - 설치형(NSIS): 새 버전 확인 → 사용자가 누르면 내려받기 → 다시 시작해 설치
// - 포터블: 스스로 교체할 수 없으므로 새 버전 알림 + 다운로드 페이지 열기
// - 개발 모드(npm start): 확인하지 않음. 단, 테스트용으로 OFB_UPDATE_CONFIG 에 dev-app-update.yml 경로를 주면 그 설정으로 확인
const { app, shell } = require('electron');
const pkg = require('../package.json');

const PUBLISH = [].concat(pkg.build?.publish || [])[0] || {};
const RELEASES_URL = PUBLISH.owner && PUBLISH.repo ? `https://github.com/${PUBLISH.owner}/${PUBLISH.repo}/releases/latest` : null;
const PORTABLE = !!process.env.PORTABLE_EXECUTABLE_FILE;

let autoUpdater = null;
let send = () => {};
// status: idle | checking | none | available | downloading | ready | error | unsupported
let state = { status: 'idle', current: app.getVersion(), portable: PORTABLE };

function setState(patch) {
  state = { ...state, ...patch };
  send(state);
}

function init(onState) {
  send = onState;
  const testConfig = !app.isPackaged && process.env.OFB_UPDATE_CONFIG;
  if (!app.isPackaged && !testConfig) return setState({ status: 'unsupported', error: '개발 모드에서는 업데이트를 확인하지 않습니다.' });
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    return setState({ status: 'unsupported', error: '업데이트 모듈을 불러오지 못했습니다: ' + e.message });
  }
  if (testConfig) { autoUpdater.forceDevUpdateConfig = true; autoUpdater.updateConfigPath = testConfig; }
  autoUpdater.autoDownload = false; // 사용자가 [업데이트]를 눌렀을 때만 내려받는다
  autoUpdater.autoInstallOnAppQuit = !PORTABLE; // 내려받아 둔 업데이트는 다음 종료 때 설치
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => setState({ status: 'none', checkedAt: new Date().toISOString() }));
  autoUpdater.on('update-available', (info) => setState({ status: 'available', version: info.version, notes: notesText(info.releaseNotes), checkedAt: new Date().toISOString() }));
  autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version, percent: 100 }));
  autoUpdater.on('error', (e) => setState({ status: 'error', error: shortError(e) }));
}

function notesText(n) {
  if (!n) return '';
  const raw = Array.isArray(n) ? n.map((x) => x.note || '').join('\n') : String(n);
  return raw.replace(/<[^>]+>/g, '').trim().slice(0, 1000);
}
const shortError = (e) => {
  const m = String(e?.message || e || '알 수 없는 오류');
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::ERR/i.test(m)) return '업데이트 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.';
  if (/checksum mismatch|sha512/i.test(m)) return '내려받은 업데이트 파일이 손상되었거나 변조되어 설치하지 않습니다. 잠시 뒤 다시 시도하세요.';
  if (/404/.test(m)) return '업데이트 정보를 찾지 못했습니다. (아직 배포된 버전이 없을 수 있습니다)';
  return m.split('\n')[0].slice(0, 200);
};

async function check() {
  if (!autoUpdater) return state;
  if (['checking', 'downloading', 'ready'].includes(state.status)) return state;
  try { await autoUpdater.checkForUpdates(); } catch (e) { setState({ status: 'error', error: shortError(e) }); }
  return state;
}

async function download() {
  if (!autoUpdater || state.status !== 'available') return state;
  if (PORTABLE) { // 포터블은 새 exe 를 직접 받아야 한다
    if (RELEASES_URL) await shell.openExternal(RELEASES_URL);
    return state;
  }
  setState({ status: 'downloading', percent: 0 });
  try { await autoUpdater.downloadUpdate(); } catch (e) { setState({ status: 'error', error: shortError(e) }); }
  return state;
}

function install() {
  if (!autoUpdater || state.status !== 'ready') return false;
  // 설치 프로그램을 띄우고 앱을 종료한 뒤, 설치가 끝나면 다시 실행
  autoUpdater.quitAndInstall(false, true);
  return true;
}

module.exports = { init, check, download, install, getState: () => state, RELEASES_URL };
