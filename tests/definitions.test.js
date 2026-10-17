// 항목 정의(최적화·청소·기본 앱·시작 프로그램)의 형식과 안전 규칙 검사
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES, TWEAKS, ACTIONS } = require('../src/tweaks');
const { CLEAN_GROUPS, CLEAN_ITEMS } = require('../src/cleaner');
const { BLOAT } = require('../src/bloat');
const { STARTUP_SRCS } = require('../src/startup');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['DWord', 'QWord', 'String', 'ExpandString', 'Binary', 'MultiString'];

test('최적화 항목: id 중복 없음, 카테고리·위험도 유효', () => {
  const ids = TWEAKS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, '중복 id');
  const cats = CATEGORIES.map((c) => c.id);
  for (const t of TWEAKS) {
    assert.ok(cats.includes(t.cat), `${t.id}: 카테고리 ${t.cat}`);
    assert.ok(['low', 'mid', 'high'].includes(t.risk), `${t.id}: risk`);
    assert.ok(t.name && t.desc, `${t.id}: 이름/설명`);
    assert.ok(t.ops.length > 0 || t.dynamic, `${t.id}: ops 없음`);
  }
});

test('원클릭(권장) 항목은 모두 "안전" 등급이어야 함', () => {
  for (const t of TWEAKS.filter((x) => x.recommended)) assert.equal(t.risk, 'low', t.id);
});

test('연산 형식 검사', () => {
  for (const t of TWEAKS) {
    for (const o of t.ops) {
      const where = `${t.id}/${o.t}`;
      switch (o.t) {
        case 'reg':
          assert.match(o.path, /^Registry::HKEY_(LOCAL_MACHINE|CURRENT_USER)\\/, where);
          assert.ok(o.name, where);
          assert.ok(KINDS.includes(o.kind), where + ' kind');
          if (o.kind === 'DWord') assert.ok(Number.isInteger(o.value) && o.value >= 0 && o.value <= 0xffffffff, where + ' DWord 범위');
          if (o.kind === 'Binary') assert.ok(Buffer.from(o.value, 'base64').length > 0, where + ' base64');
          break;
        case 'svc':
          assert.ok(o.name && [2, 3, 4].includes(o.start), where);
          break;
        case 'pcfg':
          assert.match(o.sub, GUID, where);
          assert.match(o.set, GUID, where);
          assert.ok(Number.isInteger(o.value), where);
          break;
        case 'key':
          assert.ok(o.path.startsWith(o.root + '\\'), where + ' path 는 root 하위여야 함');
          break;
        case 'power':
          break;
        default:
          assert.fail('알 수 없는 연산 ' + where);
      }
    }
  }
});

test('전원 계획 항목이 전원 세부 설정(pcfg)보다 먼저 정의됨 (적용 순서 보장)', () => {
  const first = TWEAKS.findIndex((t) => t.ops.some((o) => o.t === 'pcfg'));
  assert.ok(TWEAKS.findIndex((t) => t.id === 'powerplan') < first);
});

test('작업(ACTIONS) id 중복 없음', () => {
  const ids = ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('청소 항목: 그룹 유효, 위험 경로 없음', () => {
  const groups = CLEAN_GROUPS.map((g) => g.id);
  const ids = CLEAN_ITEMS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CLEAN_ITEMS) {
    assert.ok(groups.includes(c.group), c.id);
    if (c.special) continue;
    assert.ok(c.paths.length, c.id);
    for (const p of c.paths) {
      // 루트 폴더·사용자 폴더 전체를 지우는 패턴 금지
      assert.ok(/^%[A-Za-z]+%\\.+/.test(p), `${c.id}: ${p} 는 환경변수로 시작하는 하위 경로여야 함`);
      assert.ok(!/^%(SystemDrive|WINDIR|USERPROFILE|LOCALAPPDATA|APPDATA|ProgramData)%\\\*$/i.test(p), `${c.id}: ${p} 너무 넓음`);
      assert.ok(!/\.\./.test(p), `${c.id}: 상위 경로 금지`);
    }
  }
});

test('기본 앱 목록에 필수 앱이 들어가지 않음', () => {
  const essential = ['Microsoft.WindowsStore', 'Microsoft.Windows.Photos', 'Microsoft.WindowsCalculator', 'Microsoft.WindowsNotepad', 'Microsoft.WindowsTerminal', 'Microsoft.XboxIdentityProvider', 'Microsoft.XboxGamingOverlay', 'Microsoft.DesktopAppInstaller', 'Microsoft.VCLibs.140.00'];
  const like = (name, pattern) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(name);
  for (const e of essential) for (const b of BLOAT) assert.ok(!like(e, b.pattern), `${b.pattern} 가 ${e} 와 일치`);
});

test('시작 프로그램 위치: src 고유, 승인 키는 StartupApproved 하위', () => {
  const srcs = STARTUP_SRCS.map((s) => s.src);
  assert.equal(new Set(srcs).size, srcs.length);
  for (const s of STARTUP_SRCS) {
    assert.ok(s.run || s.dir, s.src);
    assert.match(s.ap, /\\Explorer\\StartupApproved\\(Run|Run32|StartupFolder)$/, s.src);
    assert.ok(s.label, s.src);
  }
});
