// 홈: 오늘 할 일 체크 화면
import { post, del } from './api.js';
import { h, avatar, toast, errorToast, modal, fmtDate, nowHm, confirmBox } from './ui.js';
import { confetti, cheerPopup, banner, fireworksShow, rainConfetti, sounds } from './fx.js';
import * as chars from './chars.js';
import { reloadToday, render as rerender, mediaDevice, askParent } from './main.js';

let shownGrants = false;
const pick = (arr, d) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : d);

function doneInfo(task, memberId, comps) {
  return comps.find((c) => c.task_id === task.id && (task.is_family || c.member_id === memberId)) || null;
}
function todaysTasks(store, memberId) {
  const wd = new Date(store.today.date.replace(/-/g, '/')).getDay();
  return store.boot.tasks.filter((t) => t.active && t.days.includes(wd) && t.assignees.includes(memberId));
}
function currentSlot(slots, now) {
  return slots.find((s) => s.start_time <= now && now < s.end_time) || null;
}

export function render(el, store) {
  const { boot, today } = store;
  if (!store.memberId) return renderPicker(el, store);
  const me = store.member();
  const now = nowHm();
  const comps = today.completions;
  const tasks = todaysTasks(store, me.id);
  const slots = boot.slots;
  const cur = currentSlot(slots, now);

  // 시간대별 그룹: 지금 시간대가 맨 위
  const groups = slots.map((s) => ({ slot: s, tasks: tasks.filter((t) => t.slot_id === s.id) })).filter((g) => g.tasks.length);
  const loose = tasks.filter((t) => !slots.some((s) => s.id === t.slot_id));
  if (loose.length) groups.push({ slot: { id: 0, name: '언제든', start_time: '', end_time: '' }, tasks: loose });
  if (cur) {
    const i = groups.findIndex((g) => g.slot.id === cur.id);
    if (i > 0) groups.unshift(...groups.splice(i, 1));
  }

  const encouragements = boot.settings.encouragements;
  const lateRatio = Number(boot.settings.late_ratio || 0.5);
  const lateAllowed = boot.settings.late_allowed === '1';

  const card = (t) => {
    const done = doneInfo(t, me.id, comps);
    const overdue = !done && t.deadline && now > t.deadline;
    const doer = done && t.is_family && done.member_id !== me.id ? store.member(done.member_id) : null;
    const el = h('div', {
      class: `task ${done ? 'done' : ''} ${overdue ? 'overdue' : ''} ${t.is_family ? 'family' : ''}`,
      role: 'button', tabindex: '0',
      'aria-label': `${t.name} ${done ? '완료됨' : ''}`,
    },
    h('div', { class: 'task-icon' }, t.icon || '✅'),
    h('div', { class: 'task-main' },
      h('div', { class: 'task-name' }, t.name),
      h('div', { class: 'task-meta' },
        !!t.is_family && h('span', { class: 'tag tag-family' }, '👨‍👩‍👧 가족 함께'),
        done
          ? h('span', { class: 'tag tag-done' }, done.is_late ? `늦게라도 했어요 +${done.points}` : `+${done.points}점`)
          : h('span', { class: 'tag' }, `${t.points}점`),
        !done && t.deadline && h('span', { class: 'task-deadline' }, `~${t.deadline}`),
        doer && h('span', { class: 'task-doer' }, `${doer.name}이(가) 했어요`))),
    h('div', { class: 'task-check' }, done ? '✔' : ''));

    if (overdue) {
      el.append(h('div', { class: 'task-okay' },
        h('span', { class: 'okay-face' }, avatar(me, 'xs')),
        h('span', { class: 'okay-text' }, pick(encouragements, '괜찮아, 그럴 수도 있지!')),
        lateAllowed && h('button', { class: 'btn btn-sm btn-retry', onclick: (e) => { e.stopPropagation(); check(t, el, store, true); } },
          `다시 도전 +${Math.round(t.points * lateRatio)}`)));
    }
    if (done && store.parent) {
      el.append(h('button', { class: 'task-undo', title: '체크 취소 (부모)', onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmBox(`"${t.name}" 체크를 취소할까요?`, { ok: '취소하기' }))) return;
        try { await del(`/api/completions/${done.id}`); sounds.undo(); await reloadToday(); rerender(); } catch (er) { errorToast(er); }
      } }, '↺'));
    }
    const act = () => {
      if (done) { cheerPopup(t.is_family ? '함께 해냈어요! 🤝' : '이미 했어요! 👍', ...center(el)); return; }
      if (overdue) {
        const [x] = center(el);
        chars.comfort(me.id, pick(encouragements, '괜찮아!'), x);
        if (!lateAllowed) return;
      }
      check(t, el, store, !!overdue);
    };
    el.addEventListener('click', act);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    return el;
  };

  const sections = groups.map((g) => {
    const n = g.tasks.filter((t) => doneInfo(t, me.id, comps)).length;
    const isCur = cur && g.slot.id === cur.id;
    const past = g.slot.end_time && now >= g.slot.end_time;
    return h('section', { class: `slot ${isCur ? 'current' : ''} ${past ? 'past' : ''} ${n === g.tasks.length ? 'cleared' : ''}` },
      h('div', { class: 'slot-head' },
        h('h3', {}, g.slot.name, isCur && h('span', { class: 'now-badge' }, '지금!')),
        g.slot.start_time && h('span', { class: 'slot-time' }, `${g.slot.start_time}~${g.slot.end_time}`),
        h('span', { class: 'slot-progress' }, n === g.tasks.length ? '🎉 클리어!' : `${n} / ${g.tasks.length}`)),
      h('div', { class: 'task-grid' }, g.tasks.map(card)));
  });

  el.replaceChildren(h('div', { class: 'home' },
    eventsStrip(store),
    memberStrip(store),
    h('div', { class: 'home-grid' },
      h('div', { class: 'home-tasks' },
        sections.length ? sections : h('div', { class: 'empty' }, '오늘은 할 일이 없어요. 푹 쉬어요! 😴')),
      h('aside', { class: 'home-side' }, sideCards(store, me, tasks)))));

  if (!shownGrants && today.new_grants?.length) {
    shownGrants = true;
    setTimeout(() => celebrateGrants(store), 400);
  }
}

const center = (el) => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

async function check(task, el, store, late) {
  const me = store.member();
  if (el.classList.contains('busy')) return;
  el.classList.add('busy');
  try {
    const r = await post('/api/completions', {
      task_id: task.id,
      member_id: me.id,
      method: store.parent && me.role === 'child' ? 'proxy' : 'touch',
    });
    store.recent.add(r.completion.id);
    const [x, y] = center(el);
    el.classList.add('done', 'pop');
    confetti(x, y, late ? 40 : 80);
    sounds.check();
    cheerPopup(late ? '늦게라도 했어요! 👏' : pick(store.boot.settings.cheers, '최고! 👍'), x, y - 30);
    chars.cheer(me.id, late ? '해냈다! 늦어도 괜찮아 😊' : pick(['해냈다! 🙌', '야호!', '나 최고!', '💪'], '해냈다!'));

    toast(`${task.icon} ${task.name} 완료! +${r.completion.points}점`, {
      duration: 5000,
      actionLabel: '되돌리기',
      action: async () => {
        try { await del(`/api/completions/${r.completion.id}`); sounds.undo(); await reloadToday(); rerender(); } catch (e) { errorToast(e); }
      },
    });

    if (r.slot_cleared) {
      const slot = store.boot.slots.find((s) => s.id === task.slot_id);
      setTimeout(() => {
        banner(`${slot ? slot.name : '오늘'} 미션 클리어!`, `${me.name} 정말 멋져요!`, { emoji: '🏅' });
        fireworksShow(5);
        sounds.clear();
      }, 700);
    }
    if (r.family_cleared) setTimeout(celebrateFamily, r.slot_cleared ? 3200 : 800);
    await reloadToday();
    setTimeout(rerender, 450);
  } catch (e) {
    errorToast(e);
    el.classList.remove('busy');
    if (e.status === 409) { await reloadToday(); rerender(); }
  }
}

export function celebrateFamily() {
  banner('가족 모두 오늘 목표 달성!', '우리 가족 최고예요! 🎉', { emoji: '👨‍👩‍👧‍👦', big: true, duration: 5000 });
  rainConfetti(3500);
  fireworksShow(10, 350);
  sounds.family();
  chars.dance(6000);
}

function celebrateGrants(store) {
  const list = store.today.new_grants;
  confetti(innerWidth / 2, innerHeight / 2, 120);
  sounds.clear();
  modal(h('div', { class: 'grant-celebrate' },
    h('div', { class: 'big-emoji' }, '🎁'),
    h('h3', {}, '보상 기준을 넘었어요!'),
    h('ul', { class: 'grant-list' }, list.map((g) => h('li', {},
      g.member_id ? avatar(store.member(g.member_id), 'sm') : h('span', { class: 'big-emoji-sm' }, '👨‍👩‍👧‍👦'),
      h('div', {}, h('strong', {}, `${g.member_id ? g.member_name : '우리 가족'} — ${g.content}`),
        h('div', { class: 'muted' }, `${g.period_start} ~ ${g.period_end} · ${g.points}점`))))),
    h('p', { class: 'muted' }, '보상은 부모님이 주시면 "지급 완료"로 표시해요.')), {
    title: '축하해요! 🎉',
    onClose: () => post('/api/grants/seen', { ids: list.map((g) => g.id) }).catch(() => {}),
  });
}

function eventsStrip(store) {
  const evs = store.today.events;
  return h('div', { class: 'events-strip' },
    h('span', { class: 'events-strip-label' }, '📅 오늘 일정'),
    evs.length
      ? evs.map((e) => {
        const names = e.members.map((id) => store.member(id)?.name).filter(Boolean);
        const color = store.member(e.members[0])?.color || 'var(--accent)';
        return h('a', { class: 'event-chip', href: '#/calendar', style: { '--mc': color } },
          e.icon, ' ', names.length > 2 ? '가족' : names.join('·'), ' ', e.title, ' ', e.all_day ? '' : e.start_time || '');
      })
      : h('span', { class: 'muted' }, '오늘은 일정이 없어요'));
}

function ring(done, total, color) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const p = total ? done / total : 0;
  return h('span', { class: 'ring', html: `<svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="${r}" class="ring-bg"/><circle cx="30" cy="30" r="${r}" class="ring-fg" style="stroke:${color}" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 30 30)"/></svg>` });
}

function memberStrip(store) {
  const st = store.today.status;
  return h('div', { class: 'member-strip' }, store.boot.members.map((m) => {
    const s = st[m.id] || { done: 0, scheduled: 0 };
    return h('button', {
      class: `member-btn ${m.id === store.memberId ? 'on' : ''} ${s.achieved ? 'achieved' : ''}`,
      style: { '--mc': m.color },
      onclick: () => { store.selectMember(m.id); rerender(); chars.cheer(m.id, '나야 나!'); },
    },
    h('span', { class: 'member-avatar' }, ring(s.done, s.scheduled, m.color), avatar(m, 'md')),
    h('span', { class: 'member-name' }, m.name),
    h('span', { class: 'member-sub' }, s.achieved ? '⭐ 완료' : `${s.done}/${s.scheduled}`),
    store.today.streaks[m.id] > 1 && h('span', { class: 'streak-badge', title: '연속 달성' }, `🔥${store.today.streaks[m.id]}`));
  }),
  h('button', { class: 'member-btn member-btn-all', onclick: () => { store.selectMember(null); rerender(); } },
    h('span', { class: 'member-avatar' }, h('span', { class: 'avatar avatar-md avatar-all' }, '👨‍👩‍👧‍👦')),
    h('span', { class: 'member-name' }, '누구?'),
    h('span', { class: 'member-sub' }, '바꾸기')));
}

function progressBar(value, max, color) {
  const p = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': value, 'aria-valuemax': max },
    h('div', { class: 'bar-fill', style: { width: `${p}%`, background: color || 'var(--accent)' } }));
}

function sideCards(store, me, tasks) {
  const { today, boot } = store;
  const st = today.status[me.id] || { done: 0, scheduled: 0, points: 0 };
  const period = today.period;
  const myPts = period.points[me.id] || 0;
  const cards = [];

  cards.push(h('div', { class: 'card me-card', style: { '--mc': me.color } },
    h('div', { class: 'me-head' }, avatar(me, 'lg'),
      h('div', {},
        h('div', { class: 'me-name' }, me.name, me.role === 'parent' && h('span', { class: 'tag' }, '부모')),
        h('div', { class: 'me-big' }, st.done ? `오늘 ${st.done}개 해냈어!` : '오늘도 시작해 볼까? 😊'))),
    h('div', { class: 'me-stats' },
      h('div', {}, h('b', {}, `${st.points}`), h('small', {}, '오늘 점수')),
      h('div', {}, h('b', {}, `${myPts}`), h('small', {}, period.label)),
      h('div', {}, h('b', {}, `🔥 ${today.streaks[me.id] || 0}`), h('small', {}, '연속 달성'))),
    st.scheduled > 0 && progressBar(st.done, st.scheduled, me.color),
    h('button', { class: 'btn btn-light btn-block', onclick: () => dayEnd(store) }, '🌙 하루 마무리 보기')));

  // 쉬어가기권
  const y = today.yesterday[me.id];
  const rest = today.rest[me.id];
  if (y?.missed?.length && rest?.left > 0) {
    const d = y.missed[0];
    cards.push(h('div', { class: 'card rest-card' },
      h('div', { class: 'card-title' }, '🎫 쉬어가기권 ', h('span', { class: 'tag' }, `${rest.left}장`)),
      h('p', {}, `${fmtDate(d)}은 다 못 했지만 괜찮아요. 쉬어가는 날로 하면 연속 달성이 이어져요!`),
      h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
        try {
          await post('/api/rest', { member_id: me.id, date: d });
          sounds.soft();
          toast('쉬어가기권을 썼어요. 오늘 다시 힘내자! 🌱');
          await reloadToday(); rerender();
        } catch (e) { errorToast(e); }
      } }, '쉬어가기권 쓰기')));
  }

  // 가족 목표
  const fr = period.family_rewards || [];
  if (fr.length) {
    const next = fr.find((r) => r.threshold > period.family) || fr[fr.length - 1];
    cards.push(h('div', { class: 'card family-card' },
      h('div', { class: 'card-title' }, '👨‍👩‍👧‍👦 가족 협동 목표', h('span', { class: 'muted' }, ` · ${period.label}`)),
      h('div', { class: 'family-goal' }, h('b', {}, `${period.family}`), ` / ${next.threshold}점`),
      progressBar(period.family, next.threshold, 'linear-gradient(90deg, #ff5d8f, #ffb020, #2ec27e, #4f8cff)'),
      h('div', { class: 'muted' }, period.family >= next.threshold ? `🎉 달성! ${next.content}` : `${next.threshold - period.family}점 더 모으면 ${next.content}`)));
  }

  // 지금 체크할 남은 일
  const left = tasks.filter((t) => !doneInfo(t, me.id, today.completions)).length;
  if (left === 0 && tasks.length) {
    cards.push(h('div', { class: 'card all-done' }, h('div', { class: 'big-emoji' }, '🌟'), h('b', {}, '오늘 할 일을 모두 해냈어요!')));
  }

  // 태블릿 미디어 기기
  if (mediaDevice.enabled && !mediaDevice.unlocked) {
    cards.push(h('div', { class: 'card start-card' },
      h('div', { class: 'card-title' }, '🎵 이 화면은 예약 재생 기기예요'),
      h('button', { class: 'btn btn-primary btn-block btn-lg', onclick: async () => { await mediaDevice.start(); rerender(); } }, '▶ 오늘 시작하기')));
  }
  if (!store.parent && me.role === 'child') {
    cards.push(h('button', { class: 'btn btn-ghost btn-block btn-sm', onclick: () => askParent('부모님 확인') }, '🔒 부모님이 대신 체크·취소하기'));
  }
  return cards;
}

function dayEnd(store) {
  const { today, boot } = store;
  modal(h('div', { class: 'dayend' },
    h('p', { class: 'muted' }, '오늘 한 일 위주로 돌아봐요. 못 한 건 내일 또 해보면 돼요!'),
    boot.members.map((m) => {
      const tasks = todaysTasks(store, m.id);
      const done = tasks.filter((t) => doneInfo(t, m.id, today.completions));
      const notDone = tasks.length - done.length;
      return h('div', { class: 'dayend-row', style: { '--mc': m.color } },
        avatar(m, 'md'),
        h('div', { class: 'dayend-body' },
          h('div', { class: 'dayend-title' }, h('b', {}, m.name), ' ', done.length ? `오늘 ${done.length}개 해냈어!` : '오늘은 쉬어가는 날 🌿'),
          h('div', { class: 'dayend-icons' }, done.map((t) => h('span', { title: t.name }, t.icon))),
          notDone > 0 && h('div', { class: 'muted' }, `${notDone}개는 내일 또 해보자 🌱`)),
        today.status[m.id]?.achieved && h('span', { class: 'stamp' }, '⭐'));
    })), { title: '🌙 오늘 하루 마무리' });
}

function renderPicker(el, store) {
  const st = store.today.status;
  el.replaceChildren(h('div', { class: 'picker' },
    eventsStrip(store),
    h('h2', { class: 'picker-title' }, '누구의 하루를 볼까요? 👀'),
    h('div', { class: 'picker-grid' }, store.boot.members.map((m) => {
      const s = st[m.id] || { done: 0, scheduled: 0 };
      return h('button', { class: 'picker-btn', style: { '--mc': m.color }, onclick: () => { store.selectMember(m.id); rerender(); } },
        h('span', { class: 'member-avatar' }, ring(s.done, s.scheduled, m.color), avatar(m, 'xl')),
        h('span', { class: 'picker-name' }, m.name),
        h('span', { class: 'muted' }, s.achieved ? '⭐ 오늘 완료!' : `${s.done} / ${s.scheduled}`));
    })),
    h('p', { class: 'muted center' }, '얼굴을 눌러서 내 할 일을 확인해요')));
}

let lastSlotKey = '';
export function tick(store) {
  // 시간대가 바뀌었거나 마감이 지나면 다시 그리기
  const now = nowHm();
  const cur = currentSlot(store.boot.slots, now);
  const key = `${cur?.id}|${now}`;
  if (key !== lastSlotKey && !document.querySelector('.modal-back')) {
    lastSlotKey = key;
    rerender();
  }
}
