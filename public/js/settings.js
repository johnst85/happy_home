// 설정 탭 (부모 PIN 잠금)
import { get, post, put, del, api, auth } from './api.js';
import { h, avatar, form, formModal, confirmBox, errorToast, toast, pickImage, dayNames } from './ui.js';
import { askParent, reloadBoot, reloadToday, render as rerender, mediaDevice } from './main.js';
import { sounds } from './fx.js';
import { STYLES, styleOf, renderPersonal, renderFamily } from './collect.js';

const SECTIONS = [
  ['collect', '🍇', '모으기 방식'],
  ['members', '👨‍👩‍👧‍👦', '구성원'],
  ['tasks', '✅', '할 일'],
  ['slots', '⏰', '시간대'],
  ['rewards', '🎁', '보상'],
  ['okay', '🤗', '"괜찮아"'],
  ['calendar', '📅', '달력'],
  ['media', '🎵', '미디어'],
  ['display', '🎨', '화면'],
  ['security', '🛡️', '보안·관리'],
];
const state = { section: 'collect' };
const TASK_ICONS = ['👋', '💧', '🦠', '🍊', '🪥', '👕', '🧦', '🎒', '🧺', '🧸', '📖', '💬', '🛏️', '🍽️', '🧼', '🙏', '🏃', '🎹', '✏️', '🌱'];
const MEMBER_EMOJI = ['👩', '👨', '🧒', '👧', '👦', '👶', '👵', '👴', '🐶', '🐱', '🦊', '🐼', '🐯', '🐰'];
const COLORS = ['#ff6b8b', '#4f8cff', '#ffb020', '#2ec27e', '#a66bff', '#ff7a45', '#13c2c2', '#e64980'];

async function refresh() {
  await reloadBoot();
  await reloadToday();
  rerender();
}
const daysText = (days) => (days.length === 7 ? '매일' : days.join(',') === '1,2,3,4,5' ? '평일' : days.map((d) => dayNames[d]).join(''));

export function render(el, store) {
  if (!store.parent) {
    el.replaceChildren(h('div', { class: 'locked' },
      h('div', { class: 'big-emoji' }, '🔒'),
      h('h2', {}, '설정은 부모님만 열 수 있어요'),
      h('button', { class: 'btn btn-primary btn-lg', onclick: () => askParent() }, '부모 PIN 입력'),
      h('p', { class: 'muted small' }, '처음 PIN은 0000 이에요. 보안·관리에서 꼭 바꿔 주세요.')));
    return;
  }
  const nav = h('nav', { class: 'set-nav' }, SECTIONS.map(([k, icon, label]) =>
    h('button', { class: state.section === k ? 'on' : '', onclick: () => { state.section = k; rerender(); } }, h('span', {}, icon), label)));
  const body = h('div', { class: 'set-body' });
  el.replaceChildren(h('div', { class: 'settings' }, nav, body));
  const fn = { collect, members, tasks, slots, rewards, okay, calendar, media, display, security }[state.section];
  Promise.resolve(fn(body, store)).catch(errorToast);
}

function section(title, desc, ...children) {
  return h('section', { class: 'set-section' }, h('div', { class: 'set-head' }, h('h2', {}, title), desc && h('p', { class: 'muted' }, desc)), ...children);
}

/** 일반 설정값 폼 */
function settingsForm(store, fields, { transform } = {}) {
  const values = {};
  for (const f of fields) values[f.key] = store.boot.settings[f.key];
  const f = form(fields, values);
  return h('div', { class: 'card' }, f.el, h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', onclick: async () => {
    try {
      await put('/api/settings', transform ? transform(f.values) : f.values);
      toast('저장했어요 ✅');
      await refresh();
    } catch (e) { errorToast(e); }
  } }, '저장')));
}

// ---------------- 모으기 방식
function collect(body, store) {
  const s = store.boot.settings;
  const cur = styleOf(s).key;
  const sample = store.boot.members.find((m) => m.role === 'child') || store.boot.members[0];
  const choose = async (key) => {
    try {
      await put('/api/settings', { reward_style: key });
      toast(`${STYLES[key].icon} ${STYLES[key].name}(으)로 바꿨어요`);
      await refresh();
    } catch (e) { errorToast(e); }
  };
  const cards = h('div', { class: 'style-cards', role: 'radiogroup', 'aria-label': '모으기 방식' }, Object.values(STYLES).map((st) =>
    h('button', { class: `style-card ${st.key === cur ? 'on' : ''}`, role: 'radio', 'aria-checked': st.key === cur ? 'true' : 'false', onclick: () => choose(st.key) },
      h('div', { class: 'style-card-head' }, h('span', { class: 'style-card-icon' }, st.icon), h('b', {}, st.name), st.key === cur && h('span', { class: 'tag tag-done' }, '사용 중')),
      h('div', { class: 'style-preview' },
        renderPersonal(st.key, { member: sample, size: 12, marks: '00000001', seed: 3, mini: true }),
        renderFamily(st.key, { marks: store.boot.members.flatMap((m) => [m.id, m.id, m.id]).slice(0, 10), capacity: 20, members: store.boot.members, photo: s.family_photo, mini: true })),
      h('p', { class: 'muted small' }, st.desc),
      h('p', { class: 'small' }, h('b', {}, '가족: '), st.family, ' — ', st.familyDesc))));

  const familyPhoto = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, '🖼️ 가족 사진 (퍼즐 맞추기용)'),
    h('p', { class: 'muted small' }, '"퍼즐 맞추기"에서 가족이 함께 맞추는 그림이에요. 없으면 구성원 얼굴을 모아서 보여줘요.'),
    s.family_photo && h('img', { class: 'family-photo-preview', src: s.family_photo, alt: '가족 사진' }),
    h('div', { class: 'row-wrap' },
      h('button', { class: 'btn btn-light', onclick: async () => {
        const dataUrl = await pickImage({ size: 900, square: false });
        if (!dataUrl) return;
        try { await post('/api/family-photo', { dataUrl }); toast('가족 사진을 올렸어요 📸'); await refresh(); } catch (e) { errorToast(e); }
      } }, '📷 가족 사진 올리기'),
      s.family_photo && h('button', { class: 'btn btn-ghost', onclick: async () => {
        try { await post('/api/family-photo', { dataUrl: null }); await refresh(); } catch (e) { errorToast(e); }
      } }, '지우기')));

  body.append(section('모으기 방식', '숫자 점수 대신 할 일 하나를 할 때마다 하나씩 모아요. 모든 할 일은 똑같이 1개, 늦게 해도 똑같이 1개(연한 색)예요. 언제 바꿔도 모은 기록은 그대로예요.',
    cards,
    settingsForm(store, [
      { key: 'collection_size', label: `보상이 없을 때 한 ${styleOf(s).coll} 크기 (부모, 또는 마지막 보상 이후)`, type: 'number', min: 5, max: 100 },
    ]),
    familyPhoto));
}

// ---------------- 구성원
function members(body, store) {
  const list = store.boot.members;
  const edit = (m = {}) => formModal({
    title: m.id ? `${m.name} 수정` : '구성원 추가',
    values: { name: m.name || '', role: m.role || 'child', emoji: m.emoji || '🧒', color: m.color || COLORS[list.length % COLORS.length] },
    fields: [
      { key: 'name', label: '이름', maxlength: 30 },
      { key: 'role', label: '역할', type: 'select', options: [['child', '아이'], ['parent', '부모']] },
      { key: 'emoji', label: '캐릭터 이모지 (사진이 없을 때)', type: 'emoji', options: MEMBER_EMOJI },
      { key: 'color', label: '대표 색상 (달력·그래프)', type: 'color' },
    ],
    onSave: async (v) => { m.id ? await put(`/api/members/${m.id}`, v) : await post('/api/members', v); await refresh(); },
    onDelete: m.id ? async () => { await del(`/api/members/${m.id}`); await refresh(); } : null,
  });
  const upload = async (m, kind) => {
    const dataUrl = await pickImage(kind === 'character' ? { size: 360, square: false } : { size: 320 });
    if (!dataUrl) return;
    try { await post(`/api/members/${m.id}/photo`, { kind, dataUrl }); toast('사진을 올렸어요 📸'); await refresh(); } catch (e) { errorToast(e); }
  };
  const move = async (i, d) => {
    const ids = list.map((m) => m.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await put('/api/members-order', { ids });
    await refresh();
  };
  body.append(section('구성원', '이름, 역할, 프로필 사진, 대표 색상을 관리해요.',
    h('div', { class: 'list' }, list.map((m, i) => h('div', { class: 'list-row', style: { '--mc': m.color } },
      avatar(m, 'md'),
      h('div', { class: 'grow' }, h('b', {}, m.name), ' ', h('span', { class: 'tag' }, m.role === 'parent' ? '부모' : '아이'),
        h('div', { class: 'muted small' }, h('span', { class: 'color-dot', style: { background: m.color } }), ` ${m.color}`, m.character ? ' · 캐릭터 이미지 있음' : '', m.has_face ? ' · 얼굴 등록됨' : '')),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-sm btn-light', onclick: () => upload(m, 'photo') }, '📷 사진'),
        h('button', { class: 'btn btn-sm btn-light', title: '미리 그린 캐릭터 이미지(투명 PNG 권장)', onclick: () => upload(m, 'character') }, '🧸 캐릭터'),
        (m.photo || m.character) && h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
          for (const kind of ['photo', 'character']) if (m[kind]) await post(`/api/members/${m.id}/photo`, { kind, dataUrl: null });
          await refresh();
        } }, '사진 지우기'),
        h('button', { class: 'icon-btn', 'aria-label': '위로', onclick: () => move(i, -1) }, '↑'),
        h('button', { class: 'icon-btn', 'aria-label': '아래로', onclick: () => move(i, 1) }, '↓'),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => edit(m) }, '수정'))))),
    h('button', { class: 'btn btn-primary', onclick: () => edit() }, '+ 구성원 추가'),
    h('div', { class: 'card note' }, h('b', {}, '🙂 안면인식 등록'), h('p', { class: 'muted' },
      '안면인식 체크(여러 각도 3~5장 등록)는 4단계 기능으로, HTTPS 구성 후 추가될 예정이에요. 지금은 얼굴을 터치해서 전환해요.'))));
}

// ---------------- 할 일
function tasks(body, store) {
  const { tasks: list, slots, members: ms } = store.boot;
  const edit = (t = {}) => formModal({
    title: t.id ? '할 일 수정' : '할 일 추가',
    ctx: { members: ms },
    values: {
      name: t.name || '', icon: t.icon || '✅', points: t.points ?? 1, slot_id: t.slot_id ?? slots[0]?.id ?? '',
      deadline: t.deadline || '', days: t.days || [0, 1, 2, 3, 4, 5, 6], assignees: t.assignees || [], is_family: t.is_family || 0, active: t.active ?? 1,
    },
    fields: [
      { key: 'name', label: '이름', maxlength: 60 },
      { key: 'icon', label: '아이콘', type: 'emoji', options: TASK_ICONS },
      { key: 'points', label: `모으는 개수 (보통 1 — 모든 할 일을 똑같이 하는 걸 권해요)`, type: 'number', min: 1, max: 5 },
      { key: 'slot_id', label: '시간대', type: 'select', options: [...slots.map((s) => [s.id, `${s.name} (${s.start_time}~${s.end_time})`]), ['', '언제든']] },
      { key: 'deadline', label: '마감 시각 (지나면 "괜찮아" + 늦은 체크)', type: 'time' },
      { key: 'days', label: '반복 요일', type: 'days' },
      { key: 'assignees', label: '담당 구성원 (여러 명 가능)', type: 'members' },
      { key: 'is_family', label: '가족 공동 할 일 (누가 해도 함께 완료)', type: 'checkbox' },
      { key: 'active', label: '사용', type: 'checkbox' },
    ],
    onSave: async (v) => { t.id ? await put(`/api/tasks/${t.id}`, v) : await post('/api/tasks', v); await refresh(); },
    onDelete: t.id ? async () => { await del(`/api/tasks/${t.id}`); await refresh(); } : null,
  });
  const ids = list.map((t) => t.id);
  const move = async (id, d) => {
    const i = ids.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await put('/api/tasks-order', { ids });
    await refresh();
  };
  const groups = [...slots.map((s) => [s, list.filter((t) => t.slot_id === s.id)]), [{ id: 0, name: '언제든' }, list.filter((t) => !slots.some((s) => s.id === t.slot_id))]]
    .filter(([, l]) => l.length);
  body.append(section('할 일', '구성원별 할 일, 시간대·마감, 반복 요일을 정해요. ↑↓로 순서를 바꿔요.',
    h('button', { class: 'btn btn-primary', onclick: () => edit() }, '+ 할 일 추가'),
    groups.map(([s, l]) => h('div', { class: 'set-group' }, h('h3', {}, s.name),
      h('div', { class: 'list' }, l.map((t) => h('div', { class: `list-row ${t.active ? '' : 'inactive'}` },
        h('span', { class: 'list-icon' }, t.icon),
        h('div', { class: 'grow' },
          h('b', {}, t.name), ' ', t.is_family ? h('span', { class: 'tag tag-family' }, '가족 공동') : null, !t.active && h('span', { class: 'tag' }, '꺼짐'),
          h('div', { class: 'muted small' }, `${styleOf(store.boot.settings).gain}${t.points > 1 ? `×${t.points}` : ''} · ${t.deadline ? `~${t.deadline}` : '마감 없음'} · ${daysText(t.days)}`)),
        h('span', { class: 'avatars' }, t.assignees.map((id) => store.member(id)).filter(Boolean).map((m) => avatar(m, 'xs'))),
        h('div', { class: 'row-actions' },
          h('button', { class: 'icon-btn', 'aria-label': '위로', onclick: () => move(t.id, -1) }, '↑'),
          h('button', { class: 'icon-btn', 'aria-label': '아래로', onclick: () => move(t.id, 1) }, '↓'),
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => edit(t) }, '수정')))))))));
}

// ---------------- 시간대
function slots(body, store) {
  const edit = (s = {}) => formModal({
    title: s.id ? '시간대 수정' : '시간대 추가',
    values: { name: s.name || '', start_time: s.start_time || '06:00', end_time: s.end_time || '09:00' },
    fields: [
      { key: 'name', label: '이름 (예: 아침)', maxlength: 30 },
      { key: 'start_time', label: '시작', type: 'time' },
      { key: 'end_time', label: '끝', type: 'time' },
    ],
    onSave: async (v) => { s.id ? await put(`/api/slots/${s.id}`, v) : await post('/api/slots', v); await refresh(); },
    onDelete: s.id ? async () => { await del(`/api/slots/${s.id}`); await refresh(); } : null,
  });
  body.append(section('시간대', '해당 시간이 되면 그 시간대의 할 일이 화면 맨 위로 올라와요.',
    h('div', { class: 'list' }, store.boot.slots.map((s) => h('div', { class: 'list-row' },
      h('span', { class: 'list-icon' }, '⏰'),
      h('div', { class: 'grow' }, h('b', {}, s.name), h('div', { class: 'muted small' }, `${s.start_time} ~ ${s.end_time}`)),
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => edit(s) }, '수정')))),
    h('button', { class: 'btn btn-primary', onclick: () => edit() }, '+ 시간대 추가')));
}

// ---------------- 보상
async function rewards(body, store) {
  const list = await get('/api/rewards');
  const ms = store.boot.members;
  const P = { day: '1일', week: '1주', month: '1달' };
  const edit = (r = {}) => formModal({
    title: r.id ? '보상 수정' : '보상 추가',
    values: { target: r.target || 'member', member_id: r.member_id ?? '', period: r.period || store.boot.settings.reward_period, threshold: r.threshold ?? 100, content: r.content || '' },
    fields: [
      { key: 'target', label: '대상', type: 'select', options: [['member', '구성원'], ['family', '가족 합계']] },
      { key: 'member_id', label: '구성원', type: 'select', options: [['', '모든 아이 (부모 보상 설정 시 부모 포함)'], ...ms.map((m) => [m.id, m.name])], when: (v) => v.target === 'member' },
      { key: 'period', label: '기간', type: 'select', options: [['day', '1일'], ['week', '1주'], ['month', '1달']] },
      { key: 'threshold', label: `몇 ${styleOf(store.boot.settings).unit} 모으면? (할 일 1개 = 1${styleOf(store.boot.settings).unit})`, type: 'number', min: 1 },
      { key: 'content', label: '보상 내용 (예: 아이스크림 🍦)', maxlength: 100 },
    ],
    onSave: async (v) => { r.id ? await put(`/api/rewards/${r.id}`, v) : await post('/api/rewards', v); await refresh(); },
    onDelete: r.id ? async () => { await del(`/api/rewards/${r.id}`); await refresh(); } : null,
  });
  body.append(section('보상', `보상 하나가 ${styleOf(store.boot.settings).coll} 하나가 돼요. 예) 30${styleOf(store.boot.settings).unit} → 아이스크림, 55${styleOf(store.boot.settings).unit} → 영화. 기간이 끝나면 자동으로 정리해 축하 화면을 보여줘요.`,
    settingsForm(store, [
      { key: 'reward_period', label: '기본 보상 기간 (모으기 화면 기본 탭)', type: 'select', options: [['day', '1일'], ['week', '1주'], ['month', '1달']] },
      { key: 'week_start', label: '주간 시작 요일', type: 'select', options: dayNames.map((n, i) => [i, `${n}요일`]) },
      { key: 'month_start', label: '월간 시작 날짜 (1~28일)', type: 'number', min: 1, max: 28 },
      { key: 'parents_rewarded', label: '부모도 보상 대상 ("모든 아이" 보상에 부모 포함)', type: 'checkbox' },
    ]),
    h('div', { class: 'list' }, list.map((r) => {
      const m = ms.find((x) => x.id === r.member_id);
      return h('div', { class: 'list-row' },
        r.target === 'family' ? h('span', { class: 'list-icon' }, '👨‍👩‍👧‍👦') : m ? avatar(m, 'sm') : h('span', { class: 'list-icon' }, '🧒'),
        h('div', { class: 'grow' }, h('b', {}, r.content),
          h('div', { class: 'muted small' }, `${r.target === 'family' ? '가족 합계' : m ? m.name : '모든 아이'} · ${P[r.period]} · ${r.threshold}${styleOf(store.boot.settings).unit} 모으면`)),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => edit(r) }, '수정'));
    })),
    h('button', { class: 'btn btn-primary', onclick: () => edit() }, '+ 보상 추가')));
}

// ---------------- 괜찮아
function okay(body, store) {
  const s = store.boot.settings;
  const vals = { ...s, encouragements: (s.encouragements || []).join('\n'), cheers: (s.cheers || []).join('\n') };
  const f = form([
    { key: 'late_allowed', label: '마감 지난 뒤 "늦게라도 했어요" 체크 허용 (똑같이 1개, 연한 색으로 표시)', type: 'checkbox' },
    { key: 'rest_tickets_per_week', label: '쉬어가기권 (주당 장수)', type: 'number', min: 0, max: 7 },
    { key: 'encouragements', label: '격려 문구 (한 줄에 하나)', type: 'textarea', rows: 5 },
    { key: 'cheers', label: '체크할 때 나오는 칭찬 (한 줄에 하나, 랜덤)', type: 'textarea', rows: 5 },
  ], vals);
  body.append(section('"괜찮아" 기능', '못 한 일은 벌점 없이 격려로 다뤄요.',
    h('div', { class: 'card' }, f.el, h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', onclick: async () => {
      const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
      try {
        await put('/api/settings', {
          late_allowed: f.values.late_allowed, late_ratio: 1, rest_tickets_per_week: f.values.rest_tickets_per_week,
          encouragements: lines(f.values.encouragements), cheers: lines(f.values.cheers),
        });
        toast('저장했어요 ✅');
        await refresh();
      } catch (e) { errorToast(e); }
    } }, '저장')))));
}

// ---------------- 달력
function calendar(body, store) {
  body.append(section('달력', null, settingsForm(store, [
    { key: 'child_events', label: '아이가 자기 일정을 직접 등록 (그림 아이콘 간단 화면)', type: 'checkbox' },
    { key: 'calendar_view', label: '기본 보기', type: 'select', options: [['month', '월간'], ['week', '주간']] },
    { key: 'event_alerts', label: '일정 시작 전 알림 (화면 배너 + 효과음)', type: 'checkbox' },
  ])));
}

// ---------------- 미디어
async function media(body, store) {
  const [{ dir, files }, schedules] = await Promise.all([get('/api/media'), get('/api/media-schedules')]);
  const play = async (file, location, volume = 70) => {
    try {
      const r = await post('/api/media/play', { file, location, volume });
      if (r.ok) toast(location === 'tablet' ? `태블릿 재생 신호를 보냈어요 (${r.devices}대 연결)` : '서버 PC에서 재생 중 🔊');
      else errorToast(new Error(`재생 실패: ${r.error}`));
    } catch (e) { errorToast(e); }
  };
  const upload = () => {
    const input = h('input', { type: 'file', accept: 'audio/*,video/*' });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const close = toast(`올리는 중… ${file.name}`, { duration: 600000 });
      try {
        await api(`/api/media?name=${encodeURIComponent(file.name)}`, { method: 'POST', raw: file });
        close();
        toast('업로드 완료 🎵');
        rerender();
      } catch (e) { close(); errorToast(e); }
    };
    input.click();
  };
  const edit = (s = {}) => formModal({
    title: s.id ? '예약 수정' : '예약 추가',
    values: {
      label: s.label || '', time: s.time || '07:30', days: s.days ? s.days.split(',').map(Number) : [1, 2, 3, 4, 5],
      file: s.file || files[0]?.name || '', location: s.location || store.boot.settings.default_media_location || 'server', volume: s.volume ?? 70, active: s.active ?? 1,
    },
    fields: [
      { key: 'label', label: '이름 (예: 기상 노래)', maxlength: 60 },
      { key: 'time', label: '시각', type: 'time' },
      { key: 'days', label: '반복 요일', type: 'days' },
      { key: 'file', label: '파일 (미디어 폴더)', type: 'select', options: files.map((f) => [f.name, f.name]) },
      { key: 'location', label: '재생 위치', type: 'select', options: [['server', 'A. 서버 PC 스피커 (권장)'], ['tablet', 'B. 태블릿 화면']] },
      { key: 'volume', label: '볼륨', type: 'range', min: 0, max: 100, step: 5 },
      { key: 'active', label: '켜기', type: 'checkbox' },
    ],
    onSave: async (v) => { s.id ? await put(`/api/media-schedules/${s.id}`, v) : await post('/api/media-schedules', v); rerender(); },
    onDelete: s.id ? async () => { await del(`/api/media-schedules/${s.id}`); rerender(); } : null,
  });

  const deviceToggle = h('label', { class: 'check-row' },
    h('input', { type: 'checkbox', checked: mediaDevice.enabled, onchange: (e) => { mediaDevice.enabled = e.target.checked; toast(e.target.checked ? '이 기기에서 "태블릿 화면" 예약을 재생해요' : '이 기기는 재생하지 않아요'); } }),
    h('span', {}, '이 기기를 태블릿 재생 기기로 사용 (아침에 홈 화면의 "오늘 시작하기"를 한 번 눌러 주세요)'));

  body.append(section('예약 미디어 재생', '정해진 시각에 서버 PC의 미디어 폴더에 있는 음원·동영상을 재생해요.',
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '⏰ 예약 목록'),
      schedules.length
        ? h('div', { class: 'list' }, schedules.map((s) => h('div', { class: `list-row ${s.active ? '' : 'inactive'}` },
          h('span', { class: 'list-icon' }, s.location === 'tablet' ? '📱' : '🔊'),
          h('div', { class: 'grow' }, h('b', {}, `${s.time} ${s.label || ''}`),
            h('div', { class: 'muted small' }, `${daysText(s.days.split(',').map(Number))} · ${s.file} · ${s.location === 'tablet' ? '태블릿' : '서버 PC'} · 볼륨 ${s.volume}${s.active ? '' : ' · 꺼짐'}`)),
          h('button', { class: 'btn btn-sm btn-light', onclick: () => play(s.file, s.location, s.volume) }, '▶ 테스트'),
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => edit(s) }, '수정'))))
        : h('p', { class: 'muted' }, '예약이 없어요'),
      h('div', { class: 'row-end' },
        h('button', { class: 'btn btn-ghost', onclick: () => post('/api/media/stop').then(() => toast('재생을 멈췄어요')).catch(errorToast) }, '⏹ 모두 멈춤'),
        h('button', { class: 'btn btn-primary', disabled: !files.length, onclick: () => edit() }, '+ 예약 추가'))),
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '📁 미디어 폴더'),
      h('p', { class: 'muted small mono' }, dir),
      files.length
        ? h('div', { class: 'list' }, files.map((f) => h('div', { class: 'list-row' },
          h('span', { class: 'list-icon' }, /\.(mp4|webm|mov|m4v)$/i.test(f.name) ? '🎬' : '🎵'),
          h('div', { class: 'grow' }, h('b', {}, f.name), h('div', { class: 'muted small' }, `${(f.size / 1024 / 1024).toFixed(1)} MB`)),
          h('button', { class: 'btn btn-sm btn-light', onclick: () => play(f.name, 'server') }, '🔊 서버'),
          h('button', { class: 'btn btn-sm btn-light', onclick: () => play(f.name, 'tablet') }, '📱 태블릿'),
          h('button', { class: 'btn btn-sm btn-danger-ghost', onclick: async () => {
            if (!(await confirmBox(`${f.name} 파일을 삭제할까요?`, { ok: '삭제', danger: true }))) return;
            await del(`/api/media/${encodeURIComponent(f.name)}`); rerender();
          } }, '삭제'))))
        : h('p', { class: 'muted' }, '파일이 없어요. 업로드하거나 위 폴더에 직접 넣어 주세요.'),
      h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', onclick: upload }, '⬆ 파일 업로드'))),
    h('div', { class: 'card' }, h('div', { class: 'card-title' }, '📱 이 기기'), deviceToggle),
    settingsForm(store, [
      { key: 'media_dir', label: '미디어 폴더 경로 (서버 PC 기준, 상대 경로는 프로젝트 폴더 기준)' },
      { key: 'default_media_location', label: '기본 재생 위치', type: 'select', options: [['server', '서버 PC 스피커'], ['tablet', '태블릿 화면']] },
    ])));
}

// ---------------- 화면
function display(body, store) {
  body.append(section('화면', null, settingsForm(store, [
    { key: 'theme', label: '테마', type: 'select', options: [['auto', '자동 (기기 설정 따름)'], ['light', '라이트'], ['dark', '다크']] },
    { key: 'sound', label: '효과음 켜기', type: 'checkbox' },
    { key: 'characters', label: '캐릭터 돌아다니기 켜기', type: 'checkbox' },
    { key: 'font_scale', label: '글자 크기', type: 'select', options: [['0.9', '작게'], ['1', '보통'], ['1.15', '크게'], ['1.3', '아주 크게']] },
  ]), h('button', { class: 'btn btn-light', onclick: () => sounds.check() }, '🔔 효과음 들어보기')));
}

// ---------------- 보안·관리
function security(body) {
  const pin = { pin: '', pin2: '' };
  const f = form([
    { key: 'pin', label: '새 PIN (숫자 4~6자리)', type: 'password' },
    { key: 'pin2', label: '새 PIN 한 번 더', type: 'password' },
  ], pin);
  const exportData = async () => {
    try {
      const res = await fetch('/api/backup/export', { headers: { 'x-parent-token': auth.token } });
      if (!res.ok) throw new Error('내보내기 실패');
      const blob = await res.blob();
      const a = h('a', { href: URL.createObjectURL(blob), download: `happy-home-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
    } catch (e) { errorToast(e); }
  };
  const importData = () => {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!(await confirmBox('지금 데이터를 백업 파일 내용으로 바꿀까요? (현재 데이터는 backups 폴더에 자동 보관돼요)', { ok: '복원', danger: true }))) return;
      try {
        await post('/api/backup/import', JSON.parse(await file.text()));
        toast('복원했어요 ✅');
        await refresh();
      } catch (e) { errorToast(e); }
    };
    input.click();
  };
  body.append(section('보안·관리', null,
    h('div', { class: 'card' }, h('div', { class: 'card-title' }, '🔑 부모 PIN 변경'), f.el,
      h('div', { class: 'row-end' }, h('button', { class: 'btn btn-primary', onclick: async () => {
        if (!/^\d{4,6}$/.test(f.values.pin)) return errorToast(new Error('PIN은 숫자 4~6자리예요'));
        if (f.values.pin !== f.values.pin2) return errorToast(new Error('두 PIN이 달라요'));
        try { await put('/api/pin', { pin: f.values.pin }); toast('PIN을 바꿨어요 🔑'); } catch (e) { errorToast(e); }
      } }, 'PIN 변경'))),
    h('div', { class: 'card' }, h('div', { class: 'card-title' }, '💾 데이터 백업·복원'),
      h('p', { class: 'muted small' }, '매일 새벽 3시에 서버 PC의 backups 폴더로 DB를 자동 백업해요 (최근 30개 보관). 사진·미디어 파일은 data/photos, media 폴더를 따로 복사해 주세요.'),
      h('div', { class: 'row-wrap' },
        h('button', { class: 'btn btn-light', onclick: exportData }, '⬇ 파일로 내보내기'),
        h('button', { class: 'btn btn-light', onclick: importData }, '⬆ 파일에서 복원'),
        h('button', { class: 'btn btn-light', onclick: () => post('/api/backup/now').then((r) => toast(`백업 완료: ${r.file}`)).catch(errorToast) }, '📦 지금 서버에 백업'))),
    h('div', { class: 'card' }, h('div', { class: 'card-title' }, '🙈 얼굴 데이터'),
      h('p', { class: 'muted small' }, '얼굴 특징값은 집 서버에만 저장돼요. 언제든 전체 삭제할 수 있어요.'),
      h('button', { class: 'btn btn-danger-ghost', onclick: async () => {
        if (!(await confirmBox('모든 구성원의 얼굴 데이터를 삭제할까요?', { ok: '전체 삭제', danger: true }))) return;
        try { await del('/api/face-data'); toast('얼굴 데이터를 모두 지웠어요'); await refresh(); } catch (e) { errorToast(e); }
      } }, '얼굴 데이터 전체 삭제'))));
}
