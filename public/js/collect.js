// 모으기 방식: 포도송이 / 나무 키우기 / 스티커북 / 퍼즐 맞추기
// 점수 숫자 대신 "할 일 하나 = 하나 모으기"로 보여 주고, 개인 것과 가족이 함께 채우는 것을 그린다.
import { h } from './ui.js';

export const STYLES = {
  grape: {
    key: 'grape', name: '포도송이', icon: '🍇', unit: '알', coll: '송이', nav: '포도밭', gain: '🍇',
    desc: '할 일 하나에 포도 한 알. 송이를 다 채우면 보상!',
    family: '가족 구슬병', familyIcon: '🫙', familyDesc: '누가 하든 각자 색깔 구슬이 하나의 병에 모여요',
    got: (n) => `포도 ${n}알 땄어!`, left: (n) => `${n}알 더 따면 한 송이 완성!`,
    full: '포도 한 송이 완성!',
  },
  tree: {
    key: 'tree', name: '나무 키우기', icon: '🌳', unit: '번', coll: '그루', nav: '나무', gain: '💧', noNumbers: true,
    desc: '할 일을 하면 물을 줘요. 씨앗이 싹트고 자라서 열매를 맺어요. 숫자가 없어요.',
    family: '가족 나무', familyIcon: '🌳', familyDesc: '모두가 물을 주면 가족 나무에 각자 색깔 열매가 열려요',
    got: () => '물을 주며 키우고 있어요', left: () => '조금만 더 하면 열매가 열려요!',
    full: '나무에 열매가 열렸어요!',
  },
  sticker: {
    key: 'sticker', name: '스티커북', icon: '⭐', unit: '장', coll: '페이지', nav: '스티커북', gain: '⭐',
    desc: '할 일 하나에 스티커 한 장. 매번 다른 스티커를 모아요.',
    family: '가족 스티커판', familyIcon: '📋', familyDesc: '모두의 스티커가 한 판에 모여요',
    got: (n) => `스티커 ${n}장 모았어!`, left: (n) => `${n}장 더 붙이면 한 페이지 완성!`,
    full: '스티커 한 페이지 완성!',
  },
  puzzle: {
    key: 'puzzle', name: '퍼즐 맞추기', icon: '🧩', unit: '조각', coll: '퍼즐', nav: '퍼즐', gain: '🧩',
    desc: '할 일 하나에 퍼즐 한 조각. 내 사진이 조금씩 보여요.',
    family: '가족 사진 퍼즐', familyIcon: '🖼️', familyDesc: '모두가 맞춘 조각으로 가족 사진이 완성돼요',
    got: (n) => `퍼즐 ${n}조각 맞췄어!`, left: (n) => `${n}조각 더 맞추면 사진 완성!`,
    full: '퍼즐 완성!',
  },
};
export const styleOf = (settings) => STYLES[settings?.reward_style] || STYLES.grape;
export const collectionSize = (settings) => Math.max(1, Number(settings?.collection_size) || 20);

/** 보상 단계로 송이(모음)를 나눔. 마지막 보상 뒤로는 size 크기로 계속 이어짐 */
export function segments(count, tiers = [], size = 20) {
  const segs = [];
  let start = 0;
  for (const t of [...tiers].sort((a, b) => a.threshold - b.threshold)) {
    if (t.threshold > start) { segs.push({ start, size: t.threshold - start, reward: t.content }); start = t.threshold; }
  }
  while (start <= count) { segs.push({ start, size, reward: null }); start += size; }
  const current = segs.find((s) => count < s.start + s.size) || segs[segs.length - 1];
  return { segs, current, done: segs.filter((s) => s.start + s.size <= count) };
}

/** 한 구성원의 이번 기간 상태 */
export function progressOf(count, marks, tiers, settings) {
  const { segs, current, done } = segments(count, tiers, collectionSize(settings));
  const inSeg = Math.max(0, Math.min(current.size, count - current.start));
  return {
    count, segs, current, done, inSeg,
    left: current.size - inSeg,
    marks: (marks || '').slice(current.start, current.start + current.size),
  };
}

// ---------------- 작은 도우미
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}
function shuffled(n, seed) {
  const a = Array.from({ length: n }, (_, i) => i);
  const r = rng(seed);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const STICKERS = ['🌟', '🦄', '🐶', '🍓', '🚀', '🌈', '🐳', '🍩', '🦖', '🌻', '🎈', '🐱', '🍉', '⚽', '🐰', '🦋', '🍦', '🐧', '🌙', '🎀', '🐝', '🍒', '🦁', '🚗'];
const svg = (markup, cls = '') => h('div', { class: `coll-svg ${cls}`, html: markup });

// ---------------- 개인
/**
 * opts: { member, size, marks('0'/'1' 문자열, 채운 만큼), seed, mini, fresh(방금 채운 개수 강조) }
 */
export function renderPersonal(styleKey, opts) {
  const fn = { grape: grape, tree: tree, sticker: sticker, puzzle: puzzle }[styleKey] || grape;
  return h('div', { class: `coll coll-${styleKey} ${opts.mini ? 'mini' : ''}` }, fn(opts));
}

function grape({ size, marks, fresh = 0 }) {
  // 위가 넓고 아래로 좁아지는 송이 모양
  let k = Math.ceil((Math.sqrt(8 * size + 1) - 1) / 2);
  const rows = [];
  let left = size;
  while (left > 0) { const w = Math.min(k, left); rows.push(w); left -= w; k = Math.max(1, k - 1); }
  const r = 11;
  const dx = 2 * r + 2;
  const dy = 2 * r - 1;
  const maxW = Math.max(...rows);
  const W = maxW * dx + 8;
  const top = 30;
  const H = top + rows.length * dy + r + 8;
  let i = 0;
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="포도송이">`;
  out += `<path d="M${W / 2} ${top - r + 2} C ${W / 2 - 2} ${top - 14}, ${W / 2 + 4} ${top - 20}, ${W / 2 + 2} 4" stroke="#8b5a2b" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  out += `<path d="M${W / 2 + 2} 10 C ${W / 2 + 18} 0, ${W / 2 + 34} 6, ${W / 2 + 36} 16 C ${W / 2 + 22} 22, ${W / 2 + 10} 18, ${W / 2 + 2} 10 Z" fill="#4caf50"/>`;
  const filled = marks.length;
  rows.forEach((w, ri) => {
    const y = top + ri * dy;
    const x0 = (W - w * dx) / 2 + r + 1;
    for (let c = 0; c < w; c++) {
      const x = x0 + c * dx;
      if (i < filled) {
        const late = marks[i] === '1';
        const isNew = i >= filled - fresh;
        out += `<circle cx="${x}" cy="${y}" r="${r}" class="g-on ${late ? 'late' : ''} ${isNew ? 'pop' : ''}" style="animation-delay:${isNew ? 0 : 0}s"/><circle cx="${x - 3.5}" cy="${y - 4}" r="3" class="g-shine"/>`;
      } else {
        out += `<circle cx="${x}" cy="${y}" r="${r - 1}" class="g-off"/>`;
      }
      i++;
    }
  });
  return svg(`${out}</svg>`);
}

function tree({ size, marks }) {
  const f = size ? marks.length / size : 0;
  const stages = [[0, '🌰', '씨앗'], [0.01, '🌱', '새싹'], [0.25, '🌿', '쑥쑥'], [0.5, '🪴', '어린 나무'], [0.75, '🌳', '큰 나무'], [1, '🌳', '열매!']];
  let st = stages[0];
  for (const s of stages) if (f >= s[0]) st = s;
  const fruits = f >= 1;
  const scale = 0.55 + Math.min(1, f) * 0.45;
  return h('div', { class: 'tree-stage' },
    h('div', { class: 'tree-sky' },
      h('span', { class: 'tree-plant', style: { transform: `scale(${scale})` } }, st[1],
        fruits && h('span', { class: 'tree-fruits' }, h('i', {}, '🍎'), h('i', {}, '🍊'), h('i', {}, '🍎'))),
      f > 0 && f < 1 && h('span', { class: 'tree-drop' }, '💧')),
    h('div', { class: 'tree-ground' }),
    h('div', { class: 'tree-label' }, st[2]));
}

function sticker({ size, marks, seed = 1, fresh = 0 }) {
  const order = shuffled(STICKERS.length, seed);
  return h('div', { class: 'stk-grid', style: { '--cols': Math.min(size, size > 12 ? 6 : 4) } },
    Array.from({ length: size }, (_, i) => {
      if (i >= marks.length) return h('span', { class: 'stk off' });
      return h('span', { class: `stk on ${marks[i] === '1' ? 'late' : ''} ${i >= marks.length - fresh ? 'pop' : ''}` }, STICKERS[order[i % order.length]]);
    }));
}

function puzzleBoard({ size, revealed, picture, seed = 1, fresh = 0, cls = '' }) {
  const cols = Math.ceil(Math.sqrt(size * 1.3));
  const rows = Math.ceil(size / cols);
  const total = cols * rows;
  const show = revealed >= size ? total : Math.round((revealed / size) * total);
  const order = shuffled(total, seed);
  const open = new Set(order.slice(0, show));
  const newly = new Set(order.slice(Math.max(0, show - fresh), show));
  return h('div', { class: `pz ${cls}`, style: { '--cols': cols, '--rows': rows } },
    picture,
    h('div', { class: 'pz-cover' }, Array.from({ length: total }, (_, i) =>
      h('span', { class: `pz-cell ${open.has(i) ? 'open' : ''} ${newly.has(i) ? 'pop' : ''}` }))));
}

function puzzle({ size, marks, member, seed = 1, fresh = 0 }) {
  const picture = member?.character || member?.photo
    ? h('img', { class: 'pz-pic', src: member.character || member.photo, alt: '' })
    : h('div', { class: 'pz-pic pz-pic-emoji', style: { '--mc': member?.color || '#ff8a5c' } }, member?.emoji || '🙂');
  return puzzleBoard({ size, revealed: marks.length, picture, seed, fresh });
}

// ---------------- 가족 (함께 채우기)
/** opts: { marks(구성원 id 배열), capacity, members, photo, mini } */
export function renderFamily(styleKey, opts) {
  const fn = { grape: jar, tree: familyTree, sticker: board, puzzle: familyPuzzle }[styleKey] || jar;
  return h('div', { class: `coll coll-family coll-${styleKey} ${opts.mini ? 'mini' : ''}` }, fn(opts));
}
const colorOf = (members, id) => members.find((m) => m.id === id)?.color || '#999';

function jar({ marks, capacity, members }) {
  const cols = capacity > 80 ? 12 : capacity > 40 ? 10 : 8;
  const rows = Math.ceil(capacity / cols);
  const r = 7;
  const d = 2 * r + 1;
  const W = cols * d + 28;
  const H = rows * (d - 1) + 52;
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="가족 구슬병">`;
  out += `<rect x="${W / 2 - (cols * d) / 2 - 6}" y="4" width="${cols * d + 12}" height="14" rx="5" class="jar-lid"/>`;
  out += `<rect x="6" y="18" width="${W - 12}" height="${H - 22}" rx="22" class="jar-glass"/>`;
  marks.slice(0, capacity).forEach((id, i) => {
    const row = Math.floor(i / cols);
    const c = i % cols;
    const x = 14 + r + c * d + (row % 2 ? r / 2 : 0);
    const y = H - 12 - r - row * (d - 1);
    out += `<circle cx="${Math.min(x, W - 14 - r)}" cy="${y}" r="${r}" fill="${colorOf(members, id)}" class="marble"/><circle cx="${Math.min(x, W - 14 - r) - 2}" cy="${y - 2.5}" r="2" fill="#fff" opacity=".7"/>`;
  });
  out += `<rect x="14" y="26" width="8" height="${H - 50}" rx="4" fill="#fff" opacity=".25"/>`;
  return svg(`${out}</svg>`);
}

function familyTree({ marks, capacity, members }) {
  const W = 300;
  const H = 260;
  const cx = W / 2;
  const cy = 105;
  const R = 92;
  const f = capacity ? Math.min(1, marks.length / capacity) : 0;
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="가족 나무">`;
  out += `<ellipse cx="${cx}" cy="${H - 14}" rx="120" ry="12" class="ft-ground"/>`;
  out += `<path d="M${cx - 14} ${H - 16} C ${cx - 10} ${H - 80}, ${cx - 8} ${cy + 40}, ${cx - 4} ${cy + 10} L ${cx + 6} ${cy + 10} C ${cx + 10} ${cy + 40}, ${cx + 12} ${H - 80}, ${cx + 16} ${H - 16} Z" class="ft-trunk"/>`;
  out += `<circle cx="${cx}" cy="${cy}" r="${R * (0.75 + f * 0.25)}" class="ft-leaf"/><circle cx="${cx - 52}" cy="${cy + 22}" r="${48 * (0.7 + f * 0.3)}" class="ft-leaf"/><circle cx="${cx + 54}" cy="${cy + 20}" r="${50 * (0.7 + f * 0.3)}" class="ft-leaf"/>`;
  const n = Math.max(capacity, 1);
  for (let i = 0; i < n; i++) {
    const rr = R * 0.88 * Math.sqrt((i + 0.5) / n);
    const a = i * 2.39996;
    const x = cx + rr * Math.cos(a) * 1.12;
    const y = cy + 6 + rr * Math.sin(a) * 0.82;
    const fr = Math.max(3.2, Math.min(7, 70 / Math.sqrt(n)));
    if (i < marks.length) out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${fr}" fill="${colorOf(members, marks[i])}" class="fruit"/>`;
    else out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${fr * 0.45}" class="bud"/>`;
  }
  return svg(`${out}</svg>`);
}

function board({ marks, capacity, members }) {
  const cols = capacity > 80 ? 14 : capacity > 40 ? 10 : 8;
  return h('div', { class: 'board', style: { '--cols': cols } }, Array.from({ length: capacity }, (_, i) =>
    i < marks.length
      ? h('span', { class: 'board-cell on', style: { color: colorOf(members, marks[i]) } }, '★')
      : h('span', { class: 'board-cell' })));
}

function familyPuzzle({ marks, capacity, members, photo }) {
  const picture = photo
    ? h('img', { class: 'pz-pic', src: photo, alt: '' })
    : h('div', { class: 'pz-pic pz-pic-family' }, members.map((m) =>
      m.photo ? h('img', { src: m.photo, alt: '', style: { borderColor: m.color } }) : h('span', { style: { background: m.color } }, m.emoji || '🙂')));
  return puzzleBoard({ size: capacity, revealed: marks.length, picture, seed: 7, cls: 'pz-family' });
}

/** 지난 기간 기록용 아이콘 줄: 다 채운 송이 + 채우던 것 */
export function trophies(styleKey, count, tiers, settings) {
  const st = STYLES[styleKey] || STYLES.grape;
  const { done, current } = segments(count, tiers, collectionSize(settings));
  const part = count - current.start;
  const icon = { grape: '🍇', tree: '🌳', sticker: '📒', puzzle: '🧩' }[st.key];
  return h('span', { class: 'trophies' },
    done.map(() => h('span', { class: 'trophy' }, icon)),
    part > 0 && h('span', { class: 'trophy part', title: '채우는 중' }, st.key === 'tree' ? '🌱' : icon),
    !done.length && !part && h('span', { class: 'muted' }, '—'));
}
