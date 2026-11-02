// 가족 달력: 월/주/오늘 보기, 구성원 필터, 달성 도장, 일정 등록
import { get, post, put, del } from './api.js';
import { h, avatar, modal, formModal, errorToast, toast, ymd, parseYmd, addDays, dayNames, fmtDate } from './ui.js';
import { askParent, render as rerender } from './main.js';

const state = { view: null, cursor: null, filter: new Set() };
let seq = 0;

const ICONS = ['📌', '🥋', '⚽', '🎹', '🎨', '🏊', '📚', '🎂', '🏥', '🎈', '🍽️', '✈️', '🏫', '💼', '🛒', '🎮'];
const CHILD_ICONS = [['🥋', '태권도'], ['⚽', '축구'], ['🎹', '피아노'], ['🎨', '미술'], ['🏊', '수영'], ['📚', '학원'], ['🎂', '생일파티'], ['🏥', '병원'], ['🎈', '놀이'], ['🏫', '학교 행사']];

function range() {
  const c = state.cursor;
  if (state.view === 'day') return { start: c, end: c };
  if (state.view === 'week') {
    const s = addDays(c, -parseYmd(c).getDay());
    return { start: s, end: addDays(s, 6) };
  }
  const d = parseYmd(c);
  const first = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  const s = addDays(first, -parseYmd(first).getDay());
  return { start: s, end: addDays(s, 41) };
}

export function render(el, store) {
  if (!state.view) state.view = store.boot.settings.calendar_view === 'week' ? 'week' : 'month';
  if (!state.cursor) state.cursor = store.boot.today;
  const my = ++seq;
  const r = range();
  if (!el.querySelector('.calendar')) el.replaceChildren(h('div', { class: 'calendar' }, h('div', { class: 'loading' }, '불러오는 중…')));
  get(`/api/calendar?start=${r.start}&end=${r.end}`).then((data) => {
    if (my !== seq) return;
    el.replaceChildren(view(store, data, r));
  }).catch(errorToast);
}

const visible = (store, e) => !state.filter.size || e.members.some((id) => state.filter.has(id)) || (!e.members.length);
const eventColor = (store, e) => (e.members.length === 1 ? store.member(e.members[0])?.color : null);

function view(store, data, r) {
  const set = (patch) => { Object.assign(state, patch); rerender(); };
  const c = parseYmd(state.cursor);
  const step = state.view === 'month' ? null : state.view === 'week' ? 7 : 1;
  const move = (dir) => {
    if (step) set({ cursor: addDays(state.cursor, dir * step) });
    else set({ cursor: ymd(new Date(c.getFullYear(), c.getMonth() + dir, 1)) });
  };
  const title = state.view === 'month' ? `${c.getFullYear()}년 ${c.getMonth() + 1}월`
    : state.view === 'week' ? `${fmtDate(r.start, { month: 'long', day: 'numeric' })} ~ ${fmtDate(r.end, { month: 'long', day: 'numeric' })}`
      : fmtDate(state.cursor, { month: 'long', day: 'numeric', weekday: 'long' });

  const toolbar = h('div', { class: 'cal-toolbar' },
    h('div', { class: 'cal-nav' },
      h('button', { class: 'icon-btn', 'aria-label': '이전', onclick: () => move(-1) }, '◀'),
      h('h2', { class: 'cal-title' }, title),
      h('button', { class: 'icon-btn', 'aria-label': '다음', onclick: () => move(1) }, '▶'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => set({ cursor: store.boot.today }) }, '오늘')),
    h('div', { class: 'seg' }, [['month', '월간'], ['week', '주간'], ['day', '오늘']].map(([k, l]) =>
      h('button', { class: state.view === k ? 'on' : '', onclick: () => set({ view: k, cursor: k === 'day' && state.view === 'month' ? store.boot.today : state.cursor }) }, l))),
    h('button', { class: 'btn btn-primary', onclick: () => addEvent(store, state.view === 'day' ? state.cursor : store.boot.today) }, '+ 일정'));

  const filters = h('div', { class: 'chips cal-filter' },
    h('button', { class: `chip ${!state.filter.size ? 'on' : ''}`, onclick: () => set({ filter: new Set() }) }, '모두'),
    h('button', { class: 'chip', onclick: () => set({ filter: new Set(store.boot.members.filter((m) => m.role === 'child').map((m) => m.id)) }) }, '아이들만'),
    store.boot.members.map((m) => h('button', {
      class: `chip chip-member ${state.filter.has(m.id) ? 'on' : ''}`, style: { '--mc': m.color },
      onclick: () => { const f = new Set(state.filter); f.has(m.id) ? f.delete(m.id) : f.add(m.id); set({ filter: f }); },
    }, avatar(m, 'xs'), m.name)));

  const byDate = new Map();
  for (const e of data.events) {
    if (!visible(store, e)) continue;
    if (!byDate.has(e.occurs)) byDate.set(e.occurs, []);
    byDate.get(e.occurs).push(e);
  }
  const shownMembers = store.boot.members.filter((m) => !state.filter.size || state.filter.has(m.id));
  const stamps = (d) => {
    const s = data.stamps[d];
    if (!s) return null;
    const items = shownMembers.filter((m) => s[m.id] === 'star' || s[m.id] === 'rest');
    if (!items.length) return null;
    return h('div', { class: 'stamps' }, items.map((m) => h('span', { class: `stamp-dot ${s[m.id]}`, style: { '--mc': m.color }, title: `${m.name} ${s[m.id] === 'star' ? '하루 목표 달성' : '쉬어가기'}` }, s[m.id] === 'star' ? '★' : '🎫')));
  };
  const evChip = (e, full) => h('button', {
    class: `ev ${e.members.length > 1 ? 'ev-family' : ''}`,
    style: { '--mc': eventColor(store, e) || 'var(--accent)' },
    onclick: (ev) => { ev.stopPropagation(); showEvent(store, e); },
  }, h('span', { class: 'ev-icon' }, e.icon), !e.all_day && e.start_time && h('span', { class: 'ev-time' }, e.start_time), h('span', { class: 'ev-title' }, e.title),
  full && e.members.length > 0 && h('span', { class: 'ev-members' }, e.members.map((id) => store.member(id)).filter(Boolean).map((m) => avatar(m, 'xs'))));

  let body;
  if (state.view === 'month') {
    const month = c.getMonth();
    const cells = [];
    for (let d = r.start; d <= r.end; d = addDays(d, 1)) {
      const dd = parseYmd(d);
      const evs = byDate.get(d) || [];
      cells.push(h('div', {
        class: `cal-cell ${dd.getMonth() !== month ? 'other' : ''} ${d === store.boot.today ? 'today' : ''} ${dd.getDay() === 0 ? 'sun' : dd.getDay() === 6 ? 'sat' : ''}`,
        onclick: () => set({ view: 'day', cursor: d }),
      },
      h('div', { class: 'cal-date' }, dd.getDate()),
      stamps(d),
      h('div', { class: 'cal-evs' }, evs.slice(0, 3).map((e) => evChip(e)), evs.length > 3 && h('span', { class: 'more' }, `+${evs.length - 3}`))));
    }
    body = h('div', { class: 'cal-month' },
      dayNames.map((n, i) => h('div', { class: `cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}` }, n)),
      cells);
  } else if (state.view === 'week') {
    const cols = [];
    for (let d = r.start; d <= r.end; d = addDays(d, 1)) {
      const dd = parseYmd(d);
      const evs = byDate.get(d) || [];
      cols.push(h('div', { class: `cal-wcol ${d === store.boot.today ? 'today' : ''}` },
        h('button', { class: 'cal-whead', onclick: () => set({ view: 'day', cursor: d }) }, h('span', {}, dayNames[dd.getDay()]), h('b', {}, dd.getDate())),
        stamps(d),
        h('div', { class: 'cal-wevs' }, evs.map((e) => evChip(e, true)), !evs.length && h('span', { class: 'muted small' }, '—'))));
    }
    body = h('div', { class: 'cal-week' }, cols);
  } else {
    const evs = byDate.get(state.cursor) || [];
    const s = data.stamps[state.cursor] || {};
    body = h('div', { class: 'cal-day' },
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '오늘의 도장'),
        h('div', { class: 'day-stamps' }, shownMembers.map((m) => h('div', { class: 'day-stamp', style: { '--mc': m.color } }, avatar(m, 'md'), h('span', {}, m.name),
          h('b', {}, s[m.id] === 'star' ? '⭐ 달성!' : s[m.id] === 'rest' ? '🎫 쉬어가기' : s[m.id] === 'some' ? '🌱 도전 중' : '—'))))),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '일정'),
        evs.length ? h('div', { class: 'day-evs' }, evs.map((e) => evChip(e, true))) : h('p', { class: 'muted' }, '일정이 없어요'),
        h('button', { class: 'btn btn-light', onclick: () => addEvent(store, state.cursor) }, '+ 이 날에 일정 추가')));
  }
  return h('div', { class: 'calendar' }, toolbar, filters, body,
    h('div', { class: 'cal-legend muted small' }, '★ 하루 목표 달성 도장 · 🎫 쉬어가기권'));
}

function showEvent(store, e) {
  const names = e.members.map((id) => store.member(id)).filter(Boolean);
  const repeat = { none: '', weekly: '매주 반복', monthly: '매월 반복' }[e.repeat];
  modal((close) => h('div', { class: 'event-detail' },
    h('div', { class: 'event-detail-head' }, h('span', { class: 'big-emoji-sm' }, e.icon), h('h3', {}, e.title)),
    h('p', {}, fmtDate(e.occurs), ' · ', e.all_day ? '하루 종일' : `${e.start_time || ''}${e.end_time ? ` ~ ${e.end_time}` : ''}`, repeat && ` · ${repeat}`),
    names.length > 0 && h('div', { class: 'chips' }, names.map((m) => h('span', { class: 'chip chip-member on', style: { '--mc': m.color } }, avatar(m, 'xs'), m.name))),
    e.memo && h('p', { class: 'memo' }, e.memo),
    e.notify ? h('p', { class: 'muted' }, `⏰ ${e.notify_before}분 전 알림`) : null,
    h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', onclick: async () => { close(); editEvent(store, e); } }, '수정'))), { title: '일정' });
}

async function editEvent(store, e) {
  const childOk = store.boot.settings.child_events === '1' && e.members.length === 1 && store.member(e.members[0])?.role === 'child';
  if (!store.parent && !childOk && !(await askParent('일정 수정은 부모님 확인이 필요해요'))) return;
  eventForm(store, e);
}

async function addEvent(store, date) {
  if (store.parent) return eventForm(store, { date, members: store.memberId ? [store.memberId] : [] });
  if (store.boot.settings.child_events === '1' && store.member()?.role === 'child') return childForm(store, date);
  if (await askParent('일정 등록은 부모님 확인이 필요해요')) eventForm(store, { date, members: [] });
}

function eventForm(store, e) {
  const isEdit = !!e.id;
  formModal({
    title: isEdit ? '일정 수정' : '새 일정',
    ctx: { members: store.boot.members },
    values: {
      title: e.title || '', icon: e.icon || '📌', date: e.date, all_day: e.all_day || 0,
      start_time: e.start_time || '16:00', end_time: e.end_time || '', members: e.members || [],
      repeat: e.repeat || 'none', memo: e.memo || '', notify: e.notify ?? (store.boot.settings.event_alerts === '1' ? 1 : 0), notify_before: e.notify_before ?? 10,
    },
    fields: [
      { key: 'title', label: '제목', maxlength: 100 },
      { key: 'icon', label: '아이콘', type: 'emoji', options: ICONS },
      { key: 'date', label: isEdit && e.repeat !== 'none' ? '시작 날짜 (반복 기준)' : '날짜', type: 'date' },
      { key: 'all_day', label: '하루 종일', type: 'checkbox' },
      { key: 'start_time', label: '시작', type: 'time', when: (v) => !Number(v.all_day) },
      { key: 'end_time', label: '종료', type: 'time', when: (v) => !Number(v.all_day) },
      { key: 'members', label: '담당 (여럿 = 가족 일정)', type: 'members' },
      { key: 'repeat', label: '반복', type: 'select', options: [['none', '반복 안 함'], ['weekly', '매주'], ['monthly', '매월']] },
      { key: 'memo', label: '메모', type: 'textarea', rows: 2 },
      { key: 'notify', label: '시작 전 알림 (화면 배너 + 효과음)', type: 'checkbox' },
      { key: 'notify_before', label: '몇 분 전', type: 'number', min: 0, max: 1440, when: (v) => !!Number(v.notify) },
    ],
    onSave: async (v) => {
      if (isEdit) await put(`/api/events/${e.id}`, v);
      else await post('/api/events', v);
      toast('일정을 저장했어요 📅');
      rerender();
    },
    onDelete: isEdit ? async () => { await del(`/api/events/${e.id}`); rerender(); } : null,
  });
}

function childForm(store, date) {
  const me = store.member();
  const v = { icon: '🥋', title: '태권도', date, start_time: '16:00' };
  modal((close) => {
    const titleIn = h('input', { type: 'text', value: v.title, class: 'input-lg', oninput: (e) => { v.title = e.target.value; } });
    const grid = h('div', { class: 'child-icons' }, CHILD_ICONS.map(([icon, name]) => {
      const b = h('button', { class: `child-icon ${v.icon === icon ? 'on' : ''}`, onclick: () => {
        v.icon = icon; v.title = name; titleIn.value = name;
        grid.querySelectorAll('.child-icon').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      } }, h('span', {}, icon), h('small', {}, name));
      return b;
    }));
    return h('div', { class: 'child-form' },
      h('p', {}, avatar(me, 'sm'), ` ${me.name}의 일정을 만들어요`),
      grid,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, '이름'), titleIn),
      h('div', { class: 'row-2' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '📅 날짜'), h('input', { type: 'date', value: v.date, class: 'input-lg', onchange: (e) => { v.date = e.target.value; } })),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '⏰ 시간'), h('input', { type: 'time', value: v.start_time, class: 'input-lg', onchange: (e) => { v.start_time = e.target.value; } }))),
      h('div', { class: 'row-end' },
        h('button', { class: 'btn btn-ghost', onclick: close }, '취소'),
        h('button', { class: 'btn btn-primary btn-lg', onclick: async () => {
          try {
            await post('/api/events', { ...v, members: [me.id], notify: 0 });
            toast('일정을 만들었어요! 🎉');
            close();
            rerender();
          } catch (e) { errorToast(e); }
        } }, '만들기 ✨')));
  }, { title: `${dayNames[parseYmd(date).getDay()]}요일 일정 만들기` });
}
