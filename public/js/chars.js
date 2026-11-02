// 화면 하단을 걸어다니는 가족 캐릭터 (얼굴 사진 + 만화 몸통)
import { h } from './ui.js';

const GREET = ['안녕!', '반가워!', '하이~', '👋', '좋은 하루!'];
const TAP = ['간지러워! 😆', '나 불렀어?', '같이 해볼까?', '오늘도 화이팅!', '😄', '헤헤'];

let layer;
let chars = [];
let raf = 0;
let enabled = true;
let last = 0;

/** 포인트 누적에 따른 꾸미기 아이템 */
export function itemsFor(points = 0) {
  const items = [];
  if (points >= 200) items.push('hat');
  if (points >= 600) items.push('cape');
  if (points >= 1200) items.push('crown');
  return items;
}

function build(member, items) {
  const head = member.character || member.photo
    ? h('img', { src: member.character || member.photo, alt: '', draggable: 'false' })
    : h('span', {}, member.emoji || '🙂');
  const el = h('div', { class: `char ${member.character ? 'char-custom' : ''}`, style: { '--mc': member.color }, title: member.name },
    h('div', { class: 'char-bubble' }),
    h('div', { class: 'char-figure' },
      items.includes('cape') && h('div', { class: 'char-cape' }),
      h('div', { class: 'char-head' }, head,
        items.includes('crown') ? h('span', { class: 'char-hat' }, '👑') : items.includes('hat') && h('span', { class: 'char-hat' }, '🧢')),
      !member.character && h('div', { class: 'char-body' },
        h('span', { class: 'arm l' }), h('span', { class: 'arm r' }),
        h('span', { class: 'leg l' }), h('span', { class: 'leg r' }))),
    h('div', { class: 'char-name' }, member.name));
  return el;
}

export function initChars(host) {
  layer = h('div', { class: 'char-layer', 'aria-hidden': 'true' });
  host.append(layer);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (enabled) start();
  });
}

export function setChars(members, lifetime = {}, on = true) {
  enabled = on;
  if (!layer) return;
  layer.hidden = !on;
  const width = layer.clientWidth || innerWidth;
  const prev = new Map(chars.map((c) => [c.id, c]));
  layer.replaceChildren();
  chars = members.map((m, i) => {
    const old = prev.get(m.id);
    const el = build(m, itemsFor(lifetime[m.id] || 0));
    layer.append(el);
    const c = {
      id: m.id, el,
      x: old?.x ?? ((i + 0.5) / members.length) * (width - 70),
      dir: old?.dir ?? (Math.random() < 0.5 ? -1 : 1),
      speed: 0.35 + Math.random() * 0.35,
      pauseUntil: 0, greetCooldown: 0, target: null,
    };
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      jump(c);
      say(c, TAP[Math.floor(Math.random() * TAP.length)]);
    });
    return c;
  });
  if (on) start();
  else cancelAnimationFrame(raf);
}

function start() {
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(step);
}

function step(t) {
  const dt = Math.min(50, t - last) / 16.7;
  last = t;
  const width = layer.clientWidth || innerWidth;
  const now = Date.now();
  for (const c of chars) {
    if (c.target != null) {
      const d = c.target - c.x;
      if (Math.abs(d) < 4) { c.target = null; c.pauseUntil = now + 2500; }
      else { c.dir = Math.sign(d); c.x += c.dir * 2.2 * dt; }
    } else if (now > c.pauseUntil) {
      c.x += c.dir * c.speed * dt;
      if (c.x < 0) { c.x = 0; c.dir = 1; }
      if (c.x > width - 70) { c.x = width - 70; c.dir = -1; }
      if (Math.random() < 0.0015 * dt) jump(c);
      if (Math.random() < 0.001 * dt) c.pauseUntil = now + 1500 + Math.random() * 2000;
      if (Math.random() < 0.0008 * dt) c.dir *= -1;
    }
    const walking = now > c.pauseUntil;
    c.el.classList.toggle('walking', walking);
    c.el.style.transform = `translateX(${c.x}px)`;
    c.el.querySelector('.char-figure').style.setProperty('--flip', c.dir < 0 ? -1 : 1);
  }
  // 서로 마주치면 인사
  for (let i = 0; i < chars.length; i++) {
    for (let j = i + 1; j < chars.length; j++) {
      const a = chars[i];
      const b = chars[j];
      if (Math.abs(a.x - b.x) < 46 && now > a.greetCooldown && now > b.greetCooldown && a.dir !== b.dir) {
        a.greetCooldown = b.greetCooldown = now + 12000;
        a.pauseUntil = b.pauseUntil = now + 1400;
        say(a, GREET[Math.floor(Math.random() * GREET.length)]);
        setTimeout(() => say(b, GREET[Math.floor(Math.random() * GREET.length)]), 500);
      }
    }
  }
  raf = requestAnimationFrame(step);
}

function jump(c) {
  const fig = c.el.querySelector('.char-figure');
  fig.classList.remove('jump');
  void fig.offsetWidth;
  fig.classList.add('jump');
  setTimeout(() => fig.classList.remove('jump'), 700);
}

function say(c, text, ms = 2200) {
  const b = c.el.querySelector('.char-bubble');
  b.textContent = text;
  c.el.classList.add('talking');
  clearTimeout(c.sayTimer);
  c.sayTimer = setTimeout(() => c.el.classList.remove('talking'), ms);
}

const find = (id) => chars.find((c) => c.id === id);

/** 체크 성공: 해당 구성원 캐릭터가 튀어오르며 환호 */
export function cheer(memberId, text = '해냈다! 🙌') {
  const c = find(memberId);
  if (!c) return;
  c.pauseUntil = Date.now() + 1800;
  jump(c);
  setTimeout(() => jump(c), 650);
  c.el.classList.add('cheer');
  setTimeout(() => c.el.classList.remove('cheer'), 1800);
  say(c, text);
}

/** "괜찮아" — 캐릭터가 화면의 x 위치로 다가와 토닥 */
export function comfort(memberId, text, x) {
  const c = find(memberId) || chars[0];
  if (!c) return;
  if (x != null) c.target = Math.max(0, Math.min((layer.clientWidth || innerWidth) - 70, x - 35));
  setTimeout(() => {
    c.el.classList.add('pat');
    setTimeout(() => c.el.classList.remove('pat'), 1600);
    say(c, text, 3500);
  }, x != null ? 600 : 0);
}

/** 가족 모두 목표 달성: 다 같이 춤 */
export function dance(ms = 5000) {
  const width = layer?.clientWidth || innerWidth;
  chars.forEach((c, i) => {
    c.target = ((i + 1) / (chars.length + 1)) * width - 35;
    setTimeout(() => c.el.classList.add('dance'), 800);
    setTimeout(() => say(c, ['야호! 🎉', '최고의 가족!', '우리가 해냈다!', '🕺💃'][i % 4], 3000), 1000 + i * 250);
    setTimeout(() => c.el.classList.remove('dance'), ms);
  });
}
