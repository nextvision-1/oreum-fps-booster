/* global api */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let META = null;
let STATUS = {};
let busyCount = 0;
let optCat = 'all';
const RISK = { low: '안전', mid: '주의', high: '위험' };
const OPT_CATS = ['power', 'gpu', 'net', 'system'];

// ───────── 공통 ─────────
function log(msg) {
  const t = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  $('#log').textContent = `[${t}] ${msg}\n` + $('#log').textContent;
}
let toastTimer;
function toast(msg, err = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 5500);
  log((err ? '오류: ' : '') + msg);
}
function busy(on, text = '처리 중…') {
  busyCount += on ? 1 : -1;
  $('#busyText').textContent = text;
  $('#busy').classList.toggle('hidden', busyCount <= 0);
}
async function call(ch, ...args) {
  const r = await api.call(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
// 성능 측정 중에는 스피너를 멈춘다. 그래픽 테스트를 위해 프레임 제한을 풀어 두었기 때문에
// 애니메이션이 초당 수천 번 다시 그려져 측정 중인 게임과 GPU 를 나눠 쓰게 된다.
async function withBenchBusy(text, fn) {
  document.body.classList.add('benching');
  try { return await withBusy(text, fn); } finally { document.body.classList.remove('benching'); }
}
async function withBusy(text, fn) {
  busy(true, text);
  try { return await fn(); }
  catch (e) { toast(e.message, true); }
  finally { busy(false); }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtBytes(b) {
  b = Number(b) || 0;
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}
const fmtTime = (iso) => new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

// ───────── 네비게이션 ─────────
function goto(page) {
  $$('#nav button').forEach((x) => x.classList.toggle('active', x.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('hidden', p.id !== 'page-' + page));
  $('main').scrollTop = 0;
  if (page === 'startup') loadStartup();
  if (page === 'backup') loadBackup();
  if (page === 'bloat') loadBloat();
  if (page === 'cleaner') loadDrives();
  if (page === 'history') loadHistory();
  if (page === 'bench') loadBench();
  if (page === 'optimize') loadProfiles();
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-page]');
  if (b) goto(b.dataset.page);
});

// ───────── 최적화 항목 ─────────
function tweakCard(t) {
  const el = document.createElement('div');
  el.className = 'card item';
  el.dataset.id = t.id;
  const badges = [
    t.recommended ? '<span class="badge rec">권장</span>' : '',
    t.risk !== 'low' ? `<span class="badge">${RISK[t.risk]}</span>` : '',
    t.reboot ? '<span class="badge">재부팅 필요</span>' : '',
    t.relogin ? '<span class="badge">재로그인 필요</span>' : '',
    '<span class="badge st"></span>',
  ].join('');
  el.innerHTML = `
    <div class="body">
      <div class="title"><span class="r ${t.risk}" title="${RISK[t.risk]}"></span>${esc(t.name)} ${badges}</div>
      <div class="desc">${esc(t.desc)}</div>
    </div>
    <label class="switch"><input type="checkbox" /><span class="slider"></span></label>`;
  $('input', el).addEventListener('change', (e) => toggleTweak(t, e.target.checked, e.target));
  return el;
}

function actionCard(a) {
  const el = document.createElement('div');
  el.className = 'card quick';
  el.innerHTML = `<div class="q-title">${esc(a.name)}</div><div class="muted">${esc(a.desc)}</div><button class="btn small" data-action="${a.id}">실행</button>`;
  return el;
}

function renderChips() {
  const box = $('#catChips');
  const cats = [{ id: 'all', name: '전체', icon: '' }, ...META.categories.filter((c) => OPT_CATS.includes(c.id))];
  box.innerHTML = cats.map((c) => {
    const n = META.tweaks.filter((t) => (c.id === 'all' ? OPT_CATS.includes(t.cat) : t.cat === c.id)).length;
    return `<button class="chip ${c.id === optCat ? 'active' : ''}" data-cat="${c.id}">${c.icon} ${esc(c.name)}<b>${n}</b></button>`;
  }).join('');
}
$('#catChips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  optCat = b.dataset.cat;
  renderChips();
  renderOptimize();
});

function renderOptimize() {
  const list = $('#optList');
  list.innerHTML = '';
  META.tweaks
    .filter((t) => (optCat === 'all' ? OPT_CATS.includes(t.cat) : t.cat === optCat))
    .forEach((t) => list.appendChild(tweakCard(t)));
  const acts = $('#optActions');
  acts.innerHTML = '';
  META.actions.filter((a) => (optCat === 'all' ? ['net', 'system'] : [optCat]).includes(a.cat)).forEach((a) => acts.appendChild(actionCard(a)));
  paintStatus();
}

function renderStatic() {
  renderChips();
  renderOptimize();
  const pl = $('#personalList');
  pl.innerHTML = '';
  META.tweaks.filter((t) => t.cat === 'personal').forEach((t) => pl.appendChild(tweakCard(t)));
  const pa = $('#personalActions');
  pa.innerHTML = '';
  META.actions.filter((a) => a.cat === 'personal').forEach((a) => pa.appendChild(actionCard(a)));
  const ca = $('#checkActions');
  ca.innerHTML = '';
  META.actions.filter((a) => a.cat === 'check').forEach((a) => ca.appendChild(actionCard(a)));
}

function paintStatus() {
  let on = 0, total = 0;
  for (const t of META.tweaks) {
    const s = STATUS[t.id] || { status: 'off' };
    for (const card of $$(`.item[data-id="${t.id}"]`)) {
      $('input', card).checked = s.status === 'on' || s.status === 'partial';
      $('input', card).disabled = s.status === 'na';
      const b = $('.badge.st', card);
      b.className = 'badge st ' + (s.status === 'on' ? 'on' : s.status === 'partial' ? 'partial' : '');
      b.textContent = s.status === 'on' ? '적용됨' : s.status === 'partial' ? '일부 적용' : s.status === 'na' ? '해당 없음' : '미적용';
    }
    if (t.recommended && s.status !== 'na') {
      total++;
      if (s.status === 'on') on++;
    }
  }
  const pct = total ? Math.round((on / total) * 100) : 0;
  $('#ring').style.setProperty('--p', pct);
  $('#scoreNum').textContent = pct;
  LAST_PCT = pct;
  paintHealth();
  $('#scoreText').textContent = pct >= 100
    ? `권장 최적화 ${total}개가 모두 적용되어 있습니다.`
    : `권장 최적화 ${total}개 중 ${on}개 적용됨 — 원클릭으로 나머지를 적용하세요.`;
}

async function refreshStatus() {
  try {
    STATUS = await call('status');
    paintStatus();
  } catch (e) {
    toast('상태 확인 실패: ' + e.message, true);
  }
}

function afterApply(res) {
  res.errors?.forEach((x) => log('  ✖ ' + x));
  if (res.reboot) $('#rebootBar').classList.remove('hidden');
  if (res.explorer) $('#explorerBar').classList.remove('hidden');
}

async function toggleTweak(t, checked, input) {
  if (checked) {
    if (t.risk !== 'low' && !(await call('confirm', `[${RISK[t.risk]}] ${t.name}\n\n${t.desc}\n\n적용할까요? (언제든 되돌릴 수 있습니다)`))) {
      input.checked = false;
      return;
    }
    await withBusy(`${t.name} 적용 중…`, async () => {
      const r = await call('apply', [t.id]);
      afterApply(r);
      if (r.errors?.length) toast(`${t.name}: 일부 실패 — ${r.errors[0]}`, true);
      else toast(`✔ ${t.name} 적용 완료`);
    });
  } else {
    if (!STATUS[t.id]?.backedUp) {
      toast(`"${t.name}"은(는) 이 프로그램으로 적용한 기록이 없어 원래 값을 알 수 없습니다. 되돌릴 수 없습니다.`, true);
      input.checked = true;
      return;
    }
    await withBusy(`${t.name} 되돌리는 중…`, async () => {
      const r = await call('revert', [t.id]);
      if (r.errors?.length) toast('되돌리기 중 일부 오류: ' + r.errors[0], true);
      else toast(`↩ ${t.name} 원래대로 복원`);
      if (t.reboot || t.relogin) $('#rebootBar').classList.remove('hidden');
      if (t.explorer) $('#explorerBar').classList.remove('hidden');
    });
  }
  await refreshStatus();
}

// ───────── 모니터 최대 주사율 ─────────
// 확인 창과 15초 자동 복구는 메인 프로세스가 처리한다 (화면이 안 나와도 되돌아가도록)
async function maxRefresh() {
  const r = await withBusy('모니터 주사율 확인 중…', () => call('display:max'));
  if (!r) return false;
  if (r.errors?.length) toast('일부 모니터 변경 실패: ' + r.errors[0], true);
  if (!r.changed.length) { if (!r.errors?.length) toast('모든 모니터가 이미 지원하는 최고 주사율입니다.'); return true; }
  const desc = r.changed.map((d) => `${d.current}→${d.max}Hz`).join(', ');
  if (r.kept) toast(`🖥 모니터 주사율을 바꿨습니다 (${desc})`);
  else toast(r.timedOut ? '확인이 없어 원래 주사율로 되돌렸습니다.' : '원래 주사율로 되돌렸습니다.');
  return true;
}

// ───────── 게임 프로필 ─────────
async function loadProfiles() {
  const box = $('#profileList');
  try {
    const list = await call('profile:list');
    box.innerHTML = list.length ? '' : '<div class="empty">추가한 게임이 없습니다. "게임 추가"로 게임 실행 파일(.exe)을 고르세요.</div>';
    for (const p of list) {
      const el = document.createElement('div');
      el.className = 'card item';
      const st = p.status === 'on' ? '<span class="badge st on">적용됨</span>' : '<span class="badge st partial">일부 적용</span>';
      el.innerHTML = `<div class="body"><div class="title">${esc(p.name)} ${st}${p.exists ? '' : ' <span class="badge">파일 없음</span>'}</div><div class="cmd" title="${esc(p.path)}">${esc(p.path)}</div></div><button class="btn small ghost">제거</button>`;
      $('button', el).addEventListener('click', async () => {
        await withBusy('게임 프로필 제거 중…', async () => {
          const r = await call('profile:remove', p.path);
          toast(r.errors.length ? '일부 오류: ' + r.errors[0] : `↩ ${p.name} 프로필을 제거했습니다.`, r.errors.length > 0);
        });
        loadProfiles();
      });
      box.appendChild(el);
    }
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$('#btnProfileAdd').addEventListener('click', async () => {
  try {
    const r = await call('profile:add');
    if (!r) return; // 선택 취소
    toast(r.errors.length ? '일부 적용 실패 (관리자 권한 필요): ' + r.errors[0] : `🎮 ${r.path.split('\\').pop()} — 고성능 GPU · CPU 우선순위 높음 적용 (게임을 다시 켜면 반영)`, r.errors.length > 0);
  } catch (e) { toast(e.message, true); }
  loadProfiles();
});

// ───────── 원클릭 / 전체 복원 ─────────
async function runAction(id, silent = false) {
  if (id === 'maxRefresh') return maxRefresh();
  const a = META.actions.find((x) => x.id === id);
  const long = id === 'sfc' || id === 'dism';
  return withBusy(`${a?.name || id} 실행 중…${long ? '\n(오래 걸릴 수 있습니다. 창을 닫지 마세요)' : ''}`, async () => {
    const r = await call('action', id);
    if (!silent) toast(r.msg || '완료');
    else log(r.msg || '완료');
    if (r.reboot) $('#rebootBar').classList.remove('hidden');
    return true;
  });
}

// mode: 'recommended' (권장 항목만) | 'nohigh' (성능 항목 중 위험 등급 제외 전체)
async function boost(mode = 'recommended') {
  const pick = mode === 'nohigh' ? (t) => OPT_CATS.includes(t.cat) && t.risk !== 'high' : (t) => t.recommended;
  const ids = META.tweaks.filter((t) => pick(t) && STATUS[t.id]?.status !== 'on' && STATUS[t.id]?.status !== 'na').map((t) => t.id);
  if (!ids.length) return toast(mode === 'nohigh' ? '위험 등급을 뺀 최적화가 이미 모두 적용되어 있습니다.' : '권장 최적화가 이미 모두 적용되어 있습니다.');
  const names = META.tweaks.filter((t) => ids.includes(t.id)).map((t) => '• ' + t.name + (t.risk === 'mid' ? '  [주의]' : '')).join('\n');
  if (!(await call('confirm', `다음 ${ids.length}개 항목을 적용합니다.\n\n${names}\n\n변경 전 값은 자동 백업됩니다.`))) return;
  if ($('#chkRP').checked) {
    const ok = await runAction('restorePoint', true);
    if (!ok && !(await call('confirm', '복원 지점을 만들지 못했습니다. (시스템 보호가 꺼져 있거나 최근에 이미 생성됨)\n그래도 계속할까요?'))) return;
  }
  const measure = $('#chkBench').checked;
  let before = null;
  if (measure) before = await runSystemBench('최적화 전', true);
  const applied = await withBusy(`최적화 ${ids.length}개 적용 중…`, async () => {
    const r = await call('apply', ids);
    afterApply(r);
    toast(`🚀 ${r.applied.length}개 최적화 적용 완료${r.errors.length ? `\n(일부 값 실패 ${r.errors.length}건 — 작업 기록의 로그 확인)` : ''}`, r.errors.length > 0);
    return r;
  });
  await refreshStatus();
  if (measure && before && applied) {
    await new Promise((res) => setTimeout(res, 3000)); // 설정이 자리 잡을 시간
    const after = await runSystemBench('최적화 후', true);
    if (after) {
      cmpKind = 'system';
      cmpSel = { a: before.id, b: after.id };
      goto('bench');
      if (applied.reboot) toast('재부팅이 필요한 항목이 있습니다. 재부팅 후 "재부팅 후"로 한 번 더 측정하면 효과가 더 정확히 나옵니다.');
    }
  }
}
$('#btnBoost').addEventListener('click', () => boost('recommended'));
$('#btnBoost2').addEventListener('click', () => boost('recommended'));
$('#btnBoostNoHigh').addEventListener('click', () => boost('nohigh'));

// 적용된 "위험" 등급 항목만 되돌리기 (메모리 무결성 끄기 등)
$('#btnRevertHigh').addEventListener('click', async () => {
  const ids = META.tweaks.filter((t) => t.risk === 'high' && STATUS[t.id]?.backedUp).map((t) => t.id);
  if (!ids.length) return toast('이 프로그램으로 적용한 위험 등급 항목이 없습니다.');
  const names = META.tweaks.filter((t) => ids.includes(t.id)).map((t) => '• ' + t.name).join('\n');
  if (!(await call('confirm', `다음 위험 등급 항목을 원래대로 되돌립니다.\n\n${names}`))) return;
  await withBusy('위험 항목 되돌리는 중…', async () => {
    const r = await call('revert', ids);
    toast(r.errors.length ? '일부 오류: ' + r.errors[0] : `↩ 위험 항목 ${r.reverted.length}개를 원래대로 되돌렸습니다.`, r.errors.length > 0);
    if (r.reverted.length) $('#rebootBar').classList.remove('hidden');
  });
  await refreshStatus();
});

async function revertAll() {
  if (!(await call('confirm', '이 프로그램이 변경한 모든 설정을 원래 값으로 되돌릴까요?'))) return;
  await withBusy('전체 복원 중…', async () => {
    const r = await call('revertAll');
    toast(r.reverted.length ? `↩ ${r.reverted.length}개 항목을 원래대로 복원했습니다.` : '되돌릴 항목이 없습니다.', r.errors.length > 0);
    r.errors.forEach((x) => log('  ✖ ' + x));
    if (r.reverted.length) $('#rebootBar').classList.remove('hidden');
  });
  await refreshStatus();
  loadBackup();
}
$('#btnRevertAll').addEventListener('click', revertAll);
$('#btnRevertAll2').addEventListener('click', revertAll);

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a) return runAction(a.dataset.action);
  const g = e.target.closest('[data-goto]');
  if (g) goto(g.dataset.goto);
});

// ───────── 실시간 모니터 ─────────
const HIST_N = 60;
const series = { cpu: [], gpu: [], mem: [], disk: [], net: [], temp: [] };
function push(k, v) {
  series[k].push(v);
  if (series[k].length > HIST_N) series[k].shift();
}
function drawSpark(canvas, data, max) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (data.length < 2) return;
  const step = w / (HIST_N - 1);
  const x0 = w - (data.length - 1) * step;
  const y = (v) => h - 2 - (Math.min(v, max) / max) * (h - 4);
  ctx.beginPath();
  data.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, y(v)) : ctx.moveTo(x0, y(v))));
  const css = getComputedStyle(document.documentElement);
  ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#22e3a0';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineTo(x0 + (data.length - 1) * step, h);
  ctx.lineTo(x0, h);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  const rgb = css.getPropertyValue('--accent-rgb').trim() || '34,227,160';
  g.addColorStop(0, `rgba(${rgb},.25)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fill();
  const hv = canvas._hover;
  if (hv != null && data[hv] != null) {
    const hx = x0 + hv * step;
    ctx.strokeStyle = 'rgba(230,237,245,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke();
    ctx.fillStyle = '#e6edf5';
    ctx.beginPath(); ctx.arc(hx, y(data[hv]), 4, 0, Math.PI * 2); ctx.fill();
  }
}
const netMax = () => Math.max(1048576, ...series.net) * 1.1;
const tileFmt = {
  cpu: (v) => `${v}<small>%</small>`,
  gpu: (v) => `${v}<small>%</small>`,
  mem: (v) => `${v}<small>%</small>`,
  disk: (v) => `${v}<small>%</small>`,
  net: (v) => `${fmtBytes(v)}<small>/s</small>`,
  temp: (v) => `${v}<small>°C</small>`,
};
let lastMem = null;
let lastTemp = null;
function paintTiles() {
  for (const tile of $$('#monitor .tile')) {
    const k = tile.dataset.m;
    const data = series[k];
    const cv = $('canvas', tile);
    const last = data[data.length - 1];
    let vhtml = last == null ? '-' : tileFmt[k](last);
    if (k === 'temp' && lastTemp && last != null) vhtml = [lastTemp.gpu != null ? `GPU ${lastTemp.gpu}°` : '', lastTemp.cpu != null ? `CPU ${lastTemp.cpu}°` : ''].filter(Boolean).join(' · ');
    if (k === 'mem' && lastMem && last != null) vhtml = `${last}<small>% · ${(lastMem.used / 1073741824).toFixed(1)}/${Math.round(lastMem.total / 1073741824)}GB</small>`;
    $('.v', tile).innerHTML = vhtml;
    drawSpark(cv, data, k === 'net' ? netMax() : 100);
    let tip = $('.tip', tile);
    if (cv._hover != null && data[cv._hover] != null) {
      if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tile.appendChild(tip); }
      const secAgo = Math.round((data.length - 1 - cv._hover) * 1.5);
      tip.innerHTML = `${secAgo ? secAgo + '초 전 ' : '지금 '}${tileFmt[k](data[cv._hover]).replace(/<\/?small>/g, '')}`;
    } else if (tip) tip.remove();
  }
}
for (const cv of $$('#monitor canvas')) {
  cv.addEventListener('mousemove', (e) => {
    const k = cv.closest('.tile').dataset.m;
    const n = series[k].length;
    const w = cv.clientWidth, step = w / (HIST_N - 1);
    const x0 = w - (n - 1) * step;
    const i = Math.round((e.offsetX - x0) / step);
    cv._hover = i >= 0 && i < n ? i : null;
    paintTiles();
  });
  cv.addEventListener('mouseleave', () => { cv._hover = null; paintTiles(); });
}
api.on('monitor', (m) => {
  if (m.cpu != null) push('cpu', Math.min(100, m.cpu));
  if (m.gpu != null) push('gpu', m.gpu);
  if (m.memTotal) { lastMem = { used: m.memUsed, total: m.memTotal }; push('mem', Math.round((m.memUsed / m.memTotal) * 100)); }
  if (m.disk != null) push('disk', Math.min(100, m.disk));
  if (m.rx != null) push('net', (m.rx || 0) + (m.tx || 0));
  if (m.gpuTemp != null || m.cpuTemp != null) {
    // 온도 센서가 있는 PC 에서만 타일을 보인다 (그래프는 GPU 온도 우선)
    lastTemp = { gpu: m.gpuTemp ?? null, cpu: m.cpuTemp ?? null };
    push('temp', m.gpuTemp ?? m.cpuTemp);
    $('#monitor .tile[data-m=temp]').classList.remove('hidden');
  }
  if (!$('#page-dash').classList.contains('hidden')) paintTiles();
});
window.addEventListener('resize', paintTiles);

// ───────── 누적 통계 · PC 상태 ─────────
let STATS = null;
let LAST_PCT = null;
function paintStats(st) {
  if (!st) return;
  STATS = st;
  $('#stFreed').textContent = fmtBytes(st.freedBytes);
  $('#stClean').textContent = `파일 청소 ${st.cleanRuns || 0}회 · 중복 정리 포함`;
  $('#stOpt').textContent = (st.optimizeRuns || 0).toLocaleString();
  paintHealth();
}
// 좋음: 적용률 80% 이상 + 최근 검사 위험 0 · 주의 3 이하
// 점검 필요(빨강): 시스템 검사에서 위험 항목이 실제로 나왔을 때만. 검사 전이거나 최적화를 덜 한 것은 "보통"
function paintHealth() {
  const box = $('#stHealth');
  if (!box || LAST_PCT == null || !STATS) return;
  const c = STATS.lastCheck;
  let level = 'ok', txt = '좋음';
  if (c && c.bad > 0) { level = 'bad'; txt = '점검 필요'; }
  else if (!c || c.warn > 3 || LAST_PCT < 80) { level = 'warn'; txt = '보통'; }
  box.className = 'card stat ' + level;
  $('#stHealthTxt').textContent = txt;
  $('#stHealthWhy').textContent = `최적화 적용률 ${LAST_PCT}% · ` + (c ? `마지막 검사 위험 ${c.bad} · 주의 ${c.warn}` : '아직 시스템 검사를 하지 않았습니다');
}
api.on('stats', paintStats);

// ───────── 작업 기록 ─────────
const HIST_ICON = { bench: '📊', optimize: '🚀', restore: '↩', clean: '🧹', check: '🩺', bloat: '🗑', startup: '⏱', action: '⚙', guard: '🛡' };
function histRows(list) {
  if (!list.length) return '<div class="empty">아직 기록이 없습니다.</div>';
  return list.map((h) => `<div class="h"><time>${esc(fmtTime(h.time))}</time><span>${HIST_ICON[h.type] || '•'} ${esc(h.text)}</span></div>`).join('');
}
let HIST = [];
async function loadHistory() {
  try { HIST = await call('history'); } catch (_) { HIST = []; }
  $('#recent').innerHTML = histRows(HIST.slice(0, 5));
  $('#histAll').innerHTML = histRows(HIST);
}
api.on('history', (h) => {
  HIST.unshift(h);
  $('#recent').innerHTML = histRows(HIST.slice(0, 5));
  $('#histAll').innerHTML = histRows(HIST);
});
api.on('guard', (names) => {
  toast(`🛡 Windows가 되돌린 설정 ${names.length}개를 다시 적용했습니다.\n${names.join(', ')}`);
  refreshStatus();
});

// ───────── 스마트 파일 청소 ─────────
let SCAN = null;
async function loadDrives() {
  try {
    const ds = await call('drives');
    $('#drives').innerHTML = ds.map((d) => {
      const used = d.size - d.free, pct = d.size ? Math.round((used / d.size) * 100) : 0;
      return `<div class="card drive"><div class="top"><b>${esc(d.id)} ${esc(d.label || '로컬 디스크')}</b><span class="muted">${pct}%</span></div>
        <div class="bar"><i class="${pct >= 90 ? 'hot' : ''}" data-pct="${pct}"></i></div>
        <div class="sub">${fmtBytes(d.free)} 남음 / 전체 ${fmtBytes(d.size)}</div></div>`;
    }).join('');
    $$('#drives .bar > i').forEach((i) => { i.style.width = i.dataset.pct + '%'; });
  } catch (e) {
    $('#drives').innerHTML = '';
  }
}
function renderClean() {
  const box = $('#cleanGroups');
  box.innerHTML = '';
  for (const g of META.cleanGroups) {
    const items = META.cleanItems.filter((c) => c.group === g.id);
    const wrap = document.createElement('div');
    wrap.className = 'cgroup';
    wrap.innerHTML = `<h3>${esc(g.name)}</h3><div class="list"></div>`;
    for (const c of items) {
      const r = SCAN?.[c.id];
      const el = document.createElement('label');
      el.className = 'card item';
      el.innerHTML = `
        <input type="checkbox" class="cb" data-id="${c.id}" ${c.def ? 'checked' : ''} />
        <div class="body"><div class="title">${esc(c.name)}${c.warn ? ' <span class="badge">주의</span>' : ''}</div>${c.warn ? `<div class="desc">${esc(c.warn)}</div>` : ''}</div>
        <div class="side-val">${r ? `${fmtBytes(r.size)}<br><span class="tiny">${Number(r.count).toLocaleString()}개</span>` : '—'}</div>`;
      $('.list', wrap).appendChild(el);
    }
    box.appendChild(wrap);
  }
  updateCleanSum();
}
$('#cleanGroups').addEventListener('change', updateCleanSum);
function selectedClean() { return $$('#cleanGroups .cb').filter((x) => x.checked).map((x) => x.dataset.id); }
function updateCleanSum() {
  if (!SCAN) { $('#btnClean').disabled = true; return; }
  const ids = selectedClean();
  const total = ids.reduce((s, id) => s + Number(SCAN[id]?.size || 0), 0);
  const all = Object.values(SCAN).reduce((s, r) => s + Number(r.size || 0), 0);
  $('#cleanSum').innerHTML = `정리 가능한 파일 <b>${fmtBytes(all)}</b> 발견 · 선택한 항목 <b>${fmtBytes(total)}</b>`;
  $('#btnClean').disabled = !ids.length || total === 0;
}
$('#btnScan').addEventListener('click', () => withBusy('정크 파일 스캔 중…', async () => {
  const res = await call('clean:scan');
  SCAN = Object.fromEntries(res.map((r) => [r.id, r]));
  const checked = new Set(selectedClean());
  renderClean();
  $$('#cleanGroups .cb').forEach((x) => { x.checked = checked.has(x.dataset.id); });
  updateCleanSum();
  log('정크 파일 스캔 완료');
}));
$('#btnClean').addEventListener('click', async () => {
  const ids = selectedClean();
  const warn = META.cleanItems.filter((c) => ids.includes(c.id) && c.warn);
  let msg = `선택한 ${ids.length}개 항목을 정리합니다.`;
  if (warn.length) msg += `\n\n주의: ${warn.map((w) => w.name).join(', ')}\n${warn[0].warn}`;
  if (ids.includes('recycle')) msg += '\n\n휴지통도 비워집니다. 복구할 수 없습니다.';
  if (!(await call('confirm', msg))) return;
  await withBusy('파일 정리 중…', async () => {
    const r = await call('clean:run', ids);
    const skipped = r.results.reduce((s, x) => s + Number(x.skipped || 0), 0);
    toast(`🧹 ${r.count.toLocaleString()}개 파일, ${fmtBytes(r.freed)} 확보${skipped ? `\n(사용 중이라 건너뛴 파일 ${skipped}개)` : ''}`);
    r.results.forEach((x) => { if (SCAN[x.id]) { SCAN[x.id].size = Math.max(0, SCAN[x.id].size - x.freed); SCAN[x.id].count = Math.max(0, SCAN[x.id].count - x.count); } });
    const checked = new Set(selectedClean());
    renderClean();
    $$('#cleanGroups .cb').forEach((x) => { x.checked = checked.has(x.dataset.id); });
    updateCleanSum();
  });
  loadDrives();
});

// ───────── 중복 파일 찾기 ─────────
let DUPS = [];
function renderDupes(res) {
  DUPS = res.groups || [];
  const waste = DUPS.reduce((a, g) => a + g.size * (g.files.length - 1), 0);
  $('#dupSum').textContent = res.scanned != null ? `파일 ${Number(res.scanned).toLocaleString()}개 검사 · 중복 ${DUPS.length}묶음 · 정리 가능 ${fmtBytes(waste)} (각 묶음에서 가장 최근 파일 하나는 남깁니다)` : $('#dupSum').textContent;
  const box = $('#dupList');
  box.innerHTML = '';
  for (const g of DUPS.slice(0, 150)) {
    const el = document.createElement('div');
    el.className = 'dupg';
    el.innerHTML = `<div class="gh">${g.files.length}개 · 각 ${fmtBytes(g.size)}</div>` + g.files.map((f, i) =>
      `<label><input type="checkbox" class="dcb" data-path="${esc(f.path)}" ${i ? 'checked' : ''} /><span class="p" title="${esc(f.path)}">${esc(f.path)}</span><span class="t">${esc(f.mtime)}</span></label>`).join('');
    box.appendChild(el);
  }
  updDupBtn();
}
function updDupBtn() { $('#btnDupDel').disabled = !$$('#dupList .dcb').some((x) => x.checked); }
$('#dupList').addEventListener('change', updDupBtn);
$('#btnDupPick').addEventListener('click', async () => {
  const p = await call('dupes:pick').catch((e) => toast(e.message, true));
  if (p) { $('#dupRoot').value = p; $('#btnDupScan').disabled = false; }
});
$('#btnDupScan').addEventListener('click', () => withBusy('중복 파일 찾는 중… (파일이 많으면 몇 분 걸릴 수 있습니다)', async () => {
  renderDupes(await call('dupes:scan', $('#dupRoot').value, Number($('#dupMin').value)));
}));
$('#btnDupDel').addEventListener('click', async () => {
  const paths = $$('#dupList .dcb').filter((x) => x.checked).map((x) => x.dataset.path);
  if (!(await call('confirm', `선택한 파일 ${paths.length}개를 휴지통으로 보냅니다.\n필요하면 휴지통에서 되살릴 수 있습니다.`))) return;
  await withBusy('휴지통으로 옮기는 중…', async () => {
    const r = await call('dupes:delete', paths);
    const fail = r.results.filter((x) => !x.ok);
    toast(`🗑 ${r.results.length - fail.length}개 이동, ${fmtBytes(r.freed)} 확보${fail.length ? ` (실패 ${fail.length}개)` : ''}`, fail.length > 0);
    renderDupes({ groups: r.groups });
  });
});

// ───────── 앱 테마 ─────────
const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
$('#themeSel').addEventListener('change', async (e) => {
  applyTheme(e.target.value);
  await call('settings:set', { theme: e.target.value }).catch(() => {});
  paintTiles();
});

// ───────── 정밀 시스템 검사 ─────────
const CK_ICON = { ok: '✓', warn: '!', bad: '✕', info: 'i' };
$('#btnCheck').addEventListener('click', () => withBusy('시스템을 검사하는 중…', async () => {
  const res = await call('check:run');
  const cnt = { ok: 0, warn: 0, bad: 0 };
  res.forEach((r) => { if (cnt[r.status] != null) cnt[r.status]++; });
  $('#cOk').textContent = cnt.ok;
  $('#cWarn').textContent = cnt.warn;
  $('#cBad').textContent = cnt.bad;
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  const groups = [...new Set(res.map((r) => r.group))];
  const box = $('#checkList');
  box.innerHTML = '';
  for (const g of groups) {
    const items = res.filter((r) => r.group === g).sort((a, b) => order[a.status] - order[b.status]);
    const wrap = document.createElement('div');
    wrap.className = 'cg';
    wrap.innerHTML = `<h3>${esc(g)}</h3><div class="card"></div>`;
    for (const r of items) {
      const row = document.createElement('div');
      row.className = 'ck';
      row.innerHTML = `
        <div class="ic ${r.status}">${CK_ICON[r.status]}</div>
        <div class="body"><div class="nm">${esc(r.name)}</div><div class="val">${esc(r.value)}</div>${r.advice ? `<div class="adv">${esc(r.advice)}</div>` : ''}</div>`;
      if (r.fix && r.status !== 'ok') {
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = r.fix.type === 'page' ? '바로가기' : '해결';
        b.addEventListener('click', async () => {
          if (r.fix.type === 'page') return goto(r.fix.id);
          if (r.fix.type === 'action') return runAction(r.fix.id);
          const t = META.tweaks.find((x) => x.id === r.fix.id);
          if (t) {
            await toggleTweak(t, true, { checked: true });
            // 취소·실패 시에는 버튼을 그대로 둔다
            if (STATUS[t.id]?.status === 'on') { b.textContent = '적용됨'; b.disabled = true; }
          }
        });
        row.appendChild(b);
      }
      $('.card', wrap).appendChild(row);
    }
    box.appendChild(wrap);
  }
  toast(`검사 완료 — 정상 ${cnt.ok} · 주의 ${cnt.warn} · 위험 ${cnt.bad}`);
}));

// ───────── 시작 프로그램 ─────────
async function loadStartup() {
  const box = $('#startupList');
  box.innerHTML = '<div class="empty">불러오는 중…</div>';
  try {
    const items = await call('startup:list');
    box.innerHTML = items.length ? '' : '<div class="empty">등록된 시작 프로그램이 없습니다.</div>';
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'card item';
      el.innerHTML = `
        <div class="body">
          <div class="title">${esc(it.display || it.name)} <span class="badge">${esc(it.label)}</span></div>
          <div class="cmd" title="${esc(it.cmd)}">${esc(it.cmd)}</div>
        </div>
        <label class="switch"><input type="checkbox" ${it.enabled ? 'checked' : ''} /><span class="slider"></span></label>`;
      $('input', el).addEventListener('change', async (e) => {
        const input = e.target;
        const en = input.checked;
        if (it.src === 'SVC' && !en && !(await call('confirm', `"${it.display || it.name}" 서비스를 자동 시작에서 빼고 "수동"으로 바꿉니다.\n\n해당 프로그램이 필요할 때 직접 시작하지만, 자동 업데이트나 백그라운드 기능이 늦게 동작할 수 있습니다. 언제든 다시 켤 수 있습니다.`))) { input.checked = true; return; }
        const ok = await withBusy('변경 중…', async () => {
          await call('startup:set', { src: it.src, name: it.name, path: it.path, display: it.display }, en);
          toast(`${it.name}: 시작 시 실행 ${en ? '켜짐' : '꺼짐'}`);
          return true;
        });
        if (!ok) input.checked = !en; // 실패(권한 부족 등) 시 스위치를 원래대로
      });
      box.appendChild(el);
    }
  } catch (e) {
    box.innerHTML = `<div class="empty">불러오기 실패: ${esc(e.message)}</div>`;
  }
}
$('#btnStartupRefresh').addEventListener('click', loadStartup);

// ───────── 기본 앱 제거 ─────────
async function loadBloat() {
  const box = $('#bloatList');
  box.innerHTML = '<div class="empty">설치된 앱을 확인하는 중…</div>';
  $('#btnBloatRemove').disabled = true;
  try {
    const items = await call('bloat:list');
    box.innerHTML = items.length ? '' : '<div class="empty">제거할 기본 앱이 없습니다. 깔끔하네요!</div>';
    for (const it of items) {
      const el = document.createElement('label');
      el.className = 'card item';
      el.innerHTML = `
        <input type="checkbox" class="cb" data-full="${esc(it.full)}" data-name="${esc(it.name)}" />
        <div class="body"><div class="title">${esc(it.name)}${it.caution ? ' <span class="badge">주의</span>' : ''}</div><div class="cmd">${esc(it.pkg)} · ${esc(it.ver)}</div></div>`;
      box.appendChild(el);
    }
  } catch (e) {
    box.innerHTML = `<div class="empty">불러오기 실패: ${esc(e.message)}</div>`;
  }
}
$('#bloatList').addEventListener('change', () => {
  $('#btnBloatRemove').disabled = !$$('#bloatList .cb').some((x) => x.checked);
});
$('#btnBloatRefresh').addEventListener('click', loadBloat);
$('#btnBloatRemove').addEventListener('click', async () => {
  const sel = $$('#bloatList .cb').filter((x) => x.checked);
  if (!(await call('confirm', `다음 ${sel.length}개 앱을 제거합니다.\n\n${sel.map((x) => '• ' + x.dataset.name).join('\n')}\n\nMicrosoft Store에서 다시 설치할 수 있습니다.`))) return;
  await withBusy('앱 제거 중…', async () => {
    const res = await call('bloat:remove', sel.map((x) => x.dataset.full));
    const fail = res.filter((r) => !r.ok);
    toast(`🗑 ${res.length - fail.length}개 앱 제거 완료${fail.length ? ` (실패 ${fail.length}개)` : ''}`, fail.length > 0);
    fail.forEach((f) => log(`  ✖ ${f.full}: ${f.err}`));
  });
  loadBloat();
});


// ───────── 전/후 성능 비교 ─────────
let BMETA = null;
let RUNS = [];
let cmpKind = 'system';
let cmpSel = { a: null, b: null };
let warnedPair = null;
const COL_A = '#8577ee', COL_B = '#17a878';

api.on('bench:progress', (p) => {
  $('#busyText').textContent = `${p.text}${p.pct != null && p.pct < 100 ? `  (${p.pct}%)` : ''}`;
});

async function runSystemBench(label, silent = false) {
  return withBenchBusy('시스템 벤치마크 준비 중…', async () => {
    const run = await call('bench:system', label);
    if (run.gpuError) log('그래픽 테스트 건너뜀: ' + run.gpuError);
    if (!silent) toast(`📊 측정 완료 (${run.label}) — 그래픽 ${fmtNum(run.metrics.gpuFps, 0)} FPS · CPU 멀티 ${fmtNum(run.metrics.cpuMulti, 0)}점`);
    RUNS.unshift(run);
    return run;
  });
}

const fmtNum = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '-' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const runName = (r) => `${r.label} · ${fmtTime(r.time)}${r.kind === 'game' ? ' · ' + r.app : ''}`;

async function loadBench() {
  try {
    if (!BMETA) BMETA = await call('bench:meta');
    RUNS = await call('bench:list');
  } catch (e) { toast(e.message, true); return; }
  $('#pmNote').textContent = BMETA.presentmon ? '' : '처음 측정할 때 Intel PresentMon(무료, 오픈소스 FPS 측정 도구)을 자동으로 내려받습니다.';
  renderRuns();
  renderCompare();
}

function renderRuns() {
  const box = $('#benchRuns');
  if (!RUNS.length) { box.innerHTML = '<div class="empty">아직 측정 기록이 없습니다. 위에서 "최적화 전" 측정부터 시작하세요.</div>'; return; }
  box.innerHTML = '';
  for (const r of RUNS) {
    const el = document.createElement('div');
    el.className = 'card item';
    const m = r.metrics;
    const sum = r.kind === 'game'
      ? `평균 ${fmtNum(m.avgFps)} FPS · 1% Low ${fmtNum(m.low1)} · ${r.seconds}초 · ${Number(r.frames).toLocaleString()}프레임`
      : `그래픽 ${fmtNum(m.gpuFps, 0)} FPS · 1% Low ${fmtNum(m.gpuLow1, 0)} · CPU ${fmtNum(m.cpuSingle, 0)}/${fmtNum(m.cpuMulti, 0)}점 · 끊김 ${fmtNum(m.spikes, 0)}회${r.env?.gpu ? ' · ' + r.env.gpu : ''}${(r.env?.benchVer || 1) < 2 ? ' · 이전 측정 방식(60 FPS 제한)' : ''}`;
    el.innerHTML = `<div class="body"><div class="title">${r.kind === 'game' ? '🎮' : '🖥'} ${esc(runName(r))}</div><div class="desc">${esc(sum)}</div></div><button class="btn small ghost">삭제</button>`;
    $('button', el).addEventListener('click', async () => {
      if (!(await call('confirm', `"${runName(r)}" 측정 기록을 삭제할까요?`))) return;
      await call('bench:delete', r.id);
      RUNS = RUNS.filter((x) => x.id !== r.id);
      renderRuns(); renderCompare();
    });
    box.appendChild(el);
  }
}

function renderCompare() {
  $$('#cmpKind .chip').forEach((c) => c.classList.toggle('active', c.dataset.kind === cmpKind));
  const runs = RUNS.filter((r) => r.kind === cmpKind);
  const selA = $('#cmpA'), selB = $('#cmpB');
  const opts = runs.map((r) => `<option value="${r.id}">${esc(runName(r))}</option>`).join('');
  selA.innerHTML = opts; selB.innerHTML = opts;
  if (runs.length < 2) {
    $('#cmpHeadline').innerHTML = '';
    $('#cmpTable').innerHTML = `<div class="empty">비교하려면 측정 기록이 2개 이상 필요합니다. (현재 ${runs.length}개)</div>`;
    $('#ftWrap').classList.add('hidden');
    return;
  }
  // 기본 선택: "최적화 전" 중 가장 최근 것과 가장 최근 측정
  if (!runs.find((r) => r.id === cmpSel.a) || !runs.find((r) => r.id === cmpSel.b)) {
    const b = runs[0];
    const a = runs.find((r) => r.id !== b.id && r.label === '최적화 전' && (r.kind !== 'game' || r.app === b.app)) || runs[1];
    cmpSel = { a: a.id, b: b.id };
  }
  selA.value = cmpSel.a; selB.value = cmpSel.b;
  const A = runs.find((r) => r.id === cmpSel.a), B = runs.find((r) => r.id === cmpSel.b);
  const defs = cmpKind === 'game' ? BMETA.game : BMETA.system;

  const pct = (d, a, b) => {
    if (a == null || b == null || !Number(a)) return null;
    const ch = ((b - a) / Math.abs(a)) * 100;
    return d.better === 'up' ? ch : -ch; // +면 개선
  };
  const deltaHtml = (d, a, b) => {
    const p = pct(d, a, b);
    if (p == null) return '<span class="delta same">-</span>';
    const raw = ((b - a) / Math.abs(a)) * 100;
    const cls = Math.abs(p) < 1 ? 'same' : p > 0 ? 'good' : 'bad';
    const word = Math.abs(p) < 1 ? '비슷' : p > 0 ? '개선' : '저하';
    const arrow = raw > 0 ? '▲' : raw < 0 ? '▼' : '';
    return `<span class="delta ${cls}">${arrow} ${Math.abs(raw).toFixed(1)}% ${word}</span>`;
  };

  // 헤드라인 3개
  const heads = cmpKind === 'game' ? ['avgFps', 'low1', 'stutters'] : ['gpuFps', 'gpuLow1', 'cpuMulti'];
  $('#cmpHeadline').innerHTML = heads.map((k) => {
    const d = defs.find((x) => x.key === k);
    const a = A.metrics[k], b = B.metrics[k];
    return `<div class="hl"><div class="k">${esc(d.name)}</div><div class="v">${fmtNum(b, d.digits)} <span class="small muted">${d.unit}</span></div>${deltaHtml(d, a, b)}</div>`;
  }).join('');

  const rows = defs.map((d) => {
    const a = A.metrics[d.key], b = B.metrics[d.key];
    const mx = Math.max(Number(a) || 0, Number(b) || 0) || 1;
    const w = (v) => `${Math.max(1, ((Number(v) || 0) / mx) * 100).toFixed(1)}`;
    return `<tr><td>${esc(d.name)}</td><td class="num">${fmtNum(a, d.digits)} ${d.unit}</td><td class="num">${fmtNum(b, d.digits)} ${d.unit}</td>
      <td class="bars"><div class="a" data-w="${w(a)}" title="기준 ${fmtNum(a, d.digits)} ${d.unit}"></div><div class="b" data-w="${w(b)}" title="비교 ${fmtNum(b, d.digits)} ${d.unit}"></div></td>
      <td class="num">${deltaHtml(d, a, b)}</td></tr>`;
  }).join('');
  $('#cmpTable').innerHTML = `<table class="cmpt"><thead><tr><th>항목</th><th class="num">기준</th><th class="num">비교</th><th>그래프</th><th class="num">변화</th></tr></thead><tbody>${rows}</tbody></table>`;
  $$('#cmpTable .bars div').forEach((el) => { el.style.width = el.dataset.w + '%'; });
  // 창 크기를 바꿀 때마다 다시 그리므로, 같은 조합에서는 경고를 한 번만 띄운다
  const pairKey = A.id + '|' + B.id;
  if (cmpKind === 'game' && A.app !== B.app && warnedPair !== pairKey) toast('서로 다른 게임의 기록을 비교하고 있습니다.', true);
  // 그래픽 테스트 측정 방식이 바뀐 기록끼리는 그래픽 수치를 비교할 수 없다 (이전 방식은 60 FPS 로 제한됨)
  if (cmpKind === 'system' && (A.env?.benchVer || 1) !== (B.env?.benchVer || 1) && warnedPair !== pairKey) toast('그래픽 테스트 측정 방식이 바뀐 이전 기록과 비교하고 있습니다. 그래픽 FPS 는 비교할 수 없으니 새로 두 번 측정하세요.', true);
  warnedPair = pairKey;

  const showFt = cmpKind === 'game' && A.series && B.series;
  $('#ftWrap').classList.toggle('hidden', !showFt);
  ftPair = showFt ? [A, B] : null;
  if (showFt) drawFt(A, B);
}
let ftPair = null;

let ftHover = null;
function drawFt(A, B) {
  const cv = $('#ftChart');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const padL = 40, padB = 18, padT = 6;
  const all = [...A.series, ...B.series].sort((x, y) => x - y);
  const top = Math.max(5, all[Math.floor(all.length * 0.995)] * 1.15);
  const X = (i, n) => padL + (i / Math.max(1, n - 1)) * (w - padL - 8);
  const Y = (v) => padT + (1 - Math.min(v, top) / top) * (h - padT - padB);
  ctx.font = '11px Segoe UI, Malgun Gothic, sans-serif';
  ctx.fillStyle = '#8b98a9';
  ctx.strokeStyle = 'rgba(139,152,169,.18)';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const v = (top / 4) * g, y = Y(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - 8, y); ctx.stroke();
    ctx.fillText(v.toFixed(v < 10 ? 1 : 0) + 'ms', 2, y + 4);
  }
  ctx.fillText('측정 시작', padL, h - 3);
  ctx.textAlign = 'right'; ctx.fillText('끝', w - 8, h - 3); ctx.textAlign = 'left';
  for (const [s, col] of [[A.series, COL_A], [B.series, COL_B]]) {
    ctx.beginPath();
    s.forEach((v, i) => (i ? ctx.lineTo(X(i, s.length), Y(v)) : ctx.moveTo(X(i, s.length), Y(v))));
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  }
  const tip = $('#ftTip');
  if (ftHover != null) {
    const x = padL + ftHover * (w - padL - 8);
    ctx.strokeStyle = 'rgba(230,237,245,.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
    const va = A.series[Math.round(ftHover * (A.series.length - 1))], vb = B.series[Math.round(ftHover * (B.series.length - 1))];
    for (const [v, col] of [[va, COL_A], [vb, COL_B]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, Y(v), 4, 0, 7); ctx.fill(); }
    tip.innerHTML = `<i class="sw a"></i> 기준 ${va} ms · ${(1000 / va).toFixed(0)} FPS<br><i class="sw b"></i> 비교 ${vb} ms · ${(1000 / vb).toFixed(0)} FPS`;
    tip.classList.remove('hidden');
  } else tip.classList.add('hidden');
}
$('#ftChart').addEventListener('mousemove', (e) => {
  const cv = e.currentTarget, padL = 40;
  ftHover = Math.min(1, Math.max(0, (e.offsetX - padL) / (cv.clientWidth - padL - 8)));
  if (ftPair) drawFt(...ftPair);
});
$('#ftChart').addEventListener('mouseleave', () => { ftHover = null; if (ftPair) drawFt(...ftPair); });

$('#cmpKind').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  cmpKind = c.dataset.kind;
  cmpSel = { a: null, b: null };
  renderCompare();
});
$('#cmpA').addEventListener('change', (e) => { cmpSel.a = e.target.value; renderCompare(); });
$('#cmpB').addEventListener('change', (e) => { cmpSel.b = e.target.value; renderCompare(); });

$('#bsLabel').addEventListener('change', (e) => $('#bsLabelTxt').classList.toggle('hidden', e.target.value !== ''));
$('#btnBenchSys').addEventListener('click', async () => {
  const label = $('#bsLabel').value || $('#bsLabelTxt').value.trim() || '측정';
  const run = await runSystemBench(label);
  if (run) { cmpKind = 'system'; cmpSel = { a: null, b: null }; await loadBench(); }
});

async function loadProcs() {
  const sel = $('#bgProc');
  try {
    const list = await call('bench:procs');
    sel.innerHTML = list.length
      ? list.map((p) => `<option value="${p.pid}" data-name="${esc(p.name)}">${esc(p.name)} — ${esc(p.title.slice(0, 40))} (${p.memMB} MB)</option>`).join('')
      : '<option value="">실행 중인 게임 창이 없습니다</option>';
  } catch (e) { toast(e.message, true); }
}
$('#btnProcRefresh').addEventListener('click', loadProcs);
$('#btnBenchGame').addEventListener('click', async () => {
  const sel = $('#bgProc');
  if (!sel.value) { await loadProcs(); if (!sel.value) return toast('게임을 먼저 실행한 뒤 새로고침을 눌러 선택하세요.', true); }
  const opt = sel.selectedOptions[0];
  const params = { pid: Number(sel.value), name: opt.dataset.name, seconds: Number($('#bgSec').value), delay: Number($('#bgDelay').value), label: $('#bgLabel').value };
  // 결과(성공·실패)를 카드에 계속 표시한다. 측정 중엔 게임 화면에 있어 몇 초짜리 알림은 놓치기 쉽다
  const box = $('#gameResult');
  let failMsg = null;
  const run = await withBenchBusy('FPS 측정 준비 중…', async () => {
    try { return await call('bench:game', params); } catch (e) { failMsg = e.message; throw e; }
  });
  box.classList.remove('hidden', 'ok', 'bad');
  if (failMsg) {
    box.classList.add('bad');
    box.textContent = `✕ 마지막 측정 실패 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })}): ${failMsg}`;
  } else if (run) {
    box.classList.add('ok');
    box.textContent = `✓ ${run.app} — 평균 ${fmtNum(run.metrics.avgFps)} FPS · 1% Low ${fmtNum(run.metrics.low1)} · ${Number(run.frames).toLocaleString()}프레임 (아래 측정 기록·비교에 추가됨)`;
  }
  if (run) {
    toast(`🎮 ${run.app} — 평균 ${fmtNum(run.metrics.avgFps)} FPS · 1% Low ${fmtNum(run.metrics.low1)}`);
    BMETA.presentmon = true;
    cmpKind = 'game'; cmpSel = { a: null, b: null };
    await loadBench();
  }
});
window.addEventListener('resize', () => { if (!$('#page-bench').classList.contains('hidden')) renderCompare(); });

// ───────── 백업·설정 ─────────
async function loadBackup() {
  const box = $('#backupList');
  try {
    const s = await call('settings:get');
    $('#chkGuard').checked = !!s.guard;
    $('#chkAutoUpd').checked = s.autoUpdate !== false;
    const list = await call('backup:info');
    box.innerHTML = list.length ? '' : '<div class="empty">아직 백업된 변경 사항이 없습니다.</div>';
    for (const b of list) {
      const el = document.createElement('div');
      el.className = 'card item';
      el.innerHTML = `
        <div class="body">
          <div class="title">${esc(b.name)}</div>
          <div class="desc">적용: ${esc(new Date(b.appliedAt).toLocaleString('ko-KR'))} · 백업된 값 ${b.count}개</div>
        </div>
        <button class="btn small">되돌리기</button>`;
      $('button', el).addEventListener('click', async () => {
        await withBusy('되돌리는 중…', async () => {
          const r = await call('revert', [b.id]);
          toast(r.errors.length ? '일부 오류: ' + r.errors[0] : `↩ ${b.name} 복원 완료`, r.errors.length > 0);
        });
        await refreshStatus();
        loadBackup();
      });
      box.appendChild(el);
    }
  } catch (e) {
    box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
function paintGuard(on) {
  $('#guardPill').classList.toggle('off', !on);
  $('#guardPill span').textContent = on ? '설정 유지 감시 켜짐' : '설정 유지 감시 꺼짐';
}
$('#chkGuard').addEventListener('change', async (e) => {
  const s = await call('settings:set', { guard: e.target.checked });
  paintGuard(s.guard);
  toast(s.guard ? '🛡 설정 유지 감시를 켰습니다.' : '설정 유지 감시를 껐습니다.');
  if (s.guard) call('guard:run').catch(() => {});
});
$('#btnOpenBackup').addEventListener('click', () => call('backup:open'));

// ───────── 자동 업데이트 ─────────
let UPD = null;
let updManual = false; // 사용자가 직접 확인을 눌렀을 때만 "최신 버전입니다"·오류를 알린다
function paintUpdate(st) {
  if (!st) return;
  UPD = st;
  const chk = $('#btnUpdCheck');
  chk.disabled = st.status === 'checking' || st.status === 'downloading';
  chk.textContent = st.status === 'checking' ? '확인 중…' : '업데이트 확인';
  let text = '', label = '';
  if (st.status === 'available') { text = `새 버전 v${st.version}이(가) 나왔습니다. (현재 v${st.current})`; label = st.portable ? '다운로드 페이지 열기' : '업데이트'; }
  else if (st.status === 'downloading') text = `새 버전 v${st.version} 내려받는 중… ${st.percent ?? 0}%`;
  else if (st.status === 'ready') { text = `v${st.version} 업데이트 준비 완료 — 다시 시작하면 설치됩니다.`; label = '다시 시작해 설치'; }
  $('#updateBar').classList.toggle('hidden', !text);
  $('#updText').textContent = text;
  $('#btnUpd').textContent = label;
  $('#btnUpd').classList.toggle('hidden', !label);
  if (updManual && !['checking', 'idle'].includes(st.status)) {
    updManual = false;
    if (st.status === 'none') toast(`최신 버전입니다. (v${st.current})`);
    else if (st.status === 'error' || st.status === 'unsupported') toast(st.error || '업데이트를 확인하지 못했습니다.', true);
  }
}
api.on('update', paintUpdate);
$('#btnUpdCheck').addEventListener('click', async () => {
  updManual = true;
  try { paintUpdate(await call('update:check')); } catch (e) { updManual = false; toast(e.message, true); }
});
$('#btnUpd').addEventListener('click', async () => {
  if (UPD?.status === 'available') {
    call('update:download').catch((e) => toast(e.message, true));
  } else if (UPD?.status === 'ready') {
    if (!(await call('confirm', `프로그램을 종료하고 v${UPD.version}을(를) 설치합니다.\n설치가 끝나면 자동으로 다시 실행됩니다.`))) return;
    call('update:install').catch((e) => toast(e.message, true));
  }
});
$('#chkAutoUpd').addEventListener('change', async (e) => {
  const s = await call('settings:set', { autoUpdate: e.target.checked });
  toast(s.autoUpdate ? '자동 업데이트 확인을 켰습니다.' : '자동 업데이트 확인을 껐습니다. (사이드바에서 직접 확인할 수 있습니다)');
});

// ───────── 기타 ─────────
$('#btnAdmin').addEventListener('click', () => call('admin:relaunch').catch((e) => toast(e.message, true)));
$('#btnReboot').addEventListener('click', async () => {
  if (await call('confirm', '5초 후 PC를 재부팅합니다. 저장하지 않은 작업을 먼저 저장하세요.')) {
    await call('reboot').catch((e) => toast(e.message, true));
  }
});

// ───────── 시작 ─────────
(async function init() {
  try {
    META = await call('meta');
    $('#ver').textContent = 'v' + META.version;
    renderStatic();
    renderClean();
  } catch (e) {
    toast(e.message, true);
    return;
  }
  log('프로그램 시작');
  loadHistory();
  call('settings:get').then((s) => { paintGuard(s.guard); applyTheme(s.theme || ''); $('#themeSel').value = s.theme || ''; }).catch(() => {});
  call('update:state').then(paintUpdate).catch(() => {});
  call('stats').then(paintStats).catch(() => {});
  call('sysinfo')
    .then((s) => {
      $('#sCpu').textContent = `${s.cpu} (${s.cores})`;
      $('#sGpu').textContent = s.gpu;
      $('#sRam').textContent = `${s.ramGB} GB`;
      $('#sBoard').textContent = s.board;
      $('#sOs').textContent = s.os;
      $('#sUp').textContent = s.uptime;
      if (!s.admin) $('#adminBar').classList.remove('hidden');
      log('전원 계획: ' + (s.plan || '-'));
    })
    .catch((e) => toast('시스템 정보 확인 실패: ' + e.message, true));
  await withBusy('현재 설정 확인 중…', refreshStatus);
})();
