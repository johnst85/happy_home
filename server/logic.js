// 날짜·점수·기간 계산 로직 (별도 점수 테이블 없이 체크 기록을 합산)
const { db, getSetting, getSettings } = require('./db');

const pad = (n) => String(n).padStart(2, '0');
function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hm(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function weekday(s) {
  return parseYmd(s).getDay();
}
function daysBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ---- 기간 ----
function getPeriod(type, ref = ymd(), offset = 0) {
  const fmt = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
  if (type === 'day') {
    const day = addDays(ref, offset);
    return { type, start: day, end: day, label: offset === 0 ? '오늘' : fmt(day) };
  }
  if (type === 'week') {
    const ws = Number(getSetting('week_start') || 1);
    const back = (weekday(ref) - ws + 7) % 7;
    const start = addDays(addDays(ref, -back), offset * 7);
    const end = addDays(start, 6);
    const label = offset === 0 ? '이번 주' : offset === -1 ? '지난 주' : `${fmt(start)} ~ ${fmt(end)}`;
    return { type, start, end, label, range: `${fmt(start)} ~ ${fmt(end)}` };
  }
  // month: 시작 날짜(1~28) 기준
  const ms = Math.min(28, Math.max(1, Number(getSetting('month_start') || 1)));
  const r = parseYmd(ref);
  let y = r.getFullYear();
  let m = r.getMonth();
  if (r.getDate() < ms) m -= 1;
  m += offset;
  const startD = new Date(y, m, ms);
  const endD = new Date(startD.getFullYear(), startD.getMonth() + 1, ms - 1);
  const start = ymd(startD);
  const end = ymd(endD);
  const label = offset === 0 ? '이번 달' : offset === -1 ? '지난 달' : `${startD.getFullYear()}년 ${startD.getMonth() + 1}월`;
  return { type, start, end, label, range: `${fmt(start)} ~ ${fmt(end)}` };
}

// ---- 할 일 / 상태 ----
function loadTasks() {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY sort, id').all();
  const asg = db.prepare('SELECT task_id, member_id FROM task_assignees').all();
  const map = new Map(tasks.map((t) => [t.id, { ...t, assignees: [], dayset: new Set(String(t.days).split(',').filter(Boolean).map(Number)) }]));
  for (const a of asg) map.get(a.task_id)?.assignees.push(a.member_id);
  return [...map.values()];
}
function loadMembers() {
  return db.prepare('SELECT id, name, role, photo, character, emoji, color, sort, (face_descriptor IS NOT NULL) AS has_face FROM members ORDER BY sort, id').all();
}

/**
 * 기간 내 날짜별·구성원별 상태 계산
 * 반환: { [date]: { [memberId]: { scheduled, done, points, achieved, rest } } }
 */
function statusRange(start, end, opts = {}) {
  const tasks = (opts.tasks || loadTasks()).filter((t) => t.active);
  const members = opts.members || loadMembers();
  const comps = db.prepare('SELECT task_id, member_id, date, points FROM completions WHERE date BETWEEN ? AND ?').all(start, end);
  const rests = db.prepare('SELECT member_id, date FROM rest_days WHERE date BETWEEN ? AND ?').all(start, end);
  const restSet = new Set(rests.map((r) => `${r.member_id}|${r.date}`));
  const byDate = new Map();
  for (const c of comps) {
    if (!byDate.has(c.date)) byDate.set(c.date, []);
    byDate.get(c.date).push(c);
  }
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const out = {};
  for (const date of daysBetween(start, end)) {
    const wd = weekday(date);
    const list = byDate.get(date) || [];
    const doneMember = new Set(list.map((c) => `${c.task_id}|${c.member_id}`));
    const doneFamily = new Set(list.filter((c) => taskById.get(c.task_id)?.is_family).map((c) => c.task_id));
    const day = {};
    for (const m of members) {
      const mine = tasks.filter((t) => t.dayset.has(wd) && t.assignees.includes(m.id));
      const done = mine.filter((t) => (t.is_family ? doneFamily.has(t.id) : doneMember.has(`${t.id}|${m.id}`))).length;
      const points = list.filter((c) => c.member_id === m.id).reduce((s, c) => s + c.points, 0);
      day[m.id] = {
        scheduled: mine.length,
        done,
        points,
        achieved: mine.length > 0 && done >= mine.length,
        rest: restSet.has(`${m.id}|${date}`),
      };
    }
    out[date] = day;
  }
  return out;
}

function streakFor(memberId, today = ymd(), st = null) {
  const start = addDays(today, -180);
  st = st || statusRange(start, today);
  let streak = 0;
  // 오늘은 달성했으면 포함, 아직이면 건너뜀
  const t = st[today]?.[memberId];
  if (t && t.achieved) streak++;
  const first = db.prepare('SELECT MIN(date) AS d FROM completions').get().d || today;
  for (let d = addDays(today, -1); d >= start && d >= first; d = addDays(d, -1)) {
    const s = st[d]?.[memberId];
    if (!s) break;
    if (s.scheduled === 0) continue;
    if (s.achieved || s.rest) streak++;
    else break;
  }
  return streak;
}

function pointsBetween(start, end) {
  const rows = db.prepare('SELECT member_id, SUM(points) AS p FROM completions WHERE date BETWEEN ? AND ? GROUP BY member_id').all(start, end);
  const out = {};
  for (const r of rows) out[r.member_id] = r.p || 0;
  return out;
}

function restInfo(memberId, today = ymd()) {
  const per = Number(getSetting('rest_tickets_per_week') || 1);
  const wk = getPeriod('week', today, 0);
  const used = db.prepare('SELECT COUNT(*) AS n FROM rest_days WHERE member_id = ? AND date BETWEEN ? AND ?').get(memberId, wk.start, wk.end).n;
  return { per_week: per, used, left: Math.max(0, per - used) };
}

// ---- 보상 / 정산 ----
function eligibleMembers(reward, members) {
  if (reward.target === 'family') return [];
  if (reward.member_id) return members.filter((m) => m.id === reward.member_id);
  const parents = getSetting('parents_rewarded') === '1';
  return members.filter((m) => m.role === 'child' || parents);
}

function rewardsFor(memberId, period, members) {
  const rewards = db.prepare("SELECT * FROM rewards WHERE target = 'member' AND period = ? ORDER BY threshold").all(period);
  return rewards.filter((r) => eligibleMembers(r, members).some((m) => m.id === memberId));
}

/** 끝난 기간을 자동 정산해 보상 기준을 넘은 구성원에게 reward_grants 생성 (중복 안전) */
function settle(today = ymd()) {
  const members = loadMembers();
  const rewards = db.prepare('SELECT * FROM rewards').all();
  const ins = db.prepare(`INSERT OR IGNORE INTO reward_grants (reward_id, member_id, period, period_start, period_end, points)
    VALUES (?, ?, ?, ?, ?, ?)`);
  let created = 0;
  for (const type of ['day', 'week', 'month']) {
    const rs = rewards.filter((r) => r.period === type);
    if (!rs.length) continue;
    for (let off = -1; off >= -3; off--) {
      const p = getPeriod(type, today, off);
      const pts = pointsBetween(p.start, p.end);
      const fam = Object.values(pts).reduce((a, b) => a + b, 0);
      for (const r of rs) {
        if (r.target === 'family') {
          if (fam >= r.threshold) created += Number(ins.run(r.id, 0, type, p.start, p.end, fam).changes);
        } else {
          for (const m of eligibleMembers(r, members)) {
            const v = pts[m.id] || 0;
            if (v >= r.threshold) created += Number(ins.run(r.id, m.id, type, p.start, p.end, v).changes);
          }
        }
      }
    }
  }
  return created;
}

// ---- 일정(반복 전개) ----
function eventsBetween(start, end) {
  const events = db.prepare('SELECT * FROM events').all();
  const em = db.prepare('SELECT event_id, member_id FROM event_members').all();
  const mm = new Map();
  for (const r of em) {
    if (!mm.has(r.event_id)) mm.set(r.event_id, []);
    mm.get(r.event_id).push(r.member_id);
  }
  const out = [];
  for (const e of events) {
    const members = mm.get(e.id) || [];
    const base = { ...e, members };
    if (e.repeat === 'none') {
      if (e.date >= start && e.date <= end) out.push({ ...base, occurs: e.date });
      continue;
    }
    const baseD = parseYmd(e.date);
    for (const d of daysBetween(start < e.date ? e.date : start, end)) {
      const dd = parseYmd(d);
      if (e.repeat === 'weekly' && dd.getDay() === baseD.getDay()) out.push({ ...base, occurs: d });
      if (e.repeat === 'monthly' && dd.getDate() === baseD.getDate()) out.push({ ...base, occurs: d });
    }
  }
  out.sort((a, b) => (a.occurs + (a.all_day ? '00:00' : a.start_time || '99:99')).localeCompare(b.occurs + (b.all_day ? '00:00' : b.start_time || '99:99')));
  return out;
}

function publicSettings() {
  const s = getSettings();
  delete s.pin_hash;
  delete s.pin_salt;
  for (const k of ['encouragements', 'cheers']) {
    try { s[k] = JSON.parse(s[k]); } catch { s[k] = []; }
  }
  return s;
}

module.exports = {
  ymd, hm, parseYmd, addDays, weekday, daysBetween, isYmd,
  getPeriod, loadTasks, loadMembers, statusRange, streakFor, pointsBetween,
  restInfo, rewardsFor, settle, eventsBetween, publicSettings, eligibleMembers,
};
