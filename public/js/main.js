// 앱 진입점: 상태, 라우터, 테마, 실시간 반영, 알림, 태블릿 미디어
import { api, auth, get, login, logout, connectStream } from './api.js';
import { h, $, toast, pinPad, modal } from './ui.js';
import { fxConfig, sounds, unlockAudio, confetti } from './fx.js';
import { initChars, setChars } from './chars.js';
import * as home from './home.js';
import * as scores from './scores.js';
import * as calendar from './calendar.js';
import * as settings from './settings.js';
import { styleOf } from './collect.js';

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 무시 */ } },
};

export const store = {
  boot: null,
  today: null,
  memberId: Number(LS.get('hh_member', 0)) || null,
  recent: new Set(), // 이 기기에서 방금 만든 체크 id (중복 효과 방지)
  LS,
  member(id = store.memberId) { return store.boot?.members.find((m) => m.id === id) || null; },
  selectMember(id) {
    store.memberId = id;
    LS.set('hh_member', id ? String(id) : null);
  },
  get parent() { return auth.parent; },
};

const ROUTES = {
  home: { label: '오늘', icon: '🏠', view: home },
  scores: { label: '포도밭', icon: '🍇', view: scores },
  calendar: { label: '달력', icon: '📅', view: calendar },
  settings: { label: '설정', icon: '⚙️', view: settings },
};
let current = 'home';

export async function reloadBoot() {
  store.boot = await get('/api/bootstrap');
  auth.parent = !!store.boot.parent;
  applyDisplay();
  if (store.memberId && !store.member()) store.selectMember(null);
}
export async function reloadToday() {
  store.today = await get('/api/today');
  setChars(store.boot.members, store.today.lifetime, store.boot.settings.characters === '1');
}

function applyDisplay() {
  const s = store.boot.settings;
  const root = document.documentElement;
  if (s.theme === 'dark' || s.theme === 'light') root.dataset.theme = s.theme;
  else delete root.dataset.theme;
  root.style.fontSize = `${Math.round(16 * (Number(s.font_scale) || 1))}px`;
  fxConfig.sound = s.sound === '1';
  document.body.classList.toggle('chars-on', s.characters === '1');
  // 모으기 방식에 따라 메뉴 이름·아이콘 바꾸기
  const st = styleOf(s);
  ROUTES.scores.label = st.nav;
  ROUTES.scores.icon = st.icon;
  const link = document.querySelector('.nav-link[data-route="scores"]');
  if (link) {
    link.querySelector('.nav-icon').textContent = st.icon;
    link.querySelector('.nav-label').textContent = st.nav;
  }
}

// ---------------- 렌더
const viewEl = () => $('#view');
export function render() {
  const r = ROUTES[current];
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === current));
  document.body.dataset.route = current;
  renderTopbar();
  const el = viewEl();
  const y = el.scrollTop;
  r.view.render(el, store);
  el.scrollTop = y;
}

function renderTopbar() {
  const bar = $('#topbar');
  const today = store.boot?.today;
  const d = today ? new Date(...today.split('-').map((n, i) => (i === 1 ? n - 1 : Number(n)))) : new Date();
  const date = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  bar.replaceChildren(
    h('div', { class: 'topbar-title' }, h('span', { class: 'topbar-route' }, ROUTES[current].label), h('span', { class: 'topbar-date' }, date)),
    h('div', { class: 'topbar-clock', id: 'clock' }, clockText()),
    h('div', { class: 'topbar-actions' },
      h('button', {
        class: `btn btn-sm ${store.parent ? 'btn-parent' : 'btn-ghost'}`,
        title: store.parent ? '부모 모드 끄기' : '부모 모드',
        onclick: () => (store.parent ? logout() : askParent()),
      }, store.parent ? '🔓 부모 모드' : '🔒 부모'),
    ),
  );
}
const clockText = () => new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

export function askParent(title) {
  return new Promise((resolve) => {
    if (store.parent) return resolve(true);
    let ok = false;
    pinPad({ title, onSubmit: async (pin) => { await login(pin); ok = true; } });
    const check = setInterval(() => {
      if (!document.querySelector('.modal-pin')) { clearInterval(check); resolve(ok); }
    }, 200);
  });
}

function go(route) {
  if (!ROUTES[route]) route = 'home';
  current = route;
  render();
}

// ---------------- 실시간 반영
let reloadTimer;
function scheduleReload(boot = false) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    try {
      if (boot) await reloadBoot();
      await reloadToday();
      render();
    } catch (e) { console.warn(e); }
  }, 150);
}

function onRemoteCompletion(p) {
  // 이 기기에서 방금 체크한 건 응답이 SSE보다 늦게 올 수 있어 잠깐 기다렸다 확인
  setTimeout(() => handleRemoteCompletion(p), 600);
}
function handleRemoteCompletion(p) {
  if (store.recent.has(p.completion.id)) return;
  const m = store.member(p.completion.member_id);
  if (m) {
    toast(`${m.emoji || ''} ${m.name}: ${p.task.icon} ${p.task.name} 완료!`);
    if (current === 'home') confetti(innerWidth / 2, innerHeight * 0.3, 30);
  }
  if (p.family_cleared && current === 'home') home.celebrateFamily();
  scheduleReload();
}

function showAlert(a) {
  const names = a.members.map((id) => store.member(id)?.name).filter(Boolean).join(', ');
  const el = h('div', { class: 'alert-banner' },
    h('span', { class: 'alert-icon' }, a.icon || '⏰'),
    h('div', {}, h('strong', {}, a.title), h('div', {}, `${a.start_time} 시작${a.before ? ` · ${a.before}분 전` : ''}${names ? ` · ${names}` : ''}`)),
    h('button', { class: 'icon-btn', onclick: () => el.remove() }, '✕'));
  $('#alerts').append(el);
  sounds.chime();
  setTimeout(() => el.remove(), 60_000);
}

// ---------------- 태블릿 미디어 재생 기기
export const mediaDevice = {
  get enabled() { return LS.get('hh_media_device') === '1'; },
  set enabled(v) { LS.set('hh_media_device', v ? '1' : null); },
  unlocked: false,
  wakeLock: null,
  async start() {
    unlockAudio();
    try {
      const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
      await a.play().catch(() => {});
    } catch { /* 무시 */ }
    this.unlocked = true;
    await this.keepAwake();
    toast('오늘도 시작! 예약된 음악·영상이 이 화면에서 재생돼요 🎵');
  },
  async keepAwake() {
    try {
      if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* 무시 */ }
  },
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && mediaDevice.unlocked) mediaDevice.keepAwake();
});

let mediaClose = null;
function playOnTablet(m) {
  if (!mediaDevice.enabled) return;
  mediaClose?.();
  const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(m.name);
  const el = isVideo
    ? h('video', { src: m.url, autoplay: true, controls: true, playsinline: true, class: 'media-el' })
    : h('audio', { src: m.url, autoplay: true, controls: true, class: 'media-el' });
  el.volume = Math.max(0, Math.min(1, (m.volume ?? 70) / 100));
  el.addEventListener('ended', () => mediaClose?.());
  mediaClose = modal(h('div', { class: 'media-player' }, h('div', { class: 'media-title' }, isVideo ? '🎬 ' : '🎵 ', m.name), el), {
    title: '예약 재생', onClose: () => { el.pause(); mediaClose = null; },
  });
  el.play().catch(() => toast('소리를 켜려면 화면을 한 번 눌러 주세요 ▶', { duration: 6000 }));
}

// ---------------- 시작
async function boot() {
  const nav = $('#nav-links');
  for (const [key, r] of Object.entries(ROUTES)) {
    nav.append(h('a', { class: 'nav-link', href: `#/${key}`, 'data-route': key },
      h('span', { class: 'nav-icon' }, r.icon), h('span', { class: 'nav-label' }, r.label)));
  }
  initChars($('#chars-host'));
  try {
    await reloadBoot();
    await reloadToday();
  } catch (e) {
    $('#view').replaceChildren(h('div', { class: 'empty' }, '서버에 연결할 수 없어요. 서버 PC가 켜져 있는지 확인해 주세요.', h('br'), h('small', {}, e.message)));
    return;
  }
  const route = () => go(location.hash.replace(/^#\/?/, '') || 'home');
  addEventListener('hashchange', route);
  route();

  window.addEventListener('hh:parent', () => render());
  connectStream({
    completion: onRemoteCompletion,
    uncheck: () => scheduleReload(),
    changed: (d) => scheduleReload(['members', 'tasks', 'slots', 'settings', 'all'].includes(d.what)),
    grants: () => scheduleReload(),
    alert: showAlert,
    media: playOnTablet,
    'media-stop': () => mediaClose?.(),
    tick: (t) => {
      if (store.boot && t.today !== store.boot.today) scheduleReload(true);
      else if (current === 'home') home.tick?.(store);
    },
    open: () => { if (store.today) scheduleReload(); },
  });
  setInterval(() => { const c = $('#clock'); if (c) c.textContent = clockText(); }, 10_000);
  document.addEventListener('pointerdown', () => unlockAudio(), { once: true });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

export { api, go };
boot();
