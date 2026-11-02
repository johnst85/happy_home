// 체크 효과: 컨페티·불꽃놀이(캔버스), 효과음(WebAudio 합성, 파일 불필요), 이모티콘 팝업
import { h } from './ui.js';

export const fxConfig = { sound: true };

// ---------------- 캔버스 파티클
let canvas;
let ctx;
let parts = [];
let running = false;
const COLORS = ['#ff5d8f', '#ffb020', '#2ec27e', '#4f8cff', '#a66bff', '#ff7a45', '#13c2c2', '#fadb14'];

function ensureCanvas() {
  if (canvas) return;
  canvas = h('canvas', { class: 'fx-canvas', 'aria-hidden': 'true' });
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
}
function loop() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0);
  for (const p of parts) {
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life / 30);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === 'spark') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.shape === 'star') {
      ctx.font = `${p.size * 3}px serif`;
      ctx.fillText(p.char, -p.size, p.size);
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    ctx.restore();
  }
  if (parts.length) requestAnimationFrame(loop);
  else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
}
function kick() {
  if (!running) { running = true; requestAnimationFrame(loop); }
}
const rnd = (a, b) => a + Math.random() * (b - a);

export function confetti(x = innerWidth / 2, y = innerHeight / 2, n = 70, spread = 1) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) n = Math.min(n, 15);
  ensureCanvas();
  for (let i = 0; i < n; i++) {
    const a = rnd(-Math.PI, 0) * spread + (spread < 1 ? -Math.PI / 2 * (1 - spread) : 0);
    const s = rnd(4, 12);
    parts.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, g: 0.28, drag: 0.97,
      size: rnd(7, 12), rot: rnd(0, 6), vr: rnd(-0.3, 0.3), life: rnd(70, 120),
      color: COLORS[i % COLORS.length], shape: Math.random() < 0.12 ? 'star' : 'rect', char: ['⭐', '✨', '💖'][i % 3],
    });
  }
  kick();
}

export function firework(x, y) {
  ensureCanvas();
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const n = 46;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = rnd(3, 7);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.06, drag: 0.965, size: rnd(2, 3.5), rot: 0, vr: 0, life: rnd(60, 90), color, shape: 'spark' });
  }
  kick();
}

export function fireworksShow(count = 6, interval = 280) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => firework(rnd(innerWidth * 0.15, innerWidth * 0.85), rnd(innerHeight * 0.15, innerHeight * 0.5)), i * interval);
  }
}

export function rainConfetti(duration = 2500) {
  const end = Date.now() + duration;
  const tick = () => {
    confetti(rnd(0, innerWidth), -10, 8, 0.4);
    if (Date.now() < end) setTimeout(tick, 120);
  };
  tick();
}

// ---------------- 이모티콘 팝업 / 큰 배너
export function cheerPopup(text, x, y) {
  const el = h('div', { class: 'cheer-pop', style: { left: `${x}px`, top: `${y}px` } }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1400);
}

export function banner(title, sub = '', { emoji = '🎉', duration = 2600, big } = {}) {
  const el = h('div', { class: `fx-banner ${big ? 'big' : ''}` },
    h('div', { class: 'fx-banner-emoji' }, emoji),
    h('div', { class: 'fx-banner-title' }, title),
    sub && h('div', { class: 'fx-banner-sub' }, sub));
  document.body.append(el);
  el.addEventListener('click', () => el.remove());
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, duration);
}

// ---------------- 효과음 (WebAudio)
let ac;
function audio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
export function unlockAudio() { audio(); }

function tone(freq, start, dur, { type = 'sine', vol = 0.18 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function pop(start = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + 0.2);
}

export const sounds = {
  check() {
    if (!fxConfig.sound) return;
    pop(0);
    [784, 988, 1319].forEach((f, i) => tone(f, 0.05 + i * 0.07, 0.25, { type: 'triangle' }));
  },
  clear() {
    if (!fxConfig.sound) return;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, { type: 'square', vol: 0.08 }));
    [0.2, 0.45, 0.7].forEach((s) => pop(s));
  },
  family() {
    if (!fxConfig.sound) return;
    const mel = [523, 523, 784, 784, 880, 880, 784, 0, 698, 698, 659, 659, 587, 587, 523];
    mel.forEach((f, i) => f && tone(f, i * 0.16, 0.22, { type: 'triangle', vol: 0.15 }));
    mel.forEach((f, i) => f && i % 2 === 0 && tone(f / 2, i * 0.16, 0.3, { type: 'sine', vol: 0.08 }));
  },
  soft() {
    if (!fxConfig.sound) return;
    tone(660, 0, 0.3, { vol: 0.1 });
    tone(880, 0.12, 0.35, { vol: 0.08 });
  },
  chime() {
    if (!fxConfig.sound) return;
    [1047, 784, 1047, 784].forEach((f, i) => tone(f, i * 0.25, 0.5, { type: 'sine', vol: 0.15 }));
  },
  undo() {
    if (!fxConfig.sound) return;
    tone(500, 0, 0.12, { vol: 0.08 });
    tone(350, 0.08, 0.15, { vol: 0.08 });
  },
};
