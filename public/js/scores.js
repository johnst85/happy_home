// 모으기 현황 (포도밭 / 나무 / 스티커북 / 퍼즐)
// 다른 사람과 나란히 비교하지 않도록, 한 사람 것을 크게 보여 주고 가족은 함께 채우는 그림으로 보여 준다.
import { get, post } from './api.js';
import { h, avatar, errorToast } from './ui.js';
import { askParent, render as rerender } from './main.js';
import { styleOf, progressOf, renderPersonal, renderFamily, trophies, collectionSize } from './collect.js';

const state = { period: null, offset: 0, memberId: null };
let seq = 0;

export function render(el, store) {
  if (!state.period) state.period = store.boot.settings.reward_period || 'week';
  if (!store.member(state.memberId)) state.memberId = store.memberId || store.boot.members.find((m) => m.role === 'child')?.id || store.boot.members[0]?.id;
  const my = ++seq;
  if (!el.querySelector('.scores')) el.replaceChildren(h('div', { class: 'scores' }, h('div', { class: 'loading' }, '불러오는 중…')));
  Promise.all([
    get(`/api/scores?period=${state.period}&offset=${state.offset}`),
    get(`/api/scores/history?period=${state.period}&member_id=${state.memberId}&count=8`),
    get('/api/grants?limit=30'),
  ]).then(([sc, hist, grants]) => {
    if (my !== seq) return;
    el.replaceChildren(view(store, sc, hist, grants));
  }).catch(errorToast);
}

function view(store, sc, hist, grants) {
  const settings = store.boot.settings;
  const st = styleOf(settings);
  const tabs = [['day', '오늘'], ['week', '이번 주'], ['month', '이번 달']];
  const set = (patch) => { Object.assign(state, patch); rerender(); };
  const p = sc.period;

  const head = h('div', { class: 'scores-head' },
    h('div', { class: 'seg' }, tabs.map(([k, label]) => h('button', { class: state.period === k ? 'on' : '', onclick: () => set({ period: k, offset: 0 }) }, label))),
    h('div', { class: 'period-nav' },
      h('button', { class: 'icon-btn', 'aria-label': '이전 기간', onclick: () => set({ offset: state.offset - 1 }) }, '◀'),
      h('div', { class: 'period-label' }, h('b', {}, p.label), p.range && h('small', {}, p.range)),
      h('button', { class: 'icon-btn', 'aria-label': '다음 기간', disabled: state.offset >= 0, onclick: () => set({ offset: Math.min(0, state.offset + 1) }) }, '▶')));

  const faces = h('div', { class: 'face-tabs', role: 'tablist', 'aria-label': '누구 것을 볼까요?' },
    store.boot.members.map((m) => h('button', {
      class: `face-tab ${m.id === state.memberId ? 'on' : ''}`, role: 'tab', 'aria-selected': m.id === state.memberId ? 'true' : 'false',
      style: { '--mc': m.color }, onclick: () => set({ memberId: m.id }),
    }, avatar(m, 'sm'), h('span', {}, m.name))));

  // ---- 개인
  const m = store.member(state.memberId);
  const ms = sc.members.find((x) => x.id === state.memberId) || { points: 0, marks: '', rewards: [] };
  const tiers = ms.rewards.map((r) => ({ threshold: r.threshold, content: r.content }));
  const pr = progressOf(ms.points, ms.marks, tiers, settings);
  const nextReward = pr.current.reward;
  const personal = h('div', { class: 'card collect-card', style: { '--mc': m.color } },
    h('div', { class: 'collect-top' }, avatar(m, 'lg'),
      h('div', {},
        h('div', { class: 'score-name' }, `${m.name}의 ${st.nav}`),
        h('div', { class: 'collect-msg' }, ms.points ? st.got(ms.points) : `${st.icon} 이제 시작해 볼까?`))),
    h('div', { class: 'collect-visual' }, renderPersonal(st.key, { member: m, size: pr.current.size, marks: pr.marks, seed: m.id * 31 + pr.done.length + 1 })),
    h('div', { class: 'collect-foot' },
      pr.inSeg > 0 && pr.left > 0 && h('div', { class: 'collect-left' }, st.left(pr.left)),
      nextReward ? h('div', {}, '🎁 이번에 채우면: ', h('b', {}, nextReward)) : !ms.rewards.length && h('div', { class: 'muted small' }, '이 기간에 정해 둔 보상은 없어요. 모으는 것만으로도 멋져요!')),
    pr.done.length > 0 && h('div', { class: 'collect-done' },
      h('div', { class: 'card-title' }, `${st.icon} 다 채운 ${st.coll}`),
      pr.done.map((sg, i) => {
        const r = ms.rewards.find((x) => x.threshold === sg.start + sg.size);
        return h('div', { class: 'grant-row' },
          h('span', {}, `${st.icon} ${i + 1}번째 ${st.coll}`, r ? ` · 🏅 ${r.content}` : ''),
          r?.grant ? payButton(r.grant) : r && sc.finished ? null : r && h('span', { class: 'muted small' }, '기간이 끝나면 보상 정리'));
      })));

  const history = h('div', { class: 'card history' },
    h('div', { class: 'card-title' }, `📒 ${m.name}의 지난 기록`),
    h('ul', { class: 'hist-list' }, trimHistory(hist).map((x) => h('li', {},
      h('span', { class: 'hist-label' }, x.offset === 0 ? x.label : x.range || x.label),
      trophies(st.key, x.units, tiers, settings),
      !st.noNumbers && h('span', { class: 'muted small' }, `${x.units}${st.unit}`)))),
    h('p', { class: 'muted small' }, '다른 사람과 비교하지 않고, 나의 지난 기록만 보여줘요 🌱'));

  // ---- 가족
  const fam = sc.family;
  const fnext = fam.rewards.find((r) => r.threshold > fam.points) || fam.rewards[fam.rewards.length - 1];
  const capacity = fnext ? Math.max(fnext.threshold, Math.min(fam.points, fnext.threshold)) : collectionSize(settings) * Math.max(1, store.boot.members.length);
  const famCard = h('div', { class: 'card family-total' },
    h('div', { class: 'card-title' }, `${st.familyIcon} ${st.family}`),
    h('p', { class: 'muted small' }, st.familyDesc),
    renderFamily(st.key, { marks: fam.marks.slice(0, capacity), capacity, members: store.boot.members, photo: settings.family_photo }),
    h('div', { class: 'family-msg' },
      fnext
        ? (fam.points >= fnext.threshold ? `🎉 다 채웠어요! ${fnext.content}` : st.noNumbers ? `함께 조금만 더! 다 채우면 ${fnext.content}` : `함께 ${fam.points}${st.unit} 모았어요 · 다 채우면 ${fnext.content}`)
        : '가족 목표가 아직 없어요. 설정 › 보상에서 만들 수 있어요.'),
    h('div', { class: 'legend' }, store.boot.members.map((x) => h('span', {}, h('i', { style: { background: x.color } }), x.name))),
    ...fam.rewards.filter((r) => r.grant).map((r) => h('div', { class: 'grant-row' }, h('span', {}, `🏅 ${r.content}`), payButton(r.grant))));

  const grantsCard = h('div', { class: 'card history' },
    h('div', { class: 'card-title' }, '🎁 받은 보상 기록'),
    grants.length
      ? h('ul', { class: 'grant-history' }, grants.map((g) => {
        const gm = store.member(g.member_id);
        return h('li', {},
          gm ? avatar(gm, 'sm') : h('span', { class: 'avatar avatar-sm avatar-all' }, '👨‍👩‍👧‍👦'),
          h('div', { class: 'grow' }, h('b', {}, gm ? gm.name : '우리 가족'), ` · ${g.content}`,
            h('div', { class: 'muted small' }, `${g.period_start} ~ ${g.period_end}`)),
          payButton(g));
      }))
      : h('p', { class: 'muted' }, '기간이 끝나면 자동으로 정리해서 여기에 보여줘요.'));

  return h('div', { class: 'scores' }, head, faces,
    h('div', { class: 'scores-grid' },
      h('div', { class: 'scores-main' }, personal, history),
      h('div', { class: 'scores-side' }, famCard, grantsCard)));
}

/** 앱을 쓰기 전(아무것도 없는 오래된 기간)은 숨김 */
function trimHistory(hist) {
  let last = 0;
  hist.forEach((x, i) => { if (x.units > 0) last = i; });
  return hist.slice(0, Math.max(1, last + 1));
}

function payButton(g) {
  if (g.granted) return h('span', { class: 'tag tag-done' }, `지급 완료 ${g.granted_at ? g.granted_at.slice(5) : ''}`);
  return h('button', { class: 'btn btn-sm btn-light', onclick: async () => {
    if (!(await askParent('지급 완료 표시'))) return;
    try { await post(`/api/grants/${g.id}/pay`, {}); rerender(); } catch (e) { errorToast(e); }
  } }, '지급 완료로 표시');
}
