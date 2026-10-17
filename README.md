# Oreum FPS Booster v2.0.0

Windows 게임 FPS·입력 지연 최적화 프로그램 (Electron). 모든 변경은 자동 백업되고 항목별/전체 되돌리기가 가능합니다.

## 실행 방법
1. Node.js LTS 설치 (https://nodejs.org) — 이미 설치돼 있으면 생략
2. `실행.bat` 더블클릭 → 처음 한 번은 자동으로 `npm install` 진행
3. 상단에 "관리자 권한이 아닙니다"가 뜨면 **관리자로 다시 실행** 클릭

## exe 만들기
`빌드.bat` 실행 → `dist` 폴더에
- `OreumFPSBooster-2.0.0-portable.exe` (설치 없이 실행)
- `OreumFPSBooster-2.0.0-setup.exe` (설치형)

빌드된 exe 는 실행 시 자동으로 관리자 권한을 요청합니다.

## 기능
| 메뉴 | 내용 |
|---|---|
| 대시보드 | CPU·GPU·메모리·디스크·네트워크 실시간 그래프, 최적화 적용률, 시스템 정보, 최근 작업 |
| 성능 최적화 (41개) | 전원·CPU 10 / 게임·그래픽 9 / 네트워크·입력 7 / 시스템·백그라운드 15. 위험도(안전·주의·위험) 표시, 원클릭은 "권장"만 적용 |
| 스마트 파일 청소 (22개) | Windows 임시파일·업데이트 잔여물·로그·덤프, Chrome/Edge/웨일/Firefox/Opera 캐시, Steam/Epic/Battle.net/Riot/Discord, 셰이더 캐시(선택), 휴지통. 드라이브 사용량 표시 |
| 정밀 시스템 검사 | 시스템·메모리/디스크·그래픽/게임·보안·네트워크 약 25개 항목 → 정상/주의/위험 + 해결 버튼, SFC·DISM 무결성 검사 |
| 시작 프로그램 | 자동 실행 켜기/끄기 (작업 관리자와 같은 방식) |
| 기본 앱 제거 | 뉴스·날씨·Clipchamp·Teams·Candy Crush 등 40여 종 중 설치된 것만 표시 |
| Windows 개인화 (9개) | 확장명·숨김파일 표시, 갤러리 숨기기, 내 PC로 열기, 클래식 우클릭, 작업표시줄 정렬/버튼, 다크 모드 |
| 백업·복원 | 변경 전 값 자동 저장, 항목별/전체 기본값 복원, 시스템 복원 지점, **설정 유지 감시**(업데이트로 되돌아간 설정 자동 재적용) |
| 작업 기록 | 모든 작업 이력 저장 |

- 게임 파일·메모리는 건드리지 않고 Windows 설정만 바꿉니다.
- 데이터 위치: `%APPDATA%\oreum-fps-booster\` (backup.json, history.json, settings.json, backups\)

## 구조
```
src/main.js      메인 프로세스, IPC, 적용/복원 로직
src/ps.js        PowerShell 실행기 + 레지스트리/서비스/전원 함수
src/tweaks.js    최적화 항목 정의 (여기에 항목 추가)
src/cleaner.js   파일 청소 항목·스크립트
src/checks.js    시스템 검사 스크립트
src/bloat.js     기본 앱 목록·제거
src/monitor.js   실시간 성능 모니터
src/preload.js   렌더러 ↔ 메인 안전 브리지
src/renderer/    UI (index.html, style.css, app.js)
```

### 항목 추가 예시 (`src/tweaks.js`)
```js
{
  id: 'myTweak', cat: 'power', recommended: false, risk: 'low',
  name: '이름', desc: '설명',
  ops: [reg(HKCU + '\\경로', '값이름', 'DWord', 1), svc('서비스명', 4)],
}
```
