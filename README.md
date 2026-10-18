# Oreum FPS Booster v2.1.1

Windows 게임 FPS·입력 지연 최적화 프로그램 (Electron). 모든 변경은 자동 백업되고 항목별/전체 되돌리기가 가능합니다.

## 실행 방법
1. Node.js LTS 설치 (https://nodejs.org) — 이미 설치돼 있으면 생략
2. `실행.bat` 더블클릭 → 처음 한 번은 자동으로 `npm install` 진행
3. 상단에 "관리자 권한이 아닙니다"가 뜨면 **관리자로 다시 실행** 클릭

## exe 만들기
`빌드.bat` 실행 → `dist` 폴더에
- `OreumFPSBooster-2.1.1-portable.exe` (설치 없이 실행)
- `OreumFPSBooster-2.1.1-setup.exe` (설치형)

빌드된 exe 는 실행 시 자동으로 관리자 권한을 요청합니다.

## 새 버전 배포 (자동 업데이트)
앱은 GitHub Releases(`package.json` 의 `build.publish`: `nextvision-1/oreum-fps-booster`)에서 새 버전을 확인합니다.
1. `package.json` 의 `version` 을 올립니다 (예: 2.1.1 → 2.1.2)
2. GitHub 개인 액세스 토큰(repo 권한)을 환경 변수로 지정하고 배포
   ```
   set GH_TOKEN=ghp_...
   npm run release
   ```
   → exe 와 `latest.yml` 이 GitHub Release(초안 아님)로 올라갑니다.
3. 설치형 사용자는 앱에서 "새 버전" 알림 → **업데이트** → **다시 시작해 설치**. 포터블 사용자는 다운로드 페이지가 열립니다.

- 앱은 시작 15초 뒤와 6시간마다 확인합니다 (백업·복원 메뉴에서 끌 수 있음). 내려받기·설치는 사용자가 눌렀을 때만 합니다.
- 내려받은 파일은 `latest.yml` 의 SHA-512 로 검증합니다. 코드 서명 인증서를 적용하면 `build.win.publisherName` 을 지정해 서명까지 검증하는 것을 권장합니다.

## 자가진단 (실제 PC 검증)
`OreumFPSBooster-...-portable.exe` 와 `자가진단.bat` 을 같은 폴더에 두고 `자가진단.bat` 실행 (빌드.bat 이 dist 에 함께 복사).
- 복원 지점을 만든 뒤 최적화를 모두 적용 → 상태 확인 → 모두 되돌리기 → **원래 값과 항목별로 비교**. 이미 적용해 둔 항목은 건드리지 않습니다.
- 시스템 검사, 청소 스캔(삭제 없음), PresentMon 서명, 업데이트 확인, 시스템 벤치마크도 실행합니다.
- 결과는 바탕화면 `OreumFPSBooster-자가진단-날짜.txt` (시작 전 원래 값은 `...-원래값.json`). 적용 왕복을 빼려면 `--self-test --no-apply`.

## 기능
| 메뉴 | 내용 |
|---|---|
| 대시보드 | CPU·GPU·메모리·디스크·네트워크 실시간 그래프, 최적화 적용률, 시스템 정보, 최근 작업 |
| 전/후 성능 비교 | 시스템 벤치마크(그래픽 FPS·1% Low, CPU 싱글/멀티, 끊김, 대기 CPU·메모리, 핑) + 게임 FPS 측정(Intel PresentMon: 평균·1%·0.1% Low, 프레임 시간 그래프). 원클릭 최적화 시 전·후 자동 측정 |
| 성능 최적화 (41개) | 전원·CPU 10 / 게임·그래픽 9 / 네트워크·입력 7 / 시스템·백그라운드 15. 위험도(안전·주의·위험) 표시, 원클릭은 "권장"만 적용 |
| 스마트 파일 청소 (47개) | Windows 임시파일·업데이트 잔여물·로그·덤프·진단 로그, 사용 기록(선택), Chrome/Edge/웨일/Brave/Vivaldi/Firefox/Opera(GX) 캐시, Steam/Epic/Battle.net/Riot/EA/Ubisoft/GOG/Minecraft/Roblox/OBS, Discord/Teams/Slack/Zoom/VS Code, 셰이더 캐시(선택), 휴지통. 드라이브 사용량 표시 |
| 정밀 시스템 검사 (약 55개) | 시스템·안정성(블루스크린·비정상 종료·그래픽 드라이버 멈춤·WHEA·디스크 오류·앱 충돌)·메모리/디스크(듀얼 채널·XMP·TRIM)·그래픽/게임(VRAM·노트북 전원·VBS)·백그라운드(CPU·메모리 점유, 오버레이)·보안(TPM·SMBv1·원격 데스크톱)·네트워크(패킷 손실·DNS·Wi-Fi 신호·링크 속도) → 정상/주의/위험 + 해결 버튼, SFC·DISM 무결성 검사 |
| 시작 프로그램 | 레지스트리 Run 키 + 시작 폴더의 자동 실행 켜기/끄기 (작업 관리자와 같은 방식) |
| 기본 앱 제거 | 뉴스·날씨·Clipchamp·Teams·Candy Crush 등 40여 종 중 설치된 것만 표시 |
| Windows 개인화 (9개) | 확장명·숨김파일 표시, 갤러리 숨기기, 내 PC로 열기, 클래식 우클릭, 작업표시줄 정렬/버튼, 다크 모드 |
| 백업·복원 | 변경 전 값 자동 저장, 항목별/전체 기본값 복원, 시스템 복원 지점, **설정 유지 감시**(업데이트로 되돌아간 설정 자동 재적용. 재적용해도 안 되는 항목은 반복하지 않음, 성능 측정 중에는 쉼) |
| 작업 기록 | 모든 작업 이력 저장 |
| 자동 업데이트 | GitHub Releases 에서 새 버전 확인·알림, 설치형은 내려받아 다시 시작해 설치, 포터블은 다운로드 페이지 안내 |

- 게임 파일·메모리는 건드리지 않고 Windows 설정만 바꿉니다.
- 데이터 위치: `%APPDATA%\oreum-fps-booster\` (backup.json, history.json, settings.json, bench.json, backups\)
- PresentMon.exe 는 실행 전에 Intel 디지털 서명을 확인하고, 서명이 없거나 바뀐 파일은 실행하지 않습니다.

## 테스트
```
npm test        단위 테스트 + 항목 정의 검사 + PowerShell 문법/통합 테스트 (약 1~2분)
npm run smoke   앱 창을 띄워 모든 페이지를 열어 보고 오류 없이 뜨는지 확인 후 자동 종료
```
- 통합 테스트는 시스템 설정을 바꾸지 않습니다. 레지스트리 쓰기는 `HKCU\Software\OreumFPSBoosterTest` 안에서만 하고 끝나면 지우며, 파일 청소는 임시 폴더로만 시험합니다.
- 스모크 테스트는 임시 데이터 폴더를 쓰고 설정 유지 감시를 돌리지 않습니다.

## 구조
```
src/main.js      메인 프로세스, IPC, 적용/복원 로직
src/ps.js        PowerShell 실행기 + 레지스트리/서비스/전원 함수 + 적용·읽기·복원 스크립트
src/logic.js     상태 판정·감시 대상 선정 등 순수 로직 (테스트 대상)
src/tweaks.js    최적화 항목 정의 (여기에 항목 추가)
src/cleaner.js   파일 청소 항목·스크립트
src/checks.js    시스템 검사 스크립트
src/bloat.js     기본 앱 목록·제거
src/startup.js   시작 프로그램 위치·조회/변경 스크립트
src/monitor.js   실시간 성능 모니터
src/bench.js     전/후 비교 벤치마크·PresentMon 게임 FPS
src/bench-stats.js  PresentMon CSV 해석·프레임 통계 (테스트 대상)
src/updater.js   자동 업데이트 (electron-updater, GitHub Releases)
src/selftest.js  자가진단 모드 (--self-test)
src/renderer/gpu-bench.js  그래픽 테스트(WebGL2 고정 장면)
tools/           PresentMon.exe (빌드.bat 이 자동 다운로드)
src/preload.js   렌더러 ↔ 메인 안전 브리지
src/renderer/    UI (index.html, style.css, app.js)
tests/           node --test 테스트
```

> PowerShell 함수 이름을 새로 만들 때 `rd`, `sc`, `gp` 같은 내장 별칭과 겹치지 않게 하세요. 별칭이 함수보다 먼저 실행됩니다. (`npm test` 가 검사합니다)

### 항목 추가 예시 (`src/tweaks.js`)
```js
{
  id: 'myTweak', cat: 'power', recommended: false, risk: 'low',
  name: '이름', desc: '설명',
  ops: [reg(HKCU + '\\경로', '값이름', 'DWord', 1), svc('서비스명', 4)],
}
```
