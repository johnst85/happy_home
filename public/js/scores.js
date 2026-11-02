// 점수 현황: 구성원별 진행도, 가족 합계, 추이 그래프, 지난 기간·보상 기록
import { get, post } from './api.js';
import { h, avatar, errorToast } from './ui.js';
import { askParent, render as rerender } from './main.js';

const state = { period: null, offset: 0, trend: 'days' };
let seq = 0;

export function render(el, store) {
  if (!state.period) state.period = store.boot.settings.reward_period || 'week';
  const my = ++seq;
  if (!el.querySelector('.scores')) el.replaceChildren(h('div', { class: 'scores' }, h('div', { class: 'loading' }, '불러오는 중…')));
  Promise.all([
    get(`/api/scores?period=${state.period}&offset=${state.offset}`),
    get(`/api/scores/trend?mode=${state.trend}`),
    get('/api/grants?limit=30'),
  ]).then(([sc, tr, grants]) => {
    if (my !== seq) return;
    el.replaceChildren(view(store, sc, tr, grants));
  }).catch(errorToast);
}

function bar(value, max, color) {
  const p = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return h('div', { class: 'bar bar-lg' }, h('div', { class: 'bar-fill', style: { width: `${p}%`, background: color } }));
}

function view(store, sc, tr, grants) {
  const tabs = [['day', '오늘'], ['week', '이번 주'], ['month', '이번 달']];
  const set = (patch) => { Object.assign(state, patch); rerender(); };
  const p = sc.period;

  const head = h('div', { class: 'scores-head' },
    h('div', { class: 'seg' }, tabs.map(([k, label]) => h('button', { class: state.period === k ? 'on' : '', onclick: () => set({ period: k, offset: 0 }) }, label))),
    h('div', { class: 'period-nav' },
      h('button', { class: 'icon-btn', 'aria-label': '이전 기간', onclick: () => set({ offset: state.offset - 1 }) }, '◀'),
      h('div', { class: 'period-label' }, h('b', {}, p.label), p.range && h('small', {}, p.range)),
      h('button', { class: 'icon-btn', 'aria-label': '다음 기간', disabled: state.offset >= 0, onclick: () => set({ offset: Math.min(0, state.offset + 1) }) }, '▶')));

  const cards = h('div', { class: 'score-cards' }, sc.members.map((ms) => {
    const m = store.member(ms.id);
    if (!m) return null;
    const tiers = ms.rewards;
    const next = tiers.find((r) => r.threshold > ms.points) || tiers[tiers.length - 1];
    const rate = ms.scheduled ? Math.round((ms.done / ms.scheduled) * 100) : 0;
    return h('div', { class: 'card score-card', style: { '--mc': m.color } },
      h('div', { class: 'score-top' }, avatar(m, 'lg'),
        h('div', {}, h('div', { class: 'score-name' }, m.name), h('div', { class: 'score-points' }, h('b', {}, ms.points), '점'))),
      next
        ? h('div', { class: 'score-next' },
          h('div', { class: 'row-between' }, h('span', {}, ms.points >= next.threshold ? `🎉 ${next.content}` : `다음 보상: ${next.content}`), h('span', { class: 'muted' }, `${ms.points} / ${next.threshold}점`)),
          bar(ms.points, next.threshold, m.color),
          tiers.length > 1 && h('div', { class: 'tiers' }, tiers.map((r) => h('span', { class: `tier ${ms.points >= r.threshold ? 'on' : ''}`, title: r.content }, ms.points >= r.threshold ? '🏅' : '○', ` ${r.threshold}`))))
        : h('div', { class: 'muted score-next' }, '이 기간의 보상이 아직 없어요'),
      h('div', { class: 'score-rate' },
        h('span', {}, '달성률'), h('b', {}, `${rate}%`), h('small', { class: 'muted' }, `(${ms.done}/${ms.scheduled}개)`)),
      ...tiers.filter((r) => r.grant).map((r) => grantRow(r.grant, r.content)));
  }));

  const fam = sc.family;
  const fnext = fam.rewards.find((r) => r.threshold > fam.points) || fam.rewards[fam.rewards.length - 1];
  const famCard = h('div', { class: 'card family-total' },
    h('div', { class: 'card-title' }, '👨‍👩‍👧‍👦 가족 합계'),
    h('div', { class: 'family-total-num' }, h('b', {}, fam.points), '점'),
    fnext
      ? [h('div', { class: 'row-between' }, h('span', {}, fam.points >= fnext.threshold ? `🎉 달성! ${fnext.content}` : `목표: ${fnext.content}`), h('span', { class: 'muted' }, `${fam.points} / ${fnext.threshold}`)),
        bar(fam.points, fnext.threshold, 'linear-gradient(90deg,#ff5d8f,#ffb020,#2ec27e,#4f8cff)'),
        h('div', { class: 'family-stack' }, sc.members.map((ms) => {
          const m = store.member(ms.id);
          const w = fam.points ? (ms.points / Math.max(fam.points, fnext.threshold)) * 100 : 0;
          return m && w > 0 ? h('span', { style: { width: `${w}%`, background: m.color }, title: `${m.name} ${ms.points}점` }) : null;
        })),
        ...fam.rewards.filter((r) => r.grant).map((r) => grantRow(r.grant, r.content))]
      : h('div', { class: 'muted' }, '가족 목표가 아직 없어요. 설정 › 보상에서 만들 수 있어요.'),
    h('p', { class: 'muted small' }, '순위는 매기지 않아요. 모두의 점수가 모여 가족 목표가 돼요 💕'));

  const chart = h('div', { class: 'card trend' },
    h('div', { class: 'row-between' },
      h('div', { class: 'card-title' }, '📈 점수 추이'),
      h('div', { class: 'seg seg-sm' },
        h('button', { class: state.trend === 'days' ? 'on' : '', onclick: () => set({ trend: 'days' }) }, '최근 7일'),
        h('button', { class: state.trend === 'weeks' ? 'on' : '', onclick: () => set({ trend: 'weeks' }) }, '최근 4주'))),
    lineChart(tr, store));

  const history = h('div', { class: 'card history' },
    h('div', { class: 'card-title' }, '🎁 받은 보상 기록'),
    grants.length
      ? h('ul', { class: 'grant-history' }, grants.map((g) => {
        const m = store.member(g.member_id);
        return h('li', {},
          m ? avatar(m, 'sm') : h('span', { class: 'avatar avatar-sm avatar-all' }, '👨‍👩‍👧‍👦'),
          h('div', { class: 'grow' }, h('b', {}, m ? m.name : '우리 가족'), ` · ${g.content}`,
            h('div', { class: 'muted small' }, `${g.period_start} ~ ${g.period_end} · ${g.points}점`)),
          payButton(g));
      }))
      : h('p', { class: 'muted' }, '기간이 끝나면 자동으로 정산해서 여기에 보여줘요.'));

  return h('div', { class: 'scores' }, head,
    h('div', { class: 'scores-grid' }, h('div', { class: 'scores-main' }, cards, chart), h('div', { class: 'scores-side' }, famCard, history)));
}

function grantRow(g, content) {
  return h('div', { class: 'grant-row' }, h('span', {}, `🏅 ${content}`), payButton(g));
}

function payButton(g) {
  if (g.granted) return h('span', { class: 'tag tag-done' }, `지급 완료 ${g.granted_at ? g.granted_at.slice(5) : ''}`);
  return h('button', { class: 'btn btn-sm btn-light', onclick: async () => {
    if (!(await askParent('지급 완료 표시'))) return;
    try { await post(`/api/grants/${g.id}/pay`, {}); rerender(); } catch (e) { errorToast(e); }
  } }, '지급 완료로 표시');
}

function lineChart(tr, store) {
  const W = 640;
  const H = 240;
  const pad = { l: 36, r: 16, t: 16, b: 32 };
  const n = tr.labels.length;
  const all = Object.values(tr.series).flat();
  const max = Math.max(10, ...all);
  const nice = Math.ceil(max / 10) * 10;
  const x = (i) => pad.l + (n === 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v) => H - pad.b - (v / nice) * (H - pad.t - pad.b);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="구성원별 점수 추이">`;
  for (let i = 0; i <= 4; i++) {
    const v = (nice / 4) * i;
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${Math.round(v)}</text>`;
  }
  tr.labels.forEach((l, i) => { svg += `<text x="${x(i)}" y="${H - 10}" class="axis" text-anchor="middle">${l}</text>`; });
  for (const [id, vals] of Object.entries(tr.series)) {
    const m = store.member(Number(id));
    if (!m) continue;
    const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    svg += `<path d="${d}" fill="none" stroke="${m.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    vals.forEach((v, i) => { svg += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${m.color}"><title>${m.name} ${tr.labels[i]}: ${v}점</title></circle>`; });
  }
  svg += '</svg>';
  const legend = h('div', { class: 'legend' }, store.boot.members.map((m) => h('span', {}, h('i', { style: { background: m.color } }), m.name)));
  return h('div', {}, h('div', { class: 'chart-wrap', html: svg }), legend);
}
